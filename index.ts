import { PublicKey } from '@solana/web3.js';
import { airdrop } from './airdrop';

const MINT = new PublicKey("FbJpd8yhrGGkWVL1Ujf7qFvTw4uD4675k8CYk82LEKvZ");
const SEND_AMOUNT = 69;

await airdrop(SEND_AMOUNT, MINT);
