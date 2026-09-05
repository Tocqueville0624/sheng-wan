import type { FinanceHistory } from "../../src/features/finance/v2-types";
import { companies } from "./companies";
import { validateV2 } from "./v2-model";

/** A deployment fallback must preserve the reviewed featured-company depth. */
export function validateFeaturedHistory(history: FinanceHistory) {
  if (
    history.schemaVersion !== 2 ||
    !Number.isFinite(Date.parse(history.capturedAt)) ||
    history.companies.length !== companies.length
  )
    throw new Error("Invalid featured history snapshot.");
  for (const identity of companies) {
    const matches = history.companies.filter(
      (c) => c.cik === identity.cik && c.ticker === identity.ticker
    );
    if (matches.length !== 1)
      throw new Error(`Missing or duplicate featured history: ${identity.ticker}.`);
    const company = matches[0];
    validateV2(company);
    if (
      company.annual.length !== 10 ||
      company.quarterly.length !== 20 ||
      company.version === "pending"
    )
      throw new Error(`${identity.ticker}: preserve 10 validated annual and 20 quarterly periods.`);
  }
}
