import { CompiledInstruction, ConfirmedTransactionMeta, Message, MessageAccountKeys, VersionedTransactionResponse, Connection } from "@solana/web3.js";
import { Ok, Err, Result } from './match';
import { z } from 'zod';
import { resolveAccounts, ResolveAccountsError } from "./account-resolver";
import * as base58 from 'bs58';
import { CACHE_DIR } from './cache';
import * as path from 'path';
import * as fs from 'fs';

const TRANSACTION_CACHE_DIR = path.resolve(CACHE_DIR, "transactions");
fs.mkdirSync(TRANSACTION_CACHE_DIR, {recursive: true});

export async function totalCachedTransactions(): Promise<number> {
  const children = await fs.promises.readdir(TRANSACTION_CACHE_DIR);
  return children.length;
}

// bigint isn't JSON serializable
// https://github.com/GoogleChromeLabs/jsbi/issues/30#issuecomment-1006088574
export function serialize(transaction: Transaction, pretty = false): string {
  return JSON.stringify(
    transaction,
    (_, value) => typeof value === "bigint" ? `BIGINT:${value.toString()}` : value,
    pretty ? 2 : 0
  );
}

const bigintEncodingPattern = /^BIGINT:[0-9]+$/;
export function deserialize(json: string): Result<Transaction, {type: 'ZodError', error: z.ZodError}> {
  const deserialized = JSON.parse(
    json,
    (_, value) => typeof value === 'string' && bigintEncodingPattern.test(value) ? BigInt(value.split(':')[1]) : value
  );
  const parsed = SerializableTransaction.safeParse(deserialized);
  if (parsed.success) {
    return Ok(parsed.data);
  } else {
    return Err({type: 'ZodError', error: parsed.error});
  }
}

export const SerializableTokenMeta = z.strictObject({
  mint: z.string(),
  owner: z.string(),
  amount: z.bigint(),
  decimals: z.number()
});

export const SerializableAccountMeta = z.strictObject({
  pubkey: z.string(),
  isSigner: z.boolean(),
  isWriteable: z.boolean(),
  // lamport balances (rent)
  preBalance: z.bigint(),
  postBalance: z.bigint(),
  // if the account was an ATA
  preTokenBalance: SerializableTokenMeta.optional(),
  postTokenBalance: SerializableTokenMeta.optional()
});

export const SerializableInstruction = z.strictObject({
  stackHeight: z.number(),
  programIdIndex: z.number(),
  data: z.string(),
  accounts: z.array(z.number())
});

export const SerializableTransactionError = z.strictObject({
  InstructionError: z.tuple([
    z.number(),
    z.union([z.string(), z.strictObject({Custom: z.number()})])
  ]).optional(),
  InsufficientFundsForRent: z.strictObject({
    account_index: z.number()
  }).optional()
}).optional();

export const SerializableTransaction = z.strictObject({
  blockTime: z.number(),
  slot: z.number(),
  recentBlockhash: z.string(),
  computeUnitsConsumed: z.bigint(),
  err: SerializableTransactionError,
  fee: z.bigint(),
  signatures: z.array(z.string()),
  version: z.union([z.literal('legacy'), z.literal(0)]),
  logMessages: z.array(z.string()),
  accounts: z.array(SerializableAccountMeta),
  instructions: z.array(SerializableInstruction)
});

export type Transaction = z.infer<typeof SerializableTransaction>;
export type Account = z.infer<typeof SerializableAccountMeta>;
export type TokenBalance = z.infer<typeof SerializableTokenMeta>;
export type Instruction = z.infer<typeof SerializableInstruction>;

export enum GetTransactionErrorType {
  NullGetTransactionResponse = 'NullGetTransactionResponse',
  ZodError = 'ZodError',
  ResolveAccountError = 'ResolveAccountError', // problem getting account list from transaction
  DuplicateTokenAccounts = 'DuplicateTokenAccounts', // if multiple items in pre or post token balances reference the same account
  OuterIxStackHeightNonNull = 'OuterIxStackHeightNonNull', // it's expected that all outer instructions have a null stackHeight (even though it's really 1)
  RepeatOuterIndicesForInnerIx = 'RepeatOuterIndicesForInnerIx', // if multiple items in innerInstructions reference same outer instruction
  InvalidStackHeightTransition = 'InvalidStackHeightTransition', // if next instruction item in an inner instruction list increases by more than 1, or if it goes to less than 2 (only outers can have stack height 1)
}

export type GetTransactionError = 
  {
    type: GetTransactionErrorType.NullGetTransactionResponse;
  } |
  {
    type: GetTransactionErrorType.ZodError;
    error: z.ZodError;
  } |
  {
    type: GetTransactionErrorType.ResolveAccountError;
    error: ResolveAccountsError;
  } |
  {
    type: GetTransactionErrorType.DuplicateTokenAccounts;
    balanceType: 'pre' | 'post';
    duplicates: Record<string, TokenBalanceResponse[]>;
  } |
  {
    type: GetTransactionErrorType.OuterIxStackHeightNonNull;
    outerInstruction: Message['compiledInstructions'][number];
  } |
  {
    type: GetTransactionErrorType.RepeatOuterIndicesForInnerIx;
    repeatedIndex: number;
  } |
  {
    type: GetTransactionErrorType.InvalidStackHeightTransition;
    outerInstructionIndex: number;
    innerInstructionIndex: number;
    priorStackHeight: number;
    innerStackHeight: number;
  }

type TokenBalanceResponse = NonNullable<NonNullable<VersionedTransactionResponse['meta']>['postTokenBalances']>[number];

function parseTokenBalances(tokenBalanceResponses: TokenBalanceResponse[], accountsRaw: MessageAccountKeys): Result<Record<string, TokenBalance>, {type: 'duplicates'; duplicates: Record<string, TokenBalanceResponse[]>}> {
  const duplicates: Record<string, TokenBalanceResponse[]> = {};
  const parsed: Record<string, [TokenBalanceResponse, TokenBalance]> = {};
  for (let i = 0; i < tokenBalanceResponses.length; ++i) {
    const cur = tokenBalanceResponses[i];
    const {accountIndex, mint, owner, uiTokenAmount: {amount, decimals}} = cur;
    const accountPubkey = accountsRaw.get(accountIndex)!.toBase58();
    if (parsed[accountPubkey] !== undefined) {
      if (duplicates[accountPubkey] === undefined) {
        duplicates[accountPubkey] = [parsed[accountPubkey][0]];
      }
      duplicates[accountPubkey].push(cur);
    }
    parsed[accountPubkey] = [
      cur, 
      {
        mint,
        owner: owner!,
        amount: BigInt(amount),
        decimals
      }
    ];
  }
  if (Object.keys(duplicates).length > 0) {
    return Err({type: 'duplicates', duplicates});
  }
  return Ok(Object.fromEntries(Object.entries(parsed).map(([account, [_response, balance]]) => [account, balance])));
}

function parseInstructions(outer: Message['compiledInstructions'], inner: NonNullable<ConfirmedTransactionMeta['innerInstructions']>): Result<Instruction[], GetTransactionError> {
  const innerInstructionMap: Record<number, CompiledInstruction[]> = {};
  for (let i = 0; i < inner.length; ++i) {
    const { index, instructions } = inner[i];
    if (index in innerInstructionMap) {
      return Err({
        type: GetTransactionErrorType.RepeatOuterIndicesForInnerIx,
        repeatedIndex: index
      });
    }
    innerInstructionMap[index] = instructions;
  }
  const instructions: Instruction[] = [];
  for (let outerI = 0; outerI < outer.length; ++outerI) {
    const curOuter = outer[outerI];
    // TODO: figure out why the outer and inner instruction types don't have a stackHeight member even though the rpc always returns this.
    //       perhaps we need to patch web3 libs or there's some edge case we aren't aware of.
    if ('stackHeight' in curOuter) {
      return Err({
        type: GetTransactionErrorType.OuterIxStackHeightNonNull,
        outerInstruction: curOuter
      });
    }
    instructions.push({
      stackHeight: 1,
      programIdIndex: curOuter.programIdIndex,
      data: base58.encode(curOuter.data),
      accounts: curOuter.accountKeyIndexes
    });
    let curStackHeight = 1;
    const curInnerInstructions = (innerInstructionMap[outerI] ?? []);
    for (let innerI = 0; innerI < curInnerInstructions.length; ++innerI) {
      const curInner = curInnerInstructions[innerI];
      const innerStackHeight: number = (curInner as any).stackHeight;
      const isInvalidStackHeight = 
        (typeof innerStackHeight !== 'number') ||
        (innerStackHeight > curStackHeight && curStackHeight + 1 !== innerStackHeight) ||
        (innerStackHeight < 2);
      /*if (isInvalidStackHeight) {
        return Err({
          type: GetTransactionErrorType.InvalidStackHeightTransition,
          outerInstructionIndex: outerI,
          innerInstructionIndex: innerI,
          priorStackHeight: curStackHeight,
          innerStackHeight
        });
      }*/
      instructions.push({
        stackHeight: innerStackHeight ?? -1,
        programIdIndex: curInner.programIdIndex,
        data: curInner.data,
        accounts: curInner.accounts
      });
      curStackHeight = innerStackHeight;
    }
  }
  return Ok(instructions);
}

export async function getTransaction(signature: string, connection: Connection): Promise<Result<Transaction, GetTransactionError>> {
  const txCachePath = path.resolve(TRANSACTION_CACHE_DIR, signature);
  if (fs.existsSync(txCachePath)) {
    const result = deserialize(fs.readFileSync(txCachePath).toString());
    console.log(`cache hit for tx ${signature}`);
    if (!result.success) {
      throw new Error(`Corrupt cache for tx ${signature}`);
      process.exit(1);
    }
    return Ok(result.ok);
  }
  const txResponse = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0
  });
  if (!txResponse) {
    return Err({
      type: GetTransactionErrorType.NullGetTransactionResponse
    });
  }
  const accountsResponse = await resolveAccounts(txResponse, connection);
  if (!accountsResponse.success) {
    return Err({type: GetTransactionErrorType.ResolveAccountError, error: accountsResponse.error});
  }
  const {ok: accountsRaw} = accountsResponse;
  const accounts: Account[] = [];
  // Index to token balance
  const preTokenBalances = parseTokenBalances(txResponse.meta?.preTokenBalances ?? [], accountsRaw);
  if (!preTokenBalances.success) {
    return Err({
      type: GetTransactionErrorType.DuplicateTokenAccounts,
      duplicates: preTokenBalances.error.duplicates,
      balanceType: 'pre',
    });
  }
  const postTokenBalances = parseTokenBalances(txResponse.meta?.postTokenBalances ?? [], accountsRaw);
  if (!postTokenBalances.success) {
    return Err({
      type: GetTransactionErrorType.DuplicateTokenAccounts,
      duplicates: postTokenBalances.error.duplicates,
      balanceType: 'post',
    });
  }

  for (let i = 0; i < accountsRaw.length; ++i) {
    const cur = accountsRaw.get(i);
    const pubkey = cur!.toBase58();
    accounts.push({
      pubkey,
      isSigner: txResponse.transaction.message.isAccountSigner(i),
      isWriteable: txResponse.transaction.message.isAccountWritable(i),
      preBalance: BigInt(txResponse.meta?.preBalances[i]!),
      postBalance: BigInt(txResponse.meta?.postBalances[i]!),
      preTokenBalance: preTokenBalances.ok[pubkey],
      postTokenBalance: postTokenBalances.ok[pubkey]
    });
  }

  const instructionsResult = parseInstructions(
    txResponse.transaction.message.compiledInstructions,
    txResponse.meta?.innerInstructions!
  );
  if (!instructionsResult.success) {
    return instructionsResult;
  }
  const instructions = instructionsResult.ok;

  const parseResult = SerializableTransaction.safeParse({
    blockTime: txResponse.blockTime,
    slot: txResponse.slot,
    recentBlockhash: txResponse.transaction.message.recentBlockhash,
    computeUnitsConsumed: BigInt(txResponse.meta?.computeUnitsConsumed!),
    err: txResponse.meta?.err ?? undefined,
    fee: BigInt(txResponse.meta?.fee!),
    signatures: txResponse.transaction.signatures,
    version: txResponse.version,
    logMessages: txResponse.meta?.logMessages,
    accounts,
    instructions,
  });
  if (parseResult.success) {
    fs.writeFileSync(txCachePath, serialize(parseResult.data, true));
    return Ok(parseResult.data);
  } else {
    return Err({type: GetTransactionErrorType.ZodError, error: parseResult.error});
  }
}
