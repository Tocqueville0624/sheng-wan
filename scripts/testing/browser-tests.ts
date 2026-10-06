import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const args = process.argv.slice(2);
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
  // Long Linux runs have lost the shared local Worker during viewport checks.
  // Keep every test and the single browser worker, but give each project a fresh
  // server process. Separate output directories preserve both sets of evidence.
  for (const project of ["desktop", "mobile"]) {
    const status = run(
      [
        ...args,
        `--project=${project}`,
        ...(!explicitOutput ? [`--output=test-results/${project}`] : [])
      ],
      path.resolve("test-results/browser-server-logs")
    );
    if (status) process.exit(status);
  }
} else {
  process.exitCode = run(args);
}
