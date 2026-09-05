import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { crawlOfficialManifest } from "./crawl";
import { refreshSnapshot } from "./refresh";
import { assertPublishableManifest } from "./validate";
import type { FinanceManifest } from "../../src/features/finance/types";

const output = path.join(process.cwd(), "src/data/generated/finance.json");

async function publish(manifest: FinanceManifest, previous: FinanceManifest | undefined) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const namespace = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !namespace || !token)
    throw new Error(
      "Cloudflare publish requires account, namespace, and API token environment variables."
    );
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}/values`;
  const put = async (key: string, value: unknown) => {
    const response = await fetch(`${base}/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(value)
    });
    if (!response.ok) throw new Error(`KV write ${key} returned HTTP ${response.status}.`);
  };
  const live = await fetch(`${base}/finance%3Acurrent`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  let rollback: FinanceManifest | undefined;
  if (live.ok) {
    const candidate = (await live.json()) as FinanceManifest;
    try {
      assertPublishableManifest(candidate);
      rollback = candidate;
    } catch {
      // A legacy invalid current value is not a safe rollback; retain any existing previous.
    }
  } else if (live.status === 404) {
    if (previous) {
      try {
        assertPublishableManifest(previous);
        rollback = previous;
      } catch {
        /* first verified publish */
      }
    }
  } else throw new Error(`KV current snapshot read returned HTTP ${live.status}.`);
  await put(`finance:version:${manifest.version}`, manifest);
  if (rollback) await put("finance:previous", rollback);
  await put("finance:current", manifest);
}

try {
  let previous: FinanceManifest | undefined;
  try {
    previous = JSON.parse(await readFile(output, "utf8")) as FinanceManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const manifest = await refreshSnapshot(
    previous,
    async () => {
      if (process.argv.includes("--curated"))
        throw new Error("Manual overlay is disabled: use the automatic SEC crawler.");
      const next = await crawlOfficialManifest();
      const digest = createHash("sha256")
        .update(JSON.stringify(next.companies))
        .digest("hex")
        .slice(0, 12);
      next.updatedAt = new Date().toISOString();
      next.version = `${next.updatedAt.slice(0, 10)}-${digest}`;
      for (const company of next.companies) company.version = next.version;
      assertPublishableManifest(next);
      return next;
    },
    async (next, prior) => {
      if (process.argv.includes("--publish")) await publish(next, prior);
      await mkdir(path.dirname(output), { recursive: true });
      const temporary = `${output}.${process.pid}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        await rename(temporary, output);
      } finally {
        await rm(temporary, { force: true });
      }
    }
  );
  process.stdout.write(`Validated finance snapshot ${manifest.version}.\n`);
} catch (error) {
  process.stderr.write(
    `Finance refresh withheld: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
