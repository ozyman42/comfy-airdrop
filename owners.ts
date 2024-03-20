import { PublicKey } from '@solana/web3.js';
import { getCollectionV2 } from './get-collection';
import { connection } from './connection';
import { COL_DELIMITER, getOrSet } from './cache';

const GENESIS_COLLECTION_PUBKEY = "46pcSL5gmjBrPqGKFaLbbCmR6iVuLJbnQy13hAe7s6CC";

export async function getGenesisOwners(): Promise<string[]> {
  return getOrSet(
    `${GENESIS_COLLECTION_PUBKEY}_owners.txt`, 
    () => getCollectionV2(GENESIS_COLLECTION_PUBKEY)
  );
}

export type OwnerLatestActivity = {
  owner: string; // pubkey of owner's account
  latestTx: string; // most recent tx of the owner
  latestTxSlot: number; // slot of above tx
  latestTxBlockTime: string; // block time of above tx in ISO string format
}

class RateLimiter {
  private promiseQueue: (() => void)[];
  private rateLimit: number; // num of ops per second
  private remaining: number;

  public constructor(perSecond: number) {
    this.rateLimit = perSecond;
    this.promiseQueue = [];

    setInterval(() => {
      this.remaining = this.rateLimit;
      this.dequeue();
    }, 1000);
  }

  private dequeue() {
    while (this.remaining > 0 && this.promiseQueue.length > 0) {
      this.promiseQueue.shift()!();
      this.remaining--;
    }
  }

  public next() {
    const prom = new Promise<void>(resolve => {
      this.promiseQueue.push(resolve);
    });
    this.dequeue();
    return prom;
  }
}

// Owners with the most recent activity comes first
// turns out this doesn't work so well because all the owners are getting airdrops, which counts as a latest transaction.
// for more accurate results we need to go through the instructions of each tx and find one where the wallet actually takes an action, perhaps we can look where the wallet is the fee payer
export async function sortOwnersByLatestActivity(): Promise<OwnerLatestActivity[]> {
  const owners = await getGenesisOwners();
  const rateLimit = new RateLimiter(7);
  let total = 0;
  const ownersWithLatestActivityLines = await getOrSet(
    `${GENESIS_COLLECTION_PUBKEY}_owners_activity.csv`,
    async () => [
      ['owner', 'latestTx', 'latestTxSlot', 'latestTxBlockTime'].join(COL_DELIMITER),
      ...(await Promise.all(owners
      .map(async (owner, i) => {
        await rateLimit.next();
        const signatures = await connection.getSignaturesForAddress(new PublicKey(owner), {limit: 1});
        total++;
        if (total % 50 === 0) {
          console.log(`${total}/${owners.length}`);
        }
        return {owner, signatures};
      })))
      .map(({owner, signatures}) => ({owner, signature: signatures[0]}))
      .filter(({owner, signature})=> {
        const sigMissing = signature === undefined;
        if (sigMissing) {
          console.log(`Account ${owner} has no transactions`);  
        }
        return !sigMissing;
      })
      .map(({owner, signature: {slot, signature, blockTime}}): OwnerLatestActivity => ({
        owner,
        latestTx: signature,
        latestTxSlot: slot,
        latestTxBlockTime: new Date(blockTime! * 1000).toISOString()
      }))
      .sort(({latestTxSlot: slotA}, {latestTxSlot: slotB}) => slotB - slotA) // desc order, highest slots first
      .map(({owner, latestTx, latestTxSlot, latestTxBlockTime}) => [
        owner,
        latestTx,
        latestTxSlot.toString(),
        latestTxBlockTime
      ].join(COL_DELIMITER))
    ]
  );
  return ownersWithLatestActivityLines.map(line => {
    const [owner, latestTx, latestTxSlot, latestTxBlockTime] = line.split(COL_DELIMITER);
    return {
      owner, latestTx, latestTxSlot: parseInt(latestTxSlot), latestTxBlockTime
    };
  });
}
