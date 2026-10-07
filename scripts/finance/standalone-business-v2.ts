import type { CatalogCompany, CompanyV2, PeriodV2 } from "../../src/features/finance/v2-types";
import type { SecFiling } from "./sec-shared";
import {
  prepareOriginalStandaloneBusinessFiling,
  finishOriginalStandaloneBusinessFiling
} from "./standalone-business-state";
export {
  originalStandaloneBusinessRequired,
  prepareOriginalStandaloneBusinessFiling,
  finishOriginalStandaloneBusinessFiling,
  assertOriginalStandaloneBusinessState,
  type PreparedOriginalStandaloneBusiness
} from "./standalone-business-state";

/** Offline and Worker acquisition replay the same preserved table state. */
export async function readOriginalStandaloneBusinessFiling(
  html: string,
  xml: string,
  instanceUrl: string,
  identity: CatalogCompany,
  filing: SecFiling,
  base: CompanyV2 | undefined,
  fresh: PeriodV2[] = []
): Promise<PeriodV2[]> {
  const state = await prepareOriginalStandaloneBusinessFiling(html, identity, filing, base, fresh);
  if (!state) return [];
  return (
    await finishOriginalStandaloneBusinessFiling(
      state,
      xml,
      instanceUrl,
      identity,
      filing,
      base,
      fresh
    )
  ).periods;
}
