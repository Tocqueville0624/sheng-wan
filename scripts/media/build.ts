import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import exifr from "exifr";
import sharp from "sharp";
import { mediaDefinitions, type MediaDefinition } from "./definitions";
import type {
  ImageCandidate,
  MediaManifest,
  PublicExif,
  ResponsiveImage
} from "../../src/types/media";

const root = process.cwd();
const publicRoot = path.join(root, "public", "media");
const manifestPath = path.join(root, "src", "data", "generated", "media.json");
const execFileAsync = promisify(execFile);

type ExifrResult = {
  Make?: string;
  Model?: string;
  LensModel?: string;
  FNumber?: number;
  ExposureTime?: number;
  ISO?: number;
  FocalLength?: number;
  DateTimeOriginal?: Date;
};

function hex(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function formatShutter(value?: number) {
  if (!value) return undefined;
  if (value >= 1) return `${Number(value.toFixed(1))} s`;
  return `1/${Math.round(1 / value)} s`;
}

function displayExif(value?: ExifrResult): PublicExif | undefined {
  if (!value) return undefined;
  const camera = [value.Make, value.Model]
    .filter(Boolean)
    .join(" ")
    .replace(/^NIKON CORPORATION\s*/i, "Nikon ");
  return {
    camera: camera || undefined,
    lens: value.LensModel || undefined,
    focalLength: value.FocalLength ? `${Number(value.FocalLength.toFixed(1))} mm` : undefined,
    aperture: value.FNumber ? `f/${Number(value.FNumber.toFixed(1))}` : undefined,
    shutterSpeed: formatShutter(value.ExposureTime),
    iso: value.ISO ? `ISO ${value.ISO}` : undefined,
    capturedAt: value.DateTimeOriginal?.toISOString().slice(0, 10)
  };
}

async function extractExif(source: string) {
  const result = (await exifr.parse(source, [
    "Make",
    "Model",
    "LensModel",
    "FNumber",
    "ExposureTime",
    "ISO",
    "FocalLength",
    "DateTimeOriginal"
  ])) as ExifrResult | undefined;
  return displayExif(result);
}

async function prepareInput(input: string) {
  if (!/\.hei[cf]$/i.test(input)) {
    return { input, cleanup: async () => undefined };
  }
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "sheng-media-"));
  const converted = path.join(
    temporaryDirectory,
    `${path.basename(input, path.extname(input))}.jpg`
  );
  const binary = process.env.HEIF_CONVERT_BIN ?? "heif-convert";
  await execFileAsync(binary, [input, converted], { maxBuffer: 10 * 1024 * 1024 });
  return {
    input: converted,
    cleanup: () => rm(temporaryDirectory, { recursive: true, force: true })
  };
}

async function processImage(definition: MediaDefinition): Promise<ResponsiveImage> {
  const originalInput = path.join(root, definition.source);
  const prepared = await prepareInput(originalInput);
  const input = prepared.input;
  const outputDirectory = path.join(publicRoot, definition.outputGroup);
  await mkdir(outputDirectory, { recursive: true });
  try {
    const metadata = await sharp(input).metadata();
    const swapsAxis =
      metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    const width = swapsAxis ? metadata.height : metadata.width;
    const height = swapsAxis ? metadata.width : metadata.height;
    if (!width || !height) throw new Error(`Unable to read dimensions for ${definition.source}`);

    const stats = await sharp(input).autoOrient().resize(32, 32, { fit: "inside" }).stats();
    const dominant = stats.dominant;
    const dominantColor = `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
    const placeholderBuffer = await sharp(input)
      .autoOrient()
      .resize(40, 40, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 42, progressive: true })
      .toBuffer();

    const sources: ResponsiveImage["sources"] = { avif: [], webp: [], jpeg: [] };
    const formatOptions = {
      avif: { quality: 58, effort: 5 },
      webp: { quality: 80, effort: 5 },
      jpeg: { quality: 84, progressive: true, mozjpeg: true }
    } as const;

    for (const format of Object.keys(formatOptions) as Array<keyof typeof formatOptions>) {
      const candidates = new Map<number, ImageCandidate>();
      for (const requestedWidth of definition.widths) {
        const targetWidth = Math.min(requestedWidth, width);
        if (candidates.has(targetWidth)) continue;
        const filename = `${definition.id}-${targetWidth}.${format === "jpeg" ? "jpg" : format}`;
        const output = path.join(outputDirectory, filename);
        const pipeline = sharp(input)
          .autoOrient()
          .toColorspace("srgb")
          .resize({ width: targetWidth, withoutEnlargement: true });
        const info = await pipeline[format](formatOptions[format] as never).toFile(output);
        candidates.set(info.width, {
          src: `/media/${definition.outputGroup}/${filename}`,
          width: info.width
        });
      }
      sources[format] = [...candidates.values()].sort((a, b) => a.width - b.width);
    }

    return {
      id: definition.id,
      alt: definition.alt,
      width,
      height,
      aspectRatio: Number((width / height).toFixed(4)),
      dominantColor,
      placeholder: `data:image/jpeg;base64,${Buffer.from(placeholderBuffer).toString("base64")}`,
      sources,
      exif: definition.includeExif ? await extractExif(originalInput) : undefined
    };
  } finally {
    await prepared.cleanup();
  }
}

async function main() {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const results: ResponsiveImage[] = [];
  for (const definition of mediaDefinitions) {
    process.stdout.write(`Processing ${definition.source}... `);
    results.push(await processImage(definition));
    process.stdout.write("done\n");
  }

  const manifest: MediaManifest = {
    generatedAt: new Date().toISOString(),
    home: results.find((image) => image.id === "sheng-portrait")!,
    hugo: results.filter((image) => image.id.startsWith("hugo-")),
    gallery: results.filter(
      (image) => !image.id.startsWith("hugo-") && image.id !== "sheng-portrait"
    )
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Generated ${results.length} image records at ${path.relative(root, manifestPath)}\n`
  );
}

await main();
