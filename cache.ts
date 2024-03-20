import * as path from 'path';
import * as fs from 'fs';

export const CACHE_DIR = path.resolve(__dirname, "cache");
fs.mkdirSync(CACHE_DIR, {recursive: true});
export const CACHE_FILE_LINE_DELIMITER = "\n";
export const COL_DELIMITER = ",";

export async function getOrSet(cacheKey: string, set: () => Promise<string[]>): Promise<string[]> {
  const cacheFilePath = path.resolve(CACHE_DIR, cacheKey);
  if (fs.existsSync(cacheFilePath)) {
    console.log(`cache hit on ${cacheKey}`);
    return fs.readFileSync(cacheFilePath).toString().split(CACHE_FILE_LINE_DELIMITER);
  }
  console.log(`cache miss on ${cacheKey}`);
  const items = await set();
  fs.writeFileSync(cacheFilePath, items.join(CACHE_FILE_LINE_DELIMITER));
  return items;
}
