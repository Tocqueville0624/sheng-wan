import { mkdir, writeFile } from "node:fs/promises";
import logos from "../../src/features/finance/company-logos.json" with { type: "json" };

// Mechanical extraction of the existing pinned artwork, not a redraw or new download.
await mkdir("public/media/company-logos", { recursive: true });
const manifest: Record<string, { width: number; height: number; path: string }> = {};
for (const [ticker, logo] of Object.entries(logos)) {
  const extension = logo.dataUri.startsWith("data:image/svg+xml") ? "svg" : "png";
  const payload = logo.dataUri.slice(logo.dataUri.indexOf(",") + 1);
  const bytes = logo.dataUri.includes(";base64,")
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload));
  const path = `/media/company-logos/${ticker.toLowerCase()}.${extension}`;
  await writeFile(`public${path}`, bytes);
  manifest[ticker] = { width: logo.width, height: logo.height, path };
}
await writeFile(
  "src/features/finance/company-logo-manifest.json",
  JSON.stringify(manifest, null, 2) + "\n"
);
console.log("Extracted seven existing pinned logos into same-origin assets.");
