import type { FinancialMetrics } from "../../src/features/finance/types";

export type DimensionRule = {
  tag: string;
  dimensions: Record<string, string>;
};

export type SegmentRule = DimensionRule & {
  id: string;
  label: string;
  alternatives?: DimensionRule[];
};

export type FilingAdapter = {
  ticker: string;
  annualUrls: string[];
  quarterlyUrls?: string[];
  segments: SegmentRule[];
  segmentAlternatives?: { segments: SegmentRule[]; segmentBasis: string }[];
  adjustments?: SegmentRule[];
  segmentBasis: string;
  metricTags?: Partial<Record<keyof FinancialMetrics, string[]>>;
  operatingExpenseDetails?: (SegmentRule & { multiplier?: 1 | -1 })[];
};

const contractRevenue = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
const businessAxis = "us-gaap:StatementBusinessSegmentsAxis";
const productAxis = "srt:ProductOrServiceAxis";

/**
 * Reviewed, exact-dimensional mappings from the linked SEC filings. These are
 * extraction rules, not financial values. A missing member must fail closed;
 * subtotal and leaf contexts must never be combined into the same stack.
 */
export const filingAdapters: Record<string, FilingAdapter> = {
  AAPL: {
    ticker: "AAPL",
    annualUrls: [
      "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm"
    ],
    segmentBasis: "Net sales by product and service category, not geographic reportable segments.",
    segments: [
      {
        id: "iphone",
        label: "iPhone",
        tag: contractRevenue,
        dimensions: { [productAxis]: "aapl:IPhoneMember" }
      },
      {
        id: "mac",
        label: "Mac",
        tag: contractRevenue,
        dimensions: { [productAxis]: "aapl:MacMember" }
      },
      {
        id: "ipad",
        label: "iPad",
        tag: contractRevenue,
        dimensions: { [productAxis]: "aapl:IPadMember" }
      },
      {
        id: "wearables-home-accessories",
        label: "Wearables, Home and Accessories",
        tag: contractRevenue,
        dimensions: { [productAxis]: "aapl:WearablesHomeandAccessoriesMember" }
      },
      {
        id: "services",
        label: "Services",
        tag: contractRevenue,
        dimensions: { [productAxis]: "us-gaap:ServiceMember" }
      }
    ]
  },
  MSFT: {
    ticker: "MSFT",
    annualUrls: [
      "https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft-20260630.htm"
    ],
    segmentBasis:
      "Revenue by reportable operating segment; comparative periods use the classification in the cited filing.",
    segments: [
      {
        id: "productivity",
        label: "Productivity & Business Processes",
        tag: contractRevenue,
        dimensions: { [businessAxis]: "msft:ProductivityAndBusinessProcessesMember" }
      },
      {
        id: "intelligent-cloud",
        label: "Intelligent Cloud",
        tag: contractRevenue,
        dimensions: { [businessAxis]: "msft:IntelligentCloudMember" }
      },
      {
        id: "personal-computing",
        label: "More Personal Computing",
        tag: contractRevenue,
        dimensions: { [businessAxis]: "msft:MorePersonalComputingMember" }
      }
    ]
  },
  GOOGL: {
    ticker: "GOOGL",
    annualUrls: [
      "https://www.sec.gov/Archives/edgar/data/1652044/000165204426000018/goog-20251231.htm"
    ],
    segmentBasis:
      "Disaggregated Google Services revenue plus Google Cloud and Other Bets; consolidated hedging gains or losses are reported separately, not assigned to a business.",
    metricTags: { revenue: ["us-gaap:Revenues"] },
    segments: [
      {
        id: "search",
        label: "Google Search & other",
        tag: contractRevenue,
        dimensions: {
          [businessAxis]: "goog:GoogleServicesMember",
          [productAxis]: "goog:GoogleSearchOtherMember"
        }
      },
      {
        id: "youtube",
        label: "YouTube ads",
        tag: contractRevenue,
        dimensions: {
          [businessAxis]: "goog:GoogleServicesMember",
          [productAxis]: "goog:YouTubeAdvertisingRevenueMember"
        }
      },
      {
        id: "network",
        label: "Google Network",
        tag: contractRevenue,
        dimensions: {
          [businessAxis]: "goog:GoogleServicesMember",
          [productAxis]: "goog:GoogleNetworkMember"
        }
      },
      {
        id: "subscriptions-platforms-devices",
        label: "Subscriptions, platforms & devices",
        tag: contractRevenue,
        dimensions: {
          [businessAxis]: "goog:GoogleServicesMember",
          [productAxis]: "goog:SubscriptionsPlatformsAndDevicesRevenueMember"
        }
      },
      {
        id: "cloud",
        label: "Google Cloud",
        tag: contractRevenue,
        dimensions: { [businessAxis]: "goog:GoogleCloudMember" }
      },
      {
        id: "other-bets",
        label: "Other Bets",
        tag: contractRevenue,
        dimensions: { [businessAxis]: "us-gaap:AllOtherSegmentsMember" }
      }
    ],
    adjustments: [
      {
        id: "hedging",
        label: "Hedging gains (losses)",
        tag: "us-gaap:RevenueNotFromContractWithCustomer",
        dimensions: {}
      }
    ]
  },
  AMZN: {
    ticker: "AMZN",
    annualUrls: [
      "https://www.sec.gov/Archives/edgar/data/1018724/000101872426000004/amzn-20251231.htm"
    ],
    segmentBasis:
      "Net sales by product and service group, not geographic reportable operating segments.",
    operatingExpenseDetails: [
      { id: "fulfillment", label: "Fulfillment", tag: "amzn:FulfillmentExpense", dimensions: {} },
      {
        id: "technology-infrastructure",
        label: "Technology and infrastructure",
        tag: "amzn:TechnologyAndInfrastructureExpense",
        dimensions: {}
      },
      {
        id: "sales-marketing",
        label: "Sales and marketing",
        tag: "us-gaap:MarketingExpense",
        dimensions: {}
      },
      {
        id: "general-administrative",
        label: "General and administrative",
        tag: "us-gaap:GeneralAndAdministrativeExpense",
        dimensions: {}
      },
      {
        id: "other-operating-expense",
        label: "Other operating expenses, net",
        tag: "us-gaap:OtherOperatingIncomeExpenseNet",
        dimensions: {},
        multiplier: -1
      }
    ],
    segments: [
      {
        id: "online-stores",
        label: "Online stores",
        tag: contractRevenue,
        dimensions: { [productAxis]: "amzn:OnlineStoresMember" }
      },
      {
        id: "physical-stores",
        label: "Physical stores",
        tag: contractRevenue,
        dimensions: { [productAxis]: "amzn:PhysicalStoresMember" }
      },
      {
        id: "seller-services",
        label: "Third-party seller services",
        tag: contractRevenue,
        dimensions: { [productAxis]: "amzn:ThirdPartySellerServicesMember" }
      },
      {
        id: "advertising",
        label: "Advertising services",
        tag: contractRevenue,
        dimensions: { [productAxis]: "us-gaap:AdvertisingMember" },
        alternatives: [
          { tag: contractRevenue, dimensions: { [productAxis]: "amzn:AdvertisingServicesMember" } }
        ]
      },
      {
        id: "subscriptions",
        label: "Subscription services",
        tag: contractRevenue,
        dimensions: { [productAxis]: "amzn:SubscriptionServicesMember" }
      },
      {
        id: "aws",
        label: "AWS",
        tag: contractRevenue,
        dimensions: { [productAxis]: "amzn:AmazonWebServicesMember" }
      },
      {
        id: "other",
        label: "Other",
        tag: contractRevenue,
        dimensions: { [productAxis]: "amzn:OtherServicesMember" }
      }
    ]
  },
  META: {
    ticker: "META",
    annualUrls: [
      "https://www.sec.gov/Archives/edgar/data/1326801/000162828026003942/meta-20251231.htm"
    ],
    segmentBasis: "Revenue by reportable operating segment: Family of Apps and Reality Labs.",
    segments: [
      {
        id: "family-of-apps",
        label: "Family of Apps",
        tag: contractRevenue,
        dimensions: { [businessAxis]: "meta:FamilyOfAppsMember" }
      },
      {
        id: "reality-labs",
        label: "Reality Labs",
        tag: contractRevenue,
        dimensions: { [businessAxis]: "meta:RealityLabsMember" }
      }
    ]
  },
  NVDA: {
    ticker: "NVDA",
    annualUrls: [
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm"
    ],
    quarterlyUrls: [
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000230/nvda-20251026.htm"
    ],
    segmentBasis:
      "Revenue by specialized market; Data Center includes Compute and Networking, which are not counted again as separate categories.",
    metricTags: { revenue: ["us-gaap:Revenues"] },
    segmentAlternatives: [
      {
        segmentBasis:
          "Revenue by specialized market under the FY2027 classification: Data Center and Edge Computing. Older annual filings use the prior Gaming/Professional Visualization/Automotive/OEM classification; those categories are not assumed comparable to Edge Computing.",
        segments: [
          {
            id: "data-center",
            label: "Data Center",
            tag: "us-gaap:Revenues",
            dimensions: { [productAxis]: "nvda:DataCenterMember" }
          },
          {
            id: "edge-computing",
            label: "Edge Computing",
            tag: "us-gaap:Revenues",
            dimensions: { [productAxis]: "nvda:EdgeComputingMember" }
          }
        ]
      }
    ],
    segments: [
      {
        id: "data-center",
        label: "Data Center",
        tag: "us-gaap:Revenues",
        dimensions: { [productAxis]: "nvda:DataCenterMember" }
      },
      {
        id: "gaming",
        label: "Gaming",
        tag: "us-gaap:Revenues",
        dimensions: { [productAxis]: "nvda:GamingMember" }
      },
      {
        id: "professional-visualization",
        label: "Professional Visualization",
        tag: "us-gaap:Revenues",
        dimensions: { [productAxis]: "nvda:ProfessionalVisualizationMember" }
      },
      {
        id: "automotive",
        label: "Automotive",
        tag: "us-gaap:Revenues",
        dimensions: { [productAxis]: "nvda:AutomotiveMember" }
      },
      {
        id: "oem-other",
        label: "OEM & other",
        tag: "us-gaap:Revenues",
        dimensions: { [productAxis]: "nvda:OEMAndOtherMember" }
      }
    ]
  },
  TSM: {
    ticker: "TSM",
    annualUrls: [
      "https://www.sec.gov/Archives/edgar/data/1046179/000162828026025362/tsm-20251231.htm"
    ],
    quarterlyUrls: [
      "https://www.sec.gov/Archives/edgar/data/1046179/000104617926000541/a2026q2consolidatedreport-.htm",
      "https://www.sec.gov/Archives/edgar/data/1046179/000104617926000278/a2026q1consolidatedreport-.htm",
      "https://www.sec.gov/Archives/edgar/data/1046179/000104617925000128/a2025q3consolidatedreport-.htm"
    ],
    segmentBasis:
      "Revenue by customer platform, as reported in native TWD; the same period-average exchange rate is applied to total revenue and every category. These are not separate reportable operating segments.",
    metricTags: {
      revenue: ["ifrs-full:RevenueFromContractsWithCustomers"],
      costOfRevenue: ["ifrs-full:CostOfSales"],
      grossProfit: ["ifrs-full:GrossProfit"],
      operatingIncome: ["ifrs-full:ProfitLossFromOperatingActivities"],
      pretaxIncome: ["ifrs-full:ProfitLossBeforeTax"],
      incomeTax: ["ifrs-full:IncomeTaxExpenseContinuingOperations"],
      netIncome: ["ifrs-full:ProfitLoss"],
      researchAndDevelopment: ["ifrs-full:ResearchAndDevelopmentExpense"]
    },
    segments: [
      {
        id: "high-performance-computing",
        label: "High-performance computing",
        tag: "ifrs-full:RevenueFromContractsWithCustomers",
        dimensions: { "ifrs-full:MarketsOfCustomersAxis": "tsm:HighPerformanceComputingMember" }
      },
      {
        id: "smartphone",
        label: "Smartphone",
        tag: "ifrs-full:RevenueFromContractsWithCustomers",
        dimensions: { "ifrs-full:MarketsOfCustomersAxis": "tsm:SmartphoneMember" }
      },
      {
        id: "internet-of-things",
        label: "Internet of Things",
        tag: "ifrs-full:RevenueFromContractsWithCustomers",
        dimensions: { "ifrs-full:MarketsOfCustomersAxis": "tsm:InternetOfThingsMember" }
      },
      {
        id: "automotive",
        label: "Automotive",
        tag: "ifrs-full:RevenueFromContractsWithCustomers",
        dimensions: { "ifrs-full:MarketsOfCustomersAxis": "tsm:AutomotiveMember" }
      },
      {
        id: "digital-consumer-electronics",
        label: "Digital consumer electronics",
        tag: "ifrs-full:RevenueFromContractsWithCustomers",
        dimensions: { "ifrs-full:MarketsOfCustomersAxis": "tsm:DigitalConsumerElectronicsMember" }
      },
      {
        id: "other",
        label: "Other",
        tag: "ifrs-full:RevenueFromContractsWithCustomers",
        dimensions: { "ifrs-full:MarketsOfCustomersAxis": "tsm:OtherMember" }
      }
    ]
  }
};
