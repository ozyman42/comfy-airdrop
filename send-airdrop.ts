import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getMint, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, Account, getAccount, createTransferInstruction } from '@solana/spl-token';

// This is really slow. Not sure why.
export async function sendAirdrop(wallets: string[], connection: Connection, mint: PublicKey, sender: Keypair, amount: number): Promise<string> {
  const instructions: TransactionInstruction[] = [];

  for (const wallet of wallets) {
    // Generate a new keypair to represent the receiver
    const receiver = new PublicKey(wallet);
  
    // Get the mint data (to adjust for decimals for amount)
    const mintData = await getMint(connection, mint);
  
    // Get the sender's associated token account address
    const senderTokenAccountAddress = await getAssociatedTokenAddress(
      mint,
      sender.publicKey
    )
  
    // Get the receiver's associated token account address
    const receiverTokenAccountAddress = await getAssociatedTokenAddress(
      mint,
      receiver
    )

    // Create an instruction to create the receiver's token account if it does not exist
    const createAccountInstruction = createAssociatedTokenAccountInstruction(
      sender.publicKey,
      receiverTokenAccountAddress,
      receiver,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  
    // Check if the receiver's token account exists
    let receiverTokenAccount: Account
    try {
      receiverTokenAccount = await getAccount(
        connection,
        receiverTokenAccountAddress,
        "confirmed",
        TOKEN_PROGRAM_ID
      )
    } catch (e) {
      // If the account does not exist, add the create account instruction to the transaction
      instructions.push(createAccountInstruction)
    }
  
    // Create an instruction to transfer 1 token from the sender's token account to the receiver's token account
    // Adjusting for decimals of the MINT
    const transferInstruction = await createTransferInstruction(
      senderTokenAccountAddress,
      receiverTokenAccountAddress,
      sender.publicKey,
      amount * 10 ** mintData.decimals
    )
  
    // Add the transfer instruction to the transaction
    instructions.push(transferInstruction);
  }

  // Create a new transaction
  const tx = new Transaction();
  tx.add(...instructions);
  const signature = await sendAndConfirmTransaction(
    connection, tx, [sender], {skipPreflight: true}
  );
  return signature;
}