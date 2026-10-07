import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { readdirSync } from "node:fs";
import assert from "node:assert/strict";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const explicitProject = args.some((arg) => /^--project(?:=|$)/.test(arg));
const explicitOutput = args.some((arg) => /^--output(?:=|$)/.test(arg));

type ListedSpec = { title: string; id: string };
type ListedSuite = { specs?: ListedSpec[]; suites?: ListedSuite[] };

const list = (options: string[]): ListedSuite[] => {
  const result = spawnSync(
    process.execPath,
    [cli, "test", ...options, "--list", "--reporter=json"],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    }
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || "Could not enumerate browser tests");
  return (JSON.parse(result.stdout) as { suites: ListedSuite[] }).suites;
};

const batches = (options: string[]) => {
  const suites = list(options);
  // Nested suites can share ordered setup or serial dependencies. Keep them
  // together; only partition independent top-level cases by their listed IDs.
  if (suites.some((suite) => suite.suites?.length)) return [{ grep: undefined, suffix: "" }];
  const specs = suites.flatMap((suite) => suite.specs ?? []);
  if (specs.length <= 16) return [{ grep: undefined, suffix: "" }];
  assert.equal(new Set(specs.map((spec) => spec.title)).size, specs.length);
  const planned: { grep: string; suffix: string }[] = [];
  const selectedIds: string[] = [];
  for (let start = 0; start < specs.length; start += 16) {
    const group = specs.slice(start, start + 16);
    const titles = group.map((spec) => spec.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const grep = `(?:^|\\s)(?:${titles.join("|")})$`;
    const selected = list([...options, `--grep=${grep}`]).flatMap((suite) => suite.specs ?? []);
    assert.deepEqual(
      selected.map((spec) => spec.id),
      group.map((spec) => spec.id)
    );
    selectedIds.push(...selected.map((spec) => spec.id));
    planned.push({ grep, suffix: `/batch-${planned.length + 1}` });
  }
  assert.deepEqual(
    selectedIds,
    specs.map((spec) => spec.id),
    "Browser batches changed test coverage"
  );
  return planned;
};

const run = (options: string[], logs?: string) => {
  const result = spawnSync(process.execPath, [cli, "test", ...options], {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(logs ? { WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? logs } : {})
    }
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

if (process.env.CI && !explicitProject) {
  // A project-long Worker can lose its proxy connection after successive heavy
  // export fixtures. Isolate each suite and viewport in a fresh server process;
  // keep every test, one browser worker, and all failure evidence. A failed suite
  // still fails the run immediately; this is not a retry of failed assertions.
  const suites = args.length
    ? [undefined]
    : readdirSync("tests/e2e")
        .filter((name) => /\.spec\.ts$/.test(name))
        .sort();
  for (const project of ["desktop", "mobile"]) {
    for (const suite of suites) {
      const options = [...(suite ? [`tests/e2e/${suite}`] : []), ...args, `--project=${project}`];
      for (const batch of suite ? batches(options) : [{ grep: undefined, suffix: "" }]) {
        const status = run(
          [
            ...options,
            ...(batch.grep ? [`--grep=${batch.grep}`] : []),
            ...(!explicitOutput
              ? [
                  `--output=test-results/${project}${suite ? "/" + suite.replace(/\.spec\.ts$/, "") : ""}${batch.suffix}`
                ]
              : [])
          ],
          path.resolve("test-results/browser-server-logs")
        );
        if (status) process.exit(status);
      }
    }
  }
} else {
  process.exitCode = run(args);
}
