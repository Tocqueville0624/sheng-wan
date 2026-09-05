import { access, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { MediaManifest } from "../../src/types/media";

const root = process.cwd();
const manifestPath = path.join(root, "src", "data", "generated", "media.json");

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as MediaManifest;
  const images = [manifest.home, ...manifest.hugo, ...manifest.gallery];
  const errors: string[] = [];

  for (const image of images) {
    if (!image.alt.trim()) errors.push(`${image.id}: missing alt text`);
    if (!image.width || !image.height) errors.push(`${image.id}: missing dimensions`);
    for (const candidates of Object.values(image.sources)) {
      if (!candidates.length) errors.push(`${image.id}: missing responsive source`);
      for (const candidate of candidates) {
        const absolute = path.join(root, "public", candidate.src.replace(/^\//, ""));
        try {
          await access(absolute);
          const metadata = await sharp(absolute).metadata();
          if (metadata.exif) {
            errors.push(`${image.id}: EXIF metadata found in ${candidate.src}`);
          }
        } catch (error) {
          errors.push(`${image.id}: cannot verify ${candidate.src}: ${String(error)}`);
        }
      }
    }
  }

  if (manifest.gallery.length !== 16)
    errors.push(`Expected 16 gallery images, found ${manifest.gallery.length}`);
  if (manifest.hugo.length !== 6)
    errors.push(`Expected 6 Hugo images, found ${manifest.hugo.length}`);
  try {
    const gulls = sharp(path.join(root, "public/media/decorative/seagulls.webp"));
    const metadata = await gulls.metadata();
    const stats = await gulls.stats();
    if (!metadata.hasAlpha || stats.isOpaque)
      errors.push("Decorative gulls need real transparency");
    if (metadata.width !== 1060 || metadata.height !== 371)
      errors.push("Unexpected decorative gull asset dimensions");
    if (metadata.exif) errors.push("Decorative gulls contain source EXIF metadata");
  } catch (error) {
    errors.push(`Cannot verify decorative gulls: ${String(error)}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(
    `Verified ${images.length} image records and transparent decorative gulls with no embedded GPS metadata.\n`
  );
}

await main();
