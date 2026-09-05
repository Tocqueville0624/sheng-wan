import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const archiveRoot = new URL("../public/archive/hugo-uw-profile/", import.meta.url);
const html = readFileSync(new URL("index.html", archiveRoot), "utf8");
const provenance = JSON.parse(readFileSync(new URL("provenance.json", archiveRoot), "utf8"));

describe("Hugo's historical UW profile", () => {
  it("preserves the complete captured biography without wording changes", () => {
    const biography = html
      .match(/<div class="field-name-field-biography">\s*<p>(.*?)<\/p>/s)?.[1]
      .replace(/\s+/g, " ")
      .trim();
    expect(biography).toBeDefined();
    expect(biography?.length).toBe(provenance.biography.characters);
    expect(biography?.split(" ").length).toBe(provenance.biography.words);
    expect(
      createHash("sha256")
        .update(biography ?? "")
        .digest("hex")
    ).toBe(provenance.biography.sha256);
    expect(html).toContain(`<h1>${provenance.title}</h1>`);
    expect(html).toContain(provenance.role);
    expect(html).toContain(provenance.sourceUrl);
    expect(html).toContain(provenance.capturedAt);
  });

  it("retains the original JPEG bytes and no executable or remote embedded content", () => {
    const portrait = readFileSync(new URL(provenance.portrait.localPath, archiveRoot));
    expect(createHash("sha256").update(portrait).digest("hex")).toBe(provenance.portrait.sha256);
    expect(html).not.toMatch(/<(?:script|iframe|form|object|embed)\b/i);
    expect(html).not.toMatch(/\bon\w+\s*=|javascript:|\ssrc\s*=\s*["'](?:https?:)?\/\//i);
    expect(html).toContain("default-src 'none'");
    const css = readFileSync(new URL("assets/archive.css", archiveRoot), "utf8");
    expect(css).not.toMatch(/@import|url\(/i);
  });
});
