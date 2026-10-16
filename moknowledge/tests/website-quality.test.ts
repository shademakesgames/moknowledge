import test from "node:test";
import assert from "node:assert/strict";
import { extractInto, parsePage } from "../src/lib/scraper/extract";
import { fieldText, newKnowledge } from "../src/lib/knowledge";

const run = (html: string, pageUrl: string, isHome = true) => {
  const record = newKnowledge(pageUrl);
  extractInto(record, parsePage(html, pageUrl), isHome);
  return record;
};

test("brand comes from the title's leading words when the title runs into the city", () => {
  const record = run(`<html><head><title>Bonefish Grill  Las Vegas,  NV</title></head><body><main><p>Hand-cut specialties in Las Vegas.</p></main></body></html>`, "https://locations.bonefishgrill.com/nevada/las-vegas/");
  assert.equal(fieldText(record.sections.foundation.name), "Bonefish Grill");
});

test("a site with no title uses the legal name it repeats in body copy", () => {
  const body = `<p>JD and Associates, L.L.C. provides environmental and technical support for complex missions.</p><p>JD and Associates, L.L.C. partners with businesses through teaming agreements.</p><p>Menu</p>`;
  const record = run(`<html><head><title></title></head><body><nav><a>Toggle Menu JD and Associates, L.L.C.</a></nav><main>${body}</main><footer>© 2026 - WordPress Theme by Kadence WP</footer></body></html>`, "https://jdandassociatesllc.com/");
  assert.equal(fieldText(record.sections.foundation.name), "JD and Associates");
  assert.equal(fieldText(record.sections.foundation.legalEntityType), "LLC");
});

test("the domain-matched brand beats a shorter JSON-LD organization name", () => {
  const html = `<html><head><title>Bonefish Grill  Las Vegas,  NV</title><script type="application/ld+json">{"@type":"Restaurant","name":"Bonefish"}</script></head><body><main><p>Hand-cut specialties in Las Vegas.</p></main></body></html>`;
  const record = run(html, "https://locations.bonefishgrill.com/nevada/las-vegas/");
  assert.equal(fieldText(record.sections.foundation.name), "Bonefish Grill");
});

test("hour labels, street names, and adjectives are not people", () => {
  const html = `<html><head><title>Bonefish Grill</title></head><body><main><h3>HOURS OF OPERATION</h3><p>Managing Partner Sunset Rd. serves guests daily from open to close.</p><p>Independent CPA firm with a CFO on staff for every client.</p></main></body></html>`;
  const record = run(html, "https://locations.bonefishgrill.com/nevada/las-vegas/");
  assert.equal(record.people.length, 0);
});

test("a sentence that only ends the name is not included in it", () => {
  const html = `<html><head><title>Account-it</title></head><body><main><p>Choosing us means benefiting from our founder. Doug Cohen. With a CPA and proud member of the AICPA.</p><p>Our founder, Doug Cohen, is a CPA with decades of experience.</p></main></body></html>`;
  const record = run(html, "https://account-it.net/firm-background");
  assert.deepEqual(record.people.map(person => fieldText(person.fields.name)), ["Doug Cohen"]);
});

test("phones share one format and count once; emails are deduplicated by case", () => {
  const html = `<html><head><title>Acme</title></head><body><main><p><a href="tel:+17024070980">+1 (702) 407-0980</a> <a href="tel:702-407-0980">702-407-0980</a></p><p><a href="tel:(702) 240-0532">(702) 240-0532</a></p><p><a href="mailto:Info@acme.com">Info@acme.com</a></p><p><a href="mailto:info@acme.com">info@acme.com</a></p></main></body></html>`;
  const record = run(html, "https://acme.com/");
  assert.deepEqual(record.sections.foundation.phones.value, ["(702) 407-0980", "(702) 240-0532"]);
  assert.deepEqual(record.sections.foundation.emails.value, ["info@acme.com"]);
});

test("share and pin links are not social profiles", () => {
  const html = `<html><head><title>Acme</title></head><body><main><a href="https://www.linkedin.com/shareArticle?mini=true&url=x">Share</a><a href="https://www.linkedin.com/company/acme/">LinkedIn</a><a href="http://pinterest.com/pin/create/button/">Pin</a><a href="https://www.facebook.com/acme.co/">Facebook</a></main></body></html>`;
  const record = run(html, "https://acme.com/");
  assert.deepEqual(record.sections.presence.linkedin.value, ["https://www.linkedin.com/company/acme/"]);
  assert.equal(record.sections.presence.other.value, null);
  assert.deepEqual(record.sections.presence.facebook.value, ["https://www.facebook.com/acme.co/"]);
});

test("WordPress default swatches and generic font stacks are not brand signals", () => {
  const html = `<html><head><title>Acme</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif} h1{font-family:Lato,Arial,sans-serif;color:#1f2937} a{color:#cf2e2e} b{color:#2299dd}</style></head><body><main><p>Acme.</p></main></body></html>`;
  const record = run(html, "https://acme.com/");
  assert.deepEqual(record.sections.branding.fonts.value, ["Lato"]);
  assert.ok(!(record.sections.branding.colors.value as string[]).includes("#cf2e2e"));
  assert.ok((record.sections.branding.colors.value as string[]).includes("#1f2937"));
});

test("cookie, trademark, and heading text is not a customer need or differentiator", () => {
  const html = `<html><head><title>Acme</title></head><body><main><h2>We Can Help You See What a Buyer Will See</h2><p>We use cookies to improve your experience on this website.</p><p>Acme is a trademark of Acme Holdings LLC for consultants everywhere.</p><p>We specialize in payroll for small clinics across Oregon.</p></main></body></html>`;
  const record = run(html, "https://acme.com/");
  const needs = record.sections.market.customerNeeds.value ?? [];
  assert.ok(!(needs as string[]).some(line => /cookies|trademark|See What/.test(line)));
  assert.deepEqual(record.sections.positioning.differentiators.value, ["We specialize in payroll for small clinics across Oregon."]);
});
