import assert from "node:assert/strict";

const origin = new URL(process.argv[2] ?? "https://shengwan.org").origin;
const production = origin === "https://shengwan.org";

async function read(path: string) {
  const response = await fetch(new URL(path, origin), {
    signal: AbortSignal.timeout(30_000)
  });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response;
}

for (const path of [
  "/",
  "/cv/",
  "/research/",
  "/teaching/",
  "/playground/thales-olive/",
  "/playground/hugo-le-chatssius/",
  "/playground/photo-gallery/"
]) {
  const response = await read(path);
  const html = await response.text();
  assert.match(html, /<h1[\s>]/, `${path}: missing page heading`);
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)?.[1];
  assert(canonical?.startsWith(`${origin}/`), `${path}: incorrect canonical ${canonical}`);
  assert(!/https?:\/\/(localhost|127\.0\.0\.1)(?=[:/])/.test(html), `${path}: local URL in HTML`);
  if (production) {
    assert(!/noindex/i.test(response.headers.get("x-robots-tag") ?? ""), `${path}: noindex header`);
    assert(!/<meta\s+name="robots"\s+content="[^"]*noindex/.test(html), `${path}: noindex meta`);
  }
  console.log(`OK ${path}`);
}

const robots = await (await read("/robots.txt")).text();
if (production)
  assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`) && !robots.includes("Disallow: /"));
else assert(robots.includes("Disallow: /"));
const sitemap = await (await read("/sitemap.xml")).text();
for (const match of sitemap.matchAll(/<loc>(.*?)<\/loc>/g))
  assert(match[1]?.startsWith(`${origin}/`));
const pdf = new Uint8Array(await (await read("/downloads/sheng-wan-cv.pdf")).arrayBuffer());
assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
const finance = (await (await read("/api/finance/snapshot")).json()) as {
  dataStatus?: string;
  companies?: unknown[];
};
assert(["verified", "delayed"].includes(finance.dataStatus ?? ""));
assert((finance.companies?.length ?? 0) > 0);
const missing = await fetch(new URL("/deployment-check-missing-page", origin), {
  signal: AbortSignal.timeout(30_000)
});
assert.equal(missing.status, 404, "Missing page must return HTTP 404");

if (production) {
  for (const from of [
    "http://shengwan.org/cv/?check=deployment",
    "https://www.shengwan.org/cv/?check=deployment",
    "https://www.shengwan.org/api/finance/snapshot?check=deployment"
  ]) {
    const response = await fetch(from, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    assert([301, 308].includes(response.status), `${from}: expected permanent redirect`);
    const target = new URL(from);
    target.protocol = "https:";
    target.hostname = "shengwan.org";
    assert.equal(response.headers.get("location"), target.href);
  }
}
console.log(`Passed deployment checks for ${origin}`);
