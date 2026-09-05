import type { ResponsiveImage } from "../../types/media";

// Ratio-weighted rows preserve each photograph's framing without empty columns.
export function editorialRows(images: ResponsiveImage[]) {
  const rows: Array<Array<{ image: ResponsiveImage; index: number }>> = [];
  if (images[0]) rows.push([{ image: images[0], index: 0 }]);
  let index = 1;
  while (index < images.length) {
    const row: Array<{ image: ResponsiveImage; index: number }> = [];
    let ratio = 0;
    do {
      const image = images[index]!;
      row.push({ image, index });
      ratio += image.width / image.height;
      index += 1;
    } while (index < images.length && (row.length < 2 || ratio < 2.7));
    // Do not leave a lone portrait stretched across the final row.
    if (images.length - index === 1) {
      row.push({ image: images[index]!, index });
      index += 1;
    }
    rows.push(row);
  }
  return rows;
}
