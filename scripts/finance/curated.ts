import { companies } from "./companies";
import { validateCompany } from "./validate";
import type {
  CompanyDataset,
  FinancialMetrics,
  FinancialPeriod,
  RevenueSegment
} from "../../src/features/finance/types";

// Transcribed from page 1 of Apple's published GAAP financial statements.
// All source amounts are USD millions. No category weights are inferred.
// Keep the numeric rows in the source's order so another reviewer can audit them.
const sources = {
  fy24q4: {
    url: "https://www.apple.com/newsroom/pdfs/fy2024-q4/FY24_Q4_Consolidated_Financial_Statements.pdf#page=1",
    published: "2024-10-31"
  },
  fy25q4: {
    url: "https://www.apple.com/newsroom/pdfs/fy2025-q4/FY25_Q4_Consolidated_Financial_Statements.pdf#page=1",
    published: "2025-10-30"
  },
  fy26q1: {
    url: "https://www.apple.com/newsroom/pdfs/fy2026-q1/FY26_Q1_Consolidated_Financial_Statements.pdf#page=1",
    published: "2026-01-29"
  },
  fy26q2: {
    url: "https://www.apple.com/newsroom/pdfs/fy2026q2/FY26_Q2_Consolidated_Financial_Statements.pdf#page=1",
    published: "2026-04-30"
  },
  fy26q3: {
    url: "https://images.apple.com/newsroom/pdfs/fy2026q3/FY26_Q3_Consolidated_Financial_Statements.pdf#page=1",
    published: "2026-07-30"
  }
} as const;

type Source = keyof typeof sources;
type MetricRow = [number, number, number, number, number, number, number, number, number, number];
type CategoryRow = [number, number, number, number, number];
type SourceRow = {
  year: number;
  quarter?: 1 | 2 | 3 | 4;
  start: string;
  end: string;
  source: Source;
  // Revenue, cost, gross profit, opex, operating profit, pretax, tax, net profit, R&D, SG&A.
  metrics: MetricRow;
  // iPhone, Mac, iPad, Wearables/Home/Accessories, Services.
  categories: CategoryRow;
};

const rows: SourceRow[] = [
  {
    year: 2023,
    start: "2022-10-02",
    end: "2023-09-30",
    source: "fy24q4",
    metrics: [383285, 214137, 169148, 54847, 114301, 113736, 16741, 96995, 29915, 24932],
    categories: [200583, 29357, 28300, 39845, 85200]
  },
  {
    year: 2024,
    start: "2023-10-01",
    end: "2024-09-28",
    source: "fy25q4",
    metrics: [391035, 210352, 180683, 57467, 123216, 123485, 29749, 93736, 31370, 26097],
    categories: [201183, 29984, 26694, 37005, 96169]
  },
  {
    year: 2025,
    start: "2024-09-29",
    end: "2025-09-27",
    source: "fy25q4",
    metrics: [416161, 220960, 195201, 62151, 133050, 132729, 20719, 112010, 34550, 27601],
    categories: [209586, 33708, 28023, 35686, 109158]
  },
  {
    year: 2024,
    quarter: 4,
    start: "2024-06-30",
    end: "2024-09-28",
    source: "fy25q4",
    metrics: [94930, 51051, 43879, 14288, 29591, 29610, 14874, 14736, 7765, 6523],
    categories: [46222, 7744, 6950, 9042, 24972]
  },
  {
    year: 2025,
    quarter: 1,
    start: "2024-09-29",
    end: "2024-12-28",
    source: "fy26q1",
    metrics: [124300, 66025, 58275, 15443, 42832, 42584, 6254, 36330, 8268, 7175],
    categories: [69138, 8987, 8088, 11747, 26340]
  },
  {
    year: 2025,
    quarter: 2,
    start: "2024-12-29",
    end: "2025-03-29",
    source: "fy26q2",
    metrics: [95359, 50492, 44867, 15278, 29589, 29310, 4530, 24780, 8550, 6728],
    categories: [46841, 7949, 6402, 7522, 26645]
  },
  {
    year: 2025,
    quarter: 3,
    start: "2025-03-30",
    end: "2025-06-28",
    source: "fy26q3",
    metrics: [94036, 50318, 43718, 15516, 28202, 28031, 4597, 23434, 8866, 6650],
    categories: [44582, 8046, 6581, 7404, 27423]
  },
  {
    year: 2025,
    quarter: 4,
    start: "2025-06-29",
    end: "2025-09-27",
    source: "fy25q4",
    metrics: [102466, 54125, 48341, 15914, 32427, 32804, 5338, 27466, 8866, 7048],
    categories: [49025, 8726, 6952, 9013, 28750]
  },
  {
    year: 2026,
    quarter: 1,
    start: "2025-09-28",
    end: "2025-12-27",
    source: "fy26q1",
    metrics: [143756, 74525, 69231, 18379, 50852, 51002, 8905, 42097, 10887, 7492],
    categories: [85269, 8386, 8595, 11493, 30013]
  },
  {
    year: 2026,
    quarter: 2,
    start: "2025-12-28",
    end: "2026-03-28",
    source: "fy26q2",
    metrics: [111184, 56403, 54781, 18896, 35885, 35833, 6255, 29578, 11419, 7477],
    categories: [56994, 8399, 6914, 7901, 30976]
  },
  {
    year: 2026,
    quarter: 3,
    start: "2026-03-29",
    end: "2026-06-27",
    source: "fy26q3",
    metrics: [109417, 54647, 54770, 19075, 35695, 36267, 6478, 29789, 11729, 7346],
    categories: [54252, 10352, 6191, 7883, 30739]
  }
];

const metricKeys: (keyof FinancialMetrics)[] = [
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "operatingExpenses",
  "operatingIncome",
  "pretaxIncome",
  "incomeTax",
  "netIncome",
  "researchAndDevelopment",
  "sellingGeneralAndAdministrative"
];
const categories = [
  ["iphone", "iPhone"],
  ["mac", "Mac"],
  ["ipad", "iPad"],
  ["wearables-home-accessories", "Wearables, Home and Accessories"],
  ["services", "Services"]
] as const;

function period(row: SourceRow): FinancialPeriod {
  const source = sources[row.source];
  return {
    id: row.quarter ? `${row.year}-Q${row.quarter}` : `FY${row.year}`,
    label: row.quarter ? `Q${row.quarter} FY${row.year}` : `FY ${row.year}`,
    kind: row.quarter ? "quarterly" : "annual",
    fiscalYear: row.year,
    fiscalQuarter: row.quarter,
    startDate: row.start,
    endDate: row.end,
    // For earnings releases, this is the publication date of the cited statement.
    filedAt: source.published,
    sourceUrl: source.url,
    reportingCurrency: "USD",
    displayCurrency: "USD",
    derived: false,
    metrics: Object.fromEntries(
      metricKeys.map((key, index) => [key, row.metrics[index] * 1_000_000])
    ) as FinancialMetrics,
    segments: categories.map(([id, label], index): RevenueSegment => ({
      id,
      label,
      revenue: row.categories[index] * 1_000_000
    })),
    segmentSourceUrl: source.url,
    segmentBasis: "Net sales by product and service category (not geographic reportable segments)."
  };
}

export function curatedAppleDataset(): CompanyDataset {
  const apple = companies.find((company) => company.ticker === "AAPL")!;
  const periods = rows.map(period);
  const dataset: CompanyDataset = {
    schemaVersion: 1,
    version: "apple-gaap-reviewed-2026-09-01",
    ticker: apple.ticker,
    name: apple.name,
    cik: apple.cik,
    accent: apple.accent,
    reportingCurrency: "USD",
    latestPeriod: "Q3 FY2026",
    dataStatus: "verified",
    updatedAt: "2026-09-01T00:00:00.000Z",
    note: "Source-checked GAAP figures from Apple financial statements: FY 2023–2025 and Q4 2024–Q3 2026. Product/service categories are not Apple's geographic reportable segments. Statement PDFs are unaudited earnings releases. FY 2024 and Q4 2024 retain the reported one-time income tax charge; no non-GAAP adjustment is made.",
    annual: periods.filter((entry) => entry.kind === "annual"),
    quarterly: periods.filter((entry) => entry.kind === "quarterly")
  };
  validateCompany(dataset);
  return dataset;
}

export const curatedDatasets = () => [curatedAppleDataset()];
