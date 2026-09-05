import type { FinanceManifest } from "../../src/features/finance/types";
import { assertNoVerifiedDowngrade } from "./merge";
import { validateManifest } from "./validate";

// The only write callback runs after all fetching, extraction and validation succeed.
export async function refreshSnapshot(
  previous: FinanceManifest | undefined,
  build: () => Promise<FinanceManifest>,
  persist: (next: FinanceManifest, previous: FinanceManifest | undefined) => Promise<void>
) {
  const next = await build();
  validateManifest(next);
  assertNoVerifiedDowngrade(previous, next);
  await persist(next, previous);
  return next;
}
