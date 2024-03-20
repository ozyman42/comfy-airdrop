import { ConfirmedSignatureInfo, Connection, PublicKey } from "@solana/web3.js";
import { CACHE_DIR } from './cache';
import * as path from 'path';
import * as fs from 'fs';

const TX_CACHE_DIR = path.resolve(CACHE_DIR, 'signatures');
fs.mkdirSync(TX_CACHE_DIR, {recursive: true});

export async function getSigsForAddress(address: string, connection: Connection): Promise<string[]> {
  const allSignatures: ConfirmedSignatureInfo[] = [];
  const addressPubkey = new PublicKey(address);
  const addressSigsCacheFilePath = path.resolve(TX_CACHE_DIR, address);
  if (fs.existsSync(addressSigsCacheFilePath)) {
    console.log(`cache hit for ${address}`);
    const lines = fs.readFileSync(addressSigsCacheFilePath).toString().split("\n");
    return lines;
  }
  // This returns the first 1000, so we need to loop through until we run out of signatures to get.
  let signatures = await connection.getSignaturesForAddress(addressPubkey);
  allSignatures.push(...signatures);
  do {
    let options = {
      before: signatures[signatures.length - 1].signature,
    };
    signatures = await connection.getSignaturesForAddress(
      addressPubkey,
      options
    );
    allSignatures.push(...signatures);
  } while (signatures.length > 0);
  const final = allSignatures.map(({signature}) => signature);
  fs.writeFileSync(addressSigsCacheFilePath, final.join("\n"));
  return final;
}
