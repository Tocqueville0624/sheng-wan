import type { AmdBusinessProfile } from "./amd-types";

/** Original finite classifications only. Parent subtotals corroborate leaves;
 * no amounts, invented business names or future-schema guesses are encoded. */
export const amdBusinessProfiles: AmdBusinessProfile[] = [
  {
    id: "amd-original-business-1",
    rows: [
      {
        label: "Data Center",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:DataCenterMember"
        }
      },
      {
        label: "Client",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ProductOrServiceAxis": "amd:ClientMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ClientAndGamingMember"
        }
      },
      {
        label: "Gaming",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ProductOrServiceAxis": "amd:GamingMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ClientAndGamingMember"
        }
      },
      {
        label: "Total Client and Gaming",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ClientAndGamingMember"
        }
      },
      {
        label: "Embedded",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EmbeddedMember"
        }
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: false,
    parent: {
      label: "Total Client and Gaming",
      children: ["Client", "Gaming"]
    }
  },
  {
    id: "amd-original-business-2",
    rows: [
      {
        label: "Data Center",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:DatacenterMember"
        }
      },
      {
        label: "Client",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ProductOrServiceAxis": "amd:ClientMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ClientAndGamingMember"
        }
      },
      {
        label: "Gaming",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ProductOrServiceAxis": "amd:GamingMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:GamingMember"
        }
      },
      {
        label: "Total Client and Gaming",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ClientAndGamingMember"
        }
      },
      {
        label: "Embedded",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EmbeddedMember"
        }
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: false,
    parent: {
      label: "Total Client and Gaming",
      children: ["Client", "Gaming"]
    }
  },
  {
    id: "amd-original-business-3",
    rows: [
      {
        label: "Data Center",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:DatacenterMember"
        }
      },
      {
        label: "Client",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ClientMember"
        }
      },
      {
        label: "Gaming",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:GamingMember"
        }
      },
      {
        label: "Embedded",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EmbeddedMember"
        }
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: false
  },
  {
    id: "amd-original-business-4",
    rows: [
      {
        label: "Data Center",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ClientMember"
        }
      },
      {
        label: "Client",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:GamingMember"
        }
      },
      {
        label: "Gaming",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:DataCenterMember"
        }
      },
      {
        label: "Embedded",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EmbeddedMember"
        }
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: true
  },
  {
    id: "amd-original-business-5",
    rows: [
      {
        label: "Data Center",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:DataCenterMember"
        }
      },
      {
        label: "Client",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ClientMember"
        }
      },
      {
        label: "Gaming",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:GamingMember"
        }
      },
      {
        label: "Embedded",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EmbeddedMember"
        }
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: false
  },
  {
    id: "amd-original-business-6",
    rows: [
      {
        label: "Computing and Graphics",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ComputingandGraphicsMember"
        }
      },
      {
        label: "Enterprise, Embedded and Semi-Custom",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EnterpriseEmbeddedAndSemiCustomsMember"
        }
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: false
  },
  {
    id: "amd-original-business-7",
    rows: [
      {
        label: "Computing and Graphics",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ComputingandGraphicsMember"
        }
      },
      {
        label: "Enterprise, Embedded and Semi-Custom",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EnterpriseEmbeddedandSemiCustomMember"
        }
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: false
  },
  {
    id: "amd-original-business-8",
    rows: [
      {
        label: "Computing and Graphics",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ComputingandGraphicsMember"
        }
      },
      {
        label: "Enterprise, Embedded and Semi-Custom",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EnterpriseEmbeddedandSemiCustomMember"
        }
      },
      {
        label: "Xilinx",
        tag: "us-gaap:BusinessCombinationProFormaInformationRevenueOfAcquireeSinceAcquisitionDateActual",
        dimensions: {}
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: false
  },
  {
    id: "amd-original-business-9",
    rows: [
      {
        label: "Computing and Graphics",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:ComputingandGraphicsMember"
        }
      },
      {
        label: "Enterprise, Embedded and Semi-Custom",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:EnterpriseEmbeddedandSemiCustomMember"
        }
      },
      {
        label: "Xilinx",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "amd:XilinxMember"
        }
      },
      {
        label: "Total net revenue",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {}
      }
    ],
    requiresIndependentMda: false
  }
];
