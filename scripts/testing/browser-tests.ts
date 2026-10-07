import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { readdirSync } from "node:fs";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const explicitProject = args.some((arg) => /^--project(?:=|$)/.test(arg));
const explicitOutput = args.some((arg) => /^--output(?:=|$)/.test(arg));

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
      const status = run(
        [
          ...(suite ? [`tests/e2e/${suite}`] : []),
          ...args,
          `--project=${project}`,
          ...(!explicitOutput
            ? [
                `--output=test-results/${project}${suite ? "/" + suite.replace(/\.spec\.ts$/, "") : ""}`
              ]
            : [])
        ],
        path.resolve("test-results/browser-server-logs")
      );
      if (status) process.exit(status);
    }
  }
} else {
  process.exitCode = run(args);
}
