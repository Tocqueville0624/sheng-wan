import type { DardenBusinessProfile } from "./darden-source";

/** Finite original header and declared scope variants. No financial values or
 * brand-level allocations are defined here; original aggregate names remain. */
export const dardenBusinessProfiles: DardenBusinessProfile[] = [
  {
    id: "dri-original-business-1",
    rows: [
      {
        label: "Olive Garden",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "dri:OliveGardenSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "LongHorn Steakhouse",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "dri:LongHornSteakhouseSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Fine Dining",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "dri:FineDiningSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Other Business",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Corporate",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Consolidated",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ]
  },
  {
    id: "dri-original-business-2",
    rows: [
      {
        label: "Olive Garden 1",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "dri:OliveGardenSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "LongHorn Steakhouse",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "dri:LongHornSteakhouseSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Fine Dining",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "dri:FineDiningSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Other Business",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Corporate",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Consolidated",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ]
  },
  {
    id: "dri-original-business-3",
    rows: [
      {
        label: "Olive Garden",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:OliveGardenSegmentMember"
        }
      },
      {
        label: "LongHorn Steakhouse",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:LongHornSteakhouseSegmentMember"
        }
      },
      {
        label: "Fine Dining",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:FineDiningSegmentMember"
        }
      },
      {
        label: "Other Business 1",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Corporate",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Consolidated",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ]
  },
  {
    id: "dri-original-business-4",
    rows: [
      {
        label: "Olive Garden",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:OliveGardenSegmentMember"
        }
      },
      {
        label: "LongHorn Steakhouse",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:LongHornSteakhouseSegmentMember"
        }
      },
      {
        label: "Fine Dining 2",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:FineDiningSegmentMember"
        }
      },
      {
        label: "Other Business",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Corporate",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Consolidated",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ]
  },
  {
    id: "dri-original-business-5",
    rows: [
      {
        label: "Olive Garden",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:OliveGardenSegmentMember"
        }
      },
      {
        label: "LongHorn Steakhouse",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:LongHornSteakhouseSegmentMember"
        }
      },
      {
        label: "Fine Dining 1",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:FineDiningSegmentMember"
        }
      },
      {
        label: "Other Business",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Corporate",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Consolidated",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ]
  },
  {
    id: "dri-original-business-6",
    rows: [
      {
        label: "Olive Garden",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:OliveGardenMember"
        }
      },
      {
        label: "LongHorn Steakhouse",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:LonghornSteakhouseMember"
        }
      },
      {
        label: "Fine Dining",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "dri:FineDiningSegmentMember"
        }
      },
      {
        label: "Other Business",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Corporate",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Consolidated",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ]
  }
];
