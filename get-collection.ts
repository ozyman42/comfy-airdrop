import { HELIUS_RPC } from "./connection";

class ProgressUpdater {
  private total: number;
  private cur: number;
  private lastUpdate: number;
  private updateOnEvery: boolean;

  public constructor(total: number, updateOnEvery: boolean) {
    this.total = total;
    this.updateOnEvery = updateOnEvery;
    this.cur = 0;
    this.lastUpdate = 0;
  }

  public next(otherInfo?: string) {
    this.cur++;
    if (this.updateOnEvery) {
      console.log(`${this.cur}/${this.total}`);
    }
    const curUpdate = Math.floor(this.cur / this.total * 10);
    if (curUpdate > this.lastUpdate) {
      console.log(`${Math.round((this.cur / this.total) * 100)}% done.${otherInfo ?? ""}`);
      this.lastUpdate = curUpdate;
    }
  }
}

// concept: https://docs.solanamobile.com/getting-started/saga-genesis-token#collection-nft-address
// accurate implementation: https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api/get-assets-by-group
// This one works way better but it requires the HELIUS DAS API
export async function getCollectionV2(collection: string): Promise<string[]> {
  let page = 1;
  const searchAssets = async (curPage: number): Promise<string[]> => {
    const response = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "my-id",
        method: "getAssetsByGroup",
        params: {
          groupKey: "collection",
          groupValue: collection, // Genesis Token Collection NFT Address
          page: curPage, // Starts at 1
          limit: 1000,
        },
      }),
    });
    const { result } = await response.json();
    const owners: string[] = [];
    for (const item of result.items) {
      const owner: string = item.ownership.owner;
      owners.push(owner);
    }
    return owners;
  };
  let latest: string[] = [''];
  const allOwners: Set<string> = new Set();
  while (latest.length > 0) {
    console.log(`page ${page}`);
    const results = await searchAssets(page);
    latest = results;
    results.forEach(r => { allOwners.add(r) });
    console.log(`all ${allOwners.size} page len ${results.length}`);
    page++;
  }
  const arr = Array.from(allOwners);
  console.log('total arr', arr.length);
  arr.sort();
  return arr;
}

// based on https://github.com/metaplex-foundation/get-collection
// this way is trash
/*
export async function getCollectionV1(collection: string, connection: Connection): Promise<string[]> {
  let collection_id = new PublicKey(collection);

  console.log("Getting signatures...");
  const allSignatures = await getSigsForAddress(collection, connection);
  console.log(`Found ${allSignatures.length} signatures`);

  console.log("Getting transaction data...");
  const progress = new ProgressUpdater(allSignatures.length, true);
  const transactions: Transaction[] = [];
  console.log(`${(await totalCachedTransactions())} total cached transactions`);
  for (const signature of allSignatures) {
    const result = await getTransaction(signature, connection);
    if (!result.success) {
      throw new Error(`Problem getting data for ${signature}. ${JSON.stringify(result.error, null, 2)}`);
      process.exit(1);
    }
    progress.next();
    transactions.push(result.ok);
  }

  console.log("Parsing transaction data...");
  const metadataAddresses = await getMetadataAddresses(collection, connection, transactions);

  console.log(`Getting mint addreses for the ${metadataAddresses.size} metadata addresses`);
  const mintAddresses = new Set<string>();
  const promises2 = Array.from(metadataAddresses).map((a) => connection.getAccountInfo(new PublicKey(a)));
  const metadataAccounts = await Promise.all(promises2);
  for (const account of metadataAccounts) {
    if (account) {
      let metadata = await Metadata.deserialize(account!.data);
      mintAddresses.add(metadata[0].mint.toBase58());
    }
  }
  const mints: string[] = Array.from(mintAddresses);
  // Get ownership info of every mint by finding ata for each mint with 1 supply
  return mints;
}

const METADATA_ADDRESSES_CACHE_DIR = path.relative(CACHE_DIR, 'metadata-addresses');
fs.mkdirSync(METADATA_ADDRESSES_CACHE_DIR, {recursive: true});

async function getMetadataAddresses(collection: string, connection: Connection, transactions: Transaction[]): Promise<Set<string>> {
  const pathToMetadataCache = path.resolve(METADATA_ADDRESSES_CACHE_DIR, collection);
  if (fs.existsSync(pathToMetadataCache)) {
    console.log(`cache hit for metadata addresses for colleciton ${collection}`);
    return new Set(fs.readFileSync(pathToMetadataCache).toString().split("\n"));
  }
  const metadataAddresses: Set<string> = new Set();
  const progress = new ProgressUpdater(transactions.length, false);
  for (const tx of transactions) {
    progress.next(`${metadataAddresses.size} NFTs found`);
    const accountKeys = tx.accounts.map(({pubkey}) => pubkey);
    // Only look in transactions that call the Metaplex token metadata program
    if (accountKeys.includes(metaplexProgramId)) {
      // Go through all instructions in a given transaction
      for (const ix of tx.instructions) {
        // Filter for setAndVerify or verify instructions in the Metaplex token metadata program
        ix
        if (
          (ix.data == "K" || // VerifyCollection instruction
            ix.data == "S" || // SetAndVerifyCollection instruction
            ix.data == "X" || // VerifySizedCollectionItem instruction
            ix.data == "Z") && // SetAndVerifySizedCollectionItem instruction
          accountKeys[ix.programIdIndex] == metaplexProgramId
        ) {
          let metadataAddressIndex = ix.accounts[0];
          let metadata_address = accountKeys[metadataAddressIndex];
          metadataAddresses.add(metadata_address);
        }
      }
    }
  }
  fs.writeFileSync(pathToMetadataCache, Array.from(metadataAddresses).join("\n"));
  return metadataAddresses;
}
*/
