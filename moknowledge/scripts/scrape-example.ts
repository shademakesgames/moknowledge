import { writeFile } from "node:fs/promises";
import { crawlWebsite } from "../src/lib/scraper/crawl";
import { populatedCount, recordName } from "../src/lib/knowledge";
async function main() {
  const url = process.argv[2] || "https://account-it.net/";
  const output = process.argv[3] || "examples/account-it.json";
  const result = await crawlWebsite(url);
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ output, company: recordName(result), fields: populatedCount(result), pages: result.crawl.pages }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
