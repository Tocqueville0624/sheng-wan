import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import logos from "../src/features/finance/company-logos.json";

describe("official chart logo assets", () => {
  it("covers exactly the seven supported companies, including Alphabet rather than Google", () => {
    expect(Object.keys(logos).sort()).toEqual(
      ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSM"].sort()
    );
    expect(logos.GOOGL.name).toBe("Alphabet");
    expect(logos.GOOGL.sourcePage).toBe("https://abc.xyz/");
    expect(logos.TSM.width).toBe(132);
    expect(logos.TSM.height).toBe(100);
  });

  for (const [ticker, logo] of Object.entries(logos)) {
    it(`${ticker} embeds a pinned, self-contained original asset`, () => {
      expect(logo.sourceUrl).toMatch(/^https:\/\//);
      expect(logo.dataUri).toMatch(/^data:image\/(svg\+xml|png)[;,]/);
      const payload = logo.dataUri.slice(logo.dataUri.indexOf(",") + 1);
      const data = logo.dataUri.includes(";base64,")
        ? Buffer.from(payload, "base64")
        : Buffer.from(decodeURIComponent(payload));
      expect(createHash("sha256").update(data).digest("hex")).toBe(logo.sha256);
      if (logo.dataUri.startsWith("data:image/svg+xml")) {
        const svg = data.toString("utf8");
        expect(svg).toContain("<svg");
        expect(svg).not.toMatch(/<script|<foreignObject|\son[a-z]+\s*=|(?:href|src)\s*=/i);
        expect(svg).not.toMatch(/url\(\s*["']?https?:/i);
      }
    });
  }
});
