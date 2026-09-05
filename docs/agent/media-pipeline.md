# Media pipeline

Raw portraits, HEIC files, and `Photos/*.JPG` remain local-only and are ignored by Git. Definitions and reviewed alt-text drafts live in `scripts/media/definitions.ts`.

`pnpm media:build` auto-orients originals, converts to sRGB, creates responsive AVIF/WebP/JPEG derivatives, and writes `src/data/generated/media.json`. HEIC sources use `heif-convert` as a fallback when Sharp cannot decode them.

The pipeline intentionally writes no source metadata. `pnpm media:check` verifies every derivative exists, matches the manifest, and contains no embedded EXIF/GPS block. The public gallery may display only the non-location camera metadata explicitly copied into the manifest. Never expose originals or add original-download links.

After adding or replacing photos: update definitions, run both media commands, inspect the images and alt text in a real browser, then commit only generated derivatives and the manifest.

The generated decorative gull flock is a separate transparent WebP, not a source photograph or gallery record. Its prompt and provenance are in `seagulls-asset.md`; `pnpm media:check` also validates its dimensions, real alpha and absent EXIF. The four local bird-reference crops remain ignored and are never published.
