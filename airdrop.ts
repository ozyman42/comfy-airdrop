import { Keypair, PublicKey } from "@solana/web3.js";
import { CACHE_DIR, CACHE_FILE_LINE_DELIMITER, COL_DELIMITER } from "./cache";
import * as fs from 'fs';
import * as path from 'path';
import { sortOwnersByLatestActivity } from "./owners";
import { sendAirdrop } from './send-airdrop';
import { connection } from "./connection";

const senderPrivKeyStr = process.env.COMFY_AIRDROP_KEY!;
if (senderPrivKeyStr === undefined) {
  throw new Error("The env var COMFY_AIRDROP_KEY must be set to a JSON-compatible number array representing the airdrop wallet's private key");
}

export async function airdrop(amount: number, mint: PublicKey) {
  const senderPrivKey = JSON.parse(senderPrivKeyStr);
  const sender = Keypair.fromSecretKey(new Uint8Array(senderPrivKey));
  console.log(sender.publicKey.toBase58());
  const sendFilePath = path.resolve(CACHE_DIR, 'send-txs.txt');
  const sendsFileContents = fs.readFileSync(sendFilePath)
    .toString().split(CACHE_FILE_LINE_DELIMITER).filter(line => line.length > 0);
  const owners = await sortOwnersByLatestActivity();
  
  const BATCH_SIZE = 100;
  let batch: string[] = [];
  for (let i = 0; i < owners.length; ++i) {
    console.log(`${i + 1} / ${owners.length} (${Math.round(100 * (i + 1)/(owners.length))}%)`);
    const curOwner = owners[i];
    const curSend = sendsFileContents[i];
    if (curSend !== undefined) {
      const [sendOwner, sendTx] = curSend.split(COL_DELIMITER);
      if (sendOwner !== curOwner.owner) {
        throw new Error(`Line ${i + 1} mismatch`);
      }
      continue;
    }
    batch.push(curOwner.owner);
    if (batch.length !== BATCH_SIZE) {
      continue;
    }
    const tx = await sendAirdrop(batch, connection, mint, sender, amount);
    for (const wallet of batch) {
      sendsFileContents.push(`${wallet}${COL_DELIMITER}${tx}`);
    }
    fs.writeFileSync(sendFilePath, sendsFileContents.join(CACHE_FILE_LINE_DELIMITER));
    batch = [];
    break;
  }
}