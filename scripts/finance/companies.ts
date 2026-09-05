export type CompanyConfig = {
  ticker: string;
  name: string;
  cik: string;
  accent: string;
  reportingCurrency: "USD" | "TWD";
  taxonomy: "us-gaap" | "ifrs-full";
  fiscalYearEndMonth: number;
};

export const companies: CompanyConfig[] = [
  {
    ticker: "AAPL",
    fiscalYearEndMonth: 9,
    name: "Apple",
    cik: "0000320193",
    accent: "#607d8b",
    reportingCurrency: "USD",
    taxonomy: "us-gaap"
  },
  {
    ticker: "MSFT",
    fiscalYearEndMonth: 6,
    name: "Microsoft",
    cik: "0000789019",
    accent: "#4f8fba",
    reportingCurrency: "USD",
    taxonomy: "us-gaap"
  },
  {
    ticker: "GOOGL",
    fiscalYearEndMonth: 12,
    name: "Alphabet",
    cik: "0001652044",
    accent: "#6b8fc9",
    reportingCurrency: "USD",
    taxonomy: "us-gaap"
  },
  {
    ticker: "AMZN",
    fiscalYearEndMonth: 12,
    name: "Amazon",
    cik: "0001018724",
    accent: "#8a7c65",
    reportingCurrency: "USD",
    taxonomy: "us-gaap"
  },
  {
    ticker: "META",
    fiscalYearEndMonth: 12,
    name: "Meta",
    cik: "0001326801",
    accent: "#497fa6",
    reportingCurrency: "USD",
    taxonomy: "us-gaap"
  },
  {
    ticker: "NVDA",
    fiscalYearEndMonth: 1,
    name: "NVIDIA",
    cik: "0001045810",
    accent: "#71834f",
    reportingCurrency: "USD",
    taxonomy: "us-gaap"
  },
  {
    ticker: "TSM",
    fiscalYearEndMonth: 12,
    name: "TSMC",
    cik: "0001046179",
    accent: "#8a6c9a",
    reportingCurrency: "TWD",
    taxonomy: "ifrs-full"
  }
];
