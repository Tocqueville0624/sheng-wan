import { describe, expect, it } from "vitest";
import { editorialRows } from "../src/features/gallery/layout";
import manifest from "../src/data/generated/media.json";

describe("editorial photo layout", () => {
  it("retains the complete collection in its original keyboard and visual order", () => {
    const entries = editorialRows(manifest.gallery).flat();
    expect(entries.map(({ image }) => image.id)).toEqual(manifest.gallery.map(({ id }) => id));
    expect(entries.map(({ index }) => index)).toEqual(manifest.gallery.map((_, index) => index));
  });

  it("features the opening photograph and groups the remaining photos without orphan rows", () => {
    const [lead, ...rows] = editorialRows(manifest.gallery);
    expect(lead).toHaveLength(1);
    expect(rows.every((row) => row.length >= 2 && row.length <= 3)).toBe(true);
  });

  it("handles an empty or single-photograph collection", () => {
    expect(editorialRows([])).toEqual([]);
    expect(editorialRows(manifest.gallery.slice(0, 1))).toHaveLength(1);
  });
});
