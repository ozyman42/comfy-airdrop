import { Connection } from '@solana/web3.js';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
if (typeof HELIUS_API_KEY !== 'string') {
  throw new Error(`The HELIUS_API_KEY env var is not defined`);
}
export const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`; // personal dev account
export const connection = new Connection(HELIUS_RPC);
