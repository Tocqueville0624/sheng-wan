import { readFileSync } from "node:fs";
import type { CatalogCompany, PeriodV2 } from "../../../src/features/finance/v2-types";
import type { SecFiling } from "../../../scripts/finance/sec-shared";
export const amdCases = [
  "2026-Q2",
  "2026-Q1",
  "FY2025",
  "2025-Q3",
  "2025-Q2",
  "2025-Q1",
  "FY2024",
  "2024-Q3",
  "2024-Q2",
  "2024-Q1",
  "FY2023",
  "2023-Q3",
  "2023-Q2",
  "2023-Q1",
  "FY2022",
  "2022-Q3",
  "2022-Q2",
  "2022-Q1",
  "FY2021",
  "2021-Q3",
  "2021-Q2",
  "2021-Q1",
  "FY2020",
  "2020-Q3",
  "2020-Q2",
  "2020-Q1",
  "FY2019"
] as const;
export function amdFixture(id: (typeof amdCases)[number]) {
  const stem = `amd-${id.toLowerCase()}-original-primary-business`,
    source = JSON.parse(readFileSync(new URL(`./${stem}.json`, import.meta.url), "utf8")) as {
      filing: SecFiling;
      excerptSha256: string;
      expectedCurrent: PeriodV2;
      retained: { prior: PeriodV2; expected: PeriodV2 }[];
      tableIndexMapping: { originalIndex: number; fixtureIndex: number; tableSha256: string }[];
    },
    html = readFileSync(new URL(`./${stem}.html`, import.meta.url), "utf8"),
    identity: CatalogCompany = {
      ticker: "AMD",
      name: "Advanced Micro Devices",
      cik: "0000002488",
      sector: "Information Technology",
      universe: "sp500"
    };
  return { source, html, identity };
}
