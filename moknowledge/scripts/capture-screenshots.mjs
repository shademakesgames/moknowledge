// Captures the README screenshots from a running app: a live crawl in the builder, field evidence, the expanded document view,
// and the library. Run a production build first (npm run build && npm start; the dev server adds its own overlay), then:
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" APP_URL=http://localhost:3000 node scripts/capture-screenshots.mjs
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const OUT = "docs/screenshots";
const CRAWL_URL = process.env.CRAWL_URL || "https://account-it.net/";
const secondExample = JSON.parse(await readFile("examples/elevation-group.json", "utf8"));

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await desktop.newPage();
// Logos and previews load lazily, so each capture waits for the network to settle and every visible image to finish.
const settle = async target => {
  await target.waitForLoadState("networkidle").catch(() => undefined);
  await target.evaluate(() => Promise.all([...document.images].filter(img => !img.complete).map(img => new Promise(done => { img.onload = img.onerror = done; setTimeout(done, 5000); }))));
};
const shot = async (name, options = {}) => { await settle(page); await page.screenshot({ path: `${OUT}/${name}.png`, ...options }); };

// Builder before and after a real crawl.
await page.goto(`${APP_URL}/knowledge`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await shot("builder");
await page.getByLabel("Company website", { exact: true }).fill(CRAWL_URL);
await page.getByRole("button", { name: "Build knowledge" }).click();
await page.getByText("Your draft is ready", { exact: false }).waitFor({ timeout: 90_000 });
await page.locator(".editor-layout").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -120));
await shot("review");

// Each field keeps the excerpt, page, and locator it came from.
await page.locator(".field-card", { hasText: "Overview" }).locator("details.evidence summary").first().click();
await page.locator(".field-card", { hasText: "Overview" }).first().scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -160));
await shot("evidence");

// The expanded view reads the populated fields as a document.
await page.getByRole("button", { name: "Expanded", exact: true }).click();
await page.locator(".expanded-doc").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -80));
await shot("expanded");

// Save, add a second real example, and show the library.
await page.getByRole("button", { name: "Save knowledge" }).click();
await page.getByText("Saved", { exact: false }).first().waitFor();
await page.evaluate(record => {
  const key = "moknowledge.records.v1";
  const records = JSON.parse(localStorage.getItem(key) || "[]");
  localStorage.setItem(key, JSON.stringify([...records.filter(item => item.id !== record.id), record]));
}, secondExample);
await page.goto(`${APP_URL}/knowledge/view`);
await page.locator(".library-card").nth(1).waitFor();
await shot("library");
await page.getByRole("button", { name: "Table", exact: true }).click();
await shot("library-table");

// Mobile layouts.
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const phone = await mobile.newPage();
await phone.goto(`${APP_URL}/knowledge/view`);
await phone.evaluate(records => localStorage.setItem("moknowledge.records.v1", records), await page.evaluate(() => localStorage.getItem("moknowledge.records.v1")));
await phone.reload();
await phone.locator(".library-card").first().waitFor();
await settle(phone);
await phone.screenshot({ path: `${OUT}/library-mobile.png` });
await phone.goto(`${APP_URL}/knowledge`);
await settle(phone);
await phone.screenshot({ path: `${OUT}/builder-mobile.png` });

await browser.close();
console.log(`Saved screenshots to ${OUT}/`);
