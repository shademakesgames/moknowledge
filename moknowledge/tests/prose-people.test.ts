import test from "node:test";
import assert from "node:assert/strict";
import { extractInto, parsePage } from "../src/lib/scraper/extract";
import { newKnowledge, fieldText } from "../src/lib/knowledge";

test("finds a founder named in running text on a non-bio page", () => {
  const html = `<html><head><title>About Account-it Consulting Services, LLC</title></head><body><main><h1>About us</h1><p>Choosing us means benefiting from the extensive background and hands-on experience of our founder, Doug Cohen, a CPA and proud member of the AICPA.</p><p>Contact our office during business hours for a consultation about your tax situation.</p></main></body></html>`;
  const record = newKnowledge("https://account-it.net/");
  extractInto(record, parsePage(html, "https://account-it.net/firm-background"), false);
  assert.equal(record.people.length, 1);
  assert.equal(fieldText(record.people[0].fields.name), "Doug Cohen");
  assert.equal(fieldText(record.people[0].fields.role), "Founder");
});

test("does not treat company names as people", () => {
  const html = `<html><head><title>Home</title></head><body><main><p>Account-it Consulting Services, LLC is the owner of this site and its founder team works hard for clients every day.</p></main></body></html>`;
  const record = newKnowledge("https://account-it.net/");
  extractInto(record, parsePage(html, "https://account-it.net/"), true);
  assert.equal(record.people.length, 0);
});

test("crawl follows links two steps out from the homepage", async () => {
  const { crawlWebsite } = await import("../src/lib/scraper/crawl");
  const pages: Record<string, string> = {
    "https://depth.example/": `<html><head><title>Home</title></head><body><main><p>${"Welcome to our office. ".repeat(20)}</p><a href="/about-us/">About</a></main></body></html>`,
    "https://depth.example/about-us/": `<html><head><title>About</title></head><body><main><p>${"About the firm. ".repeat(20)}</p><a href="/about-us/team-member/">Team</a></main></body></html>`,
    "https://depth.example/about-us/team-member/": `<html><head><title>Member</title></head><body><main><p>${"Team bio text. ".repeat(20)}</p></main></body></html>`,
    "https://depth.example/about-us/team-member/deep/": `<html><head><title>Deep</title></head><body><main><p>${"Too deep. ".repeat(20)}</p></main></body></html>`,
  };
  const fetcher = async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/robots.txt") return { url: input, status: 404, body: "", contentType: "text/plain" };
    const body = pages[input];
    return body ? { url: input, status: 200, body, contentType: "text/html" } : { url: input, status: 404, body: "", contentType: "text/html" };
  };
  const result: any = await crawlWebsite("https://depth.example/", { fetcher: fetcher as any, pauseMs: 0 });
  const urls = result.crawl.pages.map((page: any) => page.url);
  assert.ok(urls.includes("https://depth.example/about-us/team-member/"), "second-step page should be crawled");
  assert.ok(!urls.includes("https://depth.example/about-us/team-member/deep/"), "third-step page should not be crawled");
});

test("reads team cards on the homepage and skips headline words", () => {
  const html = `<html><head><title>Elevation Group | Scottsdale Luxury Real Estate Experts</title><meta property="og:site_name" content="Kelly Jones Scottsdale Luxury Real Estate Agent"></head><body><main><h2>Your Trusted Partner in Real Estate</h2><h2>Meet The Team</h2><p>Kelly Jones Founding Partner kelly@elevationgroupaz.com 480-399-9322 Read Bio Thomas Scott Founding Partner thomas@elevationgroupaz.com 480-482-9260 Read Bio</p></main></body></html>`;
  const record = newKnowledge("https://elevationgroupaz.com/");
  extractInto(record, parsePage(html, "https://elevationgroupaz.com/"), true);
  assert.deepEqual(record.people.map(person => fieldText(person.fields.name)), ["Kelly Jones", "Thomas Scott"]);
  assert.equal(fieldText(record.people[0].fields.role), "Founding Partner");
  assert.equal(fieldText(record.sections.foundation.name), "Elevation Group");
});

test("finds a person on a bare-slug bio page from the title and opening text", () => {
  const html = `<html><head><title>Elizabeth Flynn</title></head><body><main><h1>Elizabeth Flynn</h1>
<p>Assistant</p>
<h2>Your Trusted Partner in Real Estate &amp; Relocation</h2>
<div>Individuals and families who work with Elizabeth Flynn appreciate her calm approach.</div></main></body></html>`;
  const record = newKnowledge("https://elevationgroupaz.com/");
  extractInto(record, parsePage(html, "https://elevationgroupaz.com/elizabeth-flynn/"), false);
  assert.equal(record.people.length, 1);
  assert.equal(fieldText(record.people[0].fields.name), "Elizabeth Flynn");
  assert.equal(fieldText(record.people[0].fields.role), "Assistant");
});

test("a policy or listing heading that matches the page title is not a person", () => {
  const html = `<html><head><title>Privacy Policy</title></head><body><main><h1>Privacy Policy</h1><p>We collect personal information when you contact us about a property.</p></main></body></html>`;
  const record = newKnowledge("https://elevationgroupaz.com/");
  extractInto(record, parsePage(html, "https://elevationgroupaz.com/privacy-policy/"), false);
  assert.equal(record.people.length, 0);
});
