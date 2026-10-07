/** Finite original-source profiles: Avery Dennison 2023–2026 filings and Baxter
 * 2023–2026 filings. Labels, dimensions, hierarchy and leaf partitions were
 * independently reconciled to each report’s primary revenue. These are schema
 * rules, not financial values or guessed aliases for an unknown future layout. */
export type OriginalHierarchyProfile = {
  id: string;
  rows: { label: string; dimensions: Record<string, string> }[];
  groups: { parent: number; children: number[] }[];
  branches: number[];
};

export const averyBusinessProfiles: OriginalHierarchyProfile[] = [
  {
    id: "avy-original-business-1",
    rows: [
      {
        label: "U.S.",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "country:US",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Europe, the Middle East and North Africa",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "avy:EuropeTheMiddleEastAndNorthAfricaMember"
        }
      },
      {
        label: "Asia",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:AsiaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Latin America",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:LatinAmericaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:StatementGeographicalAxis": "avy:OtherInternationalMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Apparel",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ProductOrServiceAxis": "avy:ApparelMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Identification Solutions and Vestcom",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ProductOrServiceAxis": "avy:IdentificationSolutionsAndVestcomMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Total Solutions Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Net sales to unaffiliated customers",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 5,
        children: [0, 1, 2, 3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 9,
        children: [5, 8]
      }
    ],
    branches: [5, 6, 7]
  },
  {
    id: "avy-original-business-2",
    rows: [
      {
        label: "U.S.",
        dimensions: {
          "srt:StatementGeographicalAxis": "country:US",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Europe, the Middle East and North Africa",
        dimensions: {
          "srt:StatementGeographicalAxis": "avy:EuropeTheMiddleEastAndNorthAfricaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Asia",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:AsiaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Latin America",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:LatinAmericaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:StatementGeographicalAxis": "avy:OtherInternationalMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Apparel and other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:ApparelAndOtherMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Identification Solutions and Vestcom",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:IdentificationSolutionsAndVestcomMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Total Solutions Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Net sales to unaffiliated customers",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 5,
        children: [0, 1, 2, 3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 9,
        children: [5, 8]
      }
    ],
    branches: [5, 6, 7]
  },
  {
    id: "avy-original-business-3",
    rows: [
      {
        label: "North America",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "srt:NorthAmericaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Europe, the Middle East and North Africa",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "avy:EuropeTheMiddleEastAndNorthAfricaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Asia",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "srt:AsiaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Latin America",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "srt:LatinAmericaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Apparel and other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:ApparelAndOtherMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Identification Solutions and Vestcom",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:IdentificationSolutionsAndVestcomMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Total Solutions Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Net sales to unaffiliated customers",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 4,
        children: [0, 1, 2, 3]
      },
      {
        parent: 7,
        children: [5, 6]
      },
      {
        parent: 8,
        children: [4, 7]
      }
    ],
    branches: [4, 5, 6]
  },
  {
    id: "avy-original-business-4",
    rows: [
      {
        label: "U.S.",
        dimensions: {
          "srt:StatementGeographicalAxis": "country:US",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Europe",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:EuropeMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Asia",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "srt:AsiaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Latin America",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "srt:LatinAmericaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Other international",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "avy:OtherInternationalMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Apparel",
        dimensions: {
          "srt:ProductOrServiceAxis": "avy:ApparelMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Identification Solutions and Vestcom",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:IdentificationSolutionsAndVestcomMember"
        }
      },
      {
        label: "Total Solutions Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Net sales to unaffiliated customers",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 5,
        children: [0, 1, 2, 3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 9,
        children: [5, 8]
      }
    ],
    branches: [5, 6, 7]
  },
  {
    id: "avy-original-business-5",
    rows: [
      {
        label: "U.S.",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "country:US",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Europe, the Middle East and North Africa",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "us-gaap:EMEAMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Asia",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:StatementGeographicalAxis": "srt:AsiaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Latin America",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "srt:LatinAmericaMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "avy:OtherInternationalMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Apparel",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:ApparelMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Identification Solutions and Vestcom",
        dimensions: {
          "srt:ProductOrServiceAxis": "avy:IdentificationSolutionsAndVestcomMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Total Solutions Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Net sales to unaffiliated customers",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 5,
        children: [0, 1, 2, 3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 9,
        children: [5, 8]
      }
    ],
    branches: [5, 6, 7]
  },
  {
    id: "avy-original-business-6",
    rows: [
      {
        label: "U.S.",
        dimensions: {
          "srt:StatementGeographicalAxis": "country:US",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Europe, the Middle East and North Africa",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "us-gaap:EMEAMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Asia",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "srt:AsiaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Latin America",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "srt:LatinAmericaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "avy:OtherInternationalMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Apparel and other",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ProductOrServiceAxis": "avy:ApparelAndOtherMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Identification Solutions and Vestcom",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ProductOrServiceAxis": "avy:IdentificationSolutionsAndVestcomMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Total Solutions Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Net sales to unaffiliated customers",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 5,
        children: [0, 1, 2, 3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 9,
        children: [5, 8]
      }
    ],
    branches: [5, 6, 7]
  },
  {
    id: "avy-original-business-7",
    rows: [
      {
        label: "North America",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:NorthAmericaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Europe, the Middle East and North Africa",
        dimensions: {
          "srt:StatementGeographicalAxis": "avy:EuropeTheMiddleEastAndNorthAfricaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Asia Pacific",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:AsiaPacificMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Latin America",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:LatinAmericaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Apparel and other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:ApparelAndOtherMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Identification Solutions and Vestcom",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:IdentificationSolutionsAndVestcomMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Total Solutions Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Net sales to unaffiliated customers",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 4,
        children: [0, 1, 2, 3]
      },
      {
        parent: 7,
        children: [5, 6]
      },
      {
        parent: 8,
        children: [4, 7]
      }
    ],
    branches: [4, 5, 6]
  },
  {
    id: "avy-original-business-8",
    rows: [
      {
        label: "U.S.",
        dimensions: {
          "srt:StatementGeographicalAxis": "country:US",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Europe",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:EuropeMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Asia",
        dimensions: {
          "srt:StatementGeographicalAxis": "srt:AsiaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Latin America",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:StatementGeographicalAxis": "srt:LatinAmericaMember"
        }
      },
      {
        label: "Other international",
        dimensions: {
          "srt:StatementGeographicalAxis": "avy:OtherInternationalMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Apparel",
        dimensions: {
          "srt:ProductOrServiceAxis": "avy:ApparelMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Identification Solutions and Vestcom",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember",
          "srt:ProductOrServiceAxis": "avy:IdentificationSolutionsAndVestcomMember"
        }
      },
      {
        label: "Total Solutions Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:SolutionsGroupSegmentMember"
        }
      },
      {
        label: "Net sales to unaffiliated customers",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 5,
        children: [0, 1, 2, 3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 9,
        children: [5, 8]
      }
    ],
    branches: [5, 6, 7]
  }
];

export const averyMaterialProfiles: OriginalHierarchyProfile[] = [
  {
    id: "avy-original-material-products-1",
    rows: [
      {
        label: "Labels, graphics and reflectives",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ProductOrServiceAxis": "avy:LabelsGraphicsAndFilmsMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Tapes and adhesives",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:TapesAndAdhesivesMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:ProductOrServiceAxis": "avy:OtherMaterialGroupProductsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      }
    ],
    groups: [
      {
        parent: 3,
        children: [0, 1, 2]
      }
    ],
    branches: [0, 1, 2]
  },
  {
    id: "avy-original-material-products-2",
    rows: [
      {
        label: "Labels, graphics and reflectives",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:LabelsGraphicsAndReflectivesMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Tapes and adhesives",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:TapesAndAdhesivesMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:OtherMaterialGroupProductsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      }
    ],
    groups: [
      {
        parent: 3,
        children: [0, 1, 2]
      }
    ],
    branches: [0, 1, 2]
  },
  {
    id: "avy-original-material-products-3",
    rows: [
      {
        label: "Labels, graphics and reflectives",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:LabelsGraphicsAndReflectivesMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Performance materials (2)",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:PerformanceMaterialsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "avy:OtherMaterialGroupProductsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      },
      {
        label: "Total Materials Group",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "avy:MaterialsGroupSegmentMember"
        }
      }
    ],
    groups: [
      {
        parent: 3,
        children: [0, 1, 2]
      }
    ],
    branches: [0, 1, 2]
  }
];

export const baxterBusinessProfiles: OriginalHierarchyProfile[] = [
  {
    id: "bax-original-observed-profile-1",
    rows: [
      {
        label: "Infusion Therapies and Technologies",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember",
          "srt:ProductOrServiceAxis": "bax:InfusionTherapiesAndTechnologiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Advanced Surgery",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember",
          "srt:ProductOrServiceAxis": "bax:AdvancedSurgeryMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Medical Products and Therapies",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Care and Connectivity Solutions",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:CareAndConnectivitySolutionsMember"
        }
      },
      {
        label: "Front Line Care",
        dimensions: {
          "srt:ProductOrServiceAxis": "bax:FrontLineCareMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Healthcare Systems and Technologies",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Injectables and Anesthesia",
        dimensions: {
          "srt:ProductOrServiceAxis": "bax:InjectablesAndAnesthesiaMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Drug Compounding",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:PharmaceuticalCompoundingMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Pharmaceuticals",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Chronic Therapies 1",
        dimensions: {
          "srt:ProductOrServiceAxis": "bax:ChronicRenalMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:KidneyCareMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Acute Therapies 1",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "bax:KidneyCareMember",
          "srt:ProductOrServiceAxis": "bax:AcuteTherapiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Kidney Care",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "bax:KidneyCareMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Other 1",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Total Baxter",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 2,
        children: [0, 1]
      },
      {
        parent: 5,
        children: [3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 11,
        children: [9, 10]
      },
      {
        parent: 13,
        children: [2, 5, 8, 11, 12]
      }
    ],
    branches: [0, 1, 3, 4, 6, 7, 9, 10, 12]
  },
  {
    id: "bax-original-observed-profile-2",
    rows: [
      {
        label: "Infusion Therapies & Technologies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:InfusionTherapiesAndTechnologiesMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Advanced Surgery",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:AdvancedSurgeryMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Medical Products & Therapies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Care and Connectivity Solutions",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:CareAndConnectivitySolutionsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Front Line Care",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:FrontLineCareMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Healthcare Systems & Technologies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Injectables and Anesthesia",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:InjectablesAndAnesthesiaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Drug Compounding",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:PharmaceuticalCompoundingMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Pharmaceuticals",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Other 1",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Total Baxter",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 2,
        children: [0, 1]
      },
      {
        parent: 5,
        children: [3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 10,
        children: [2, 5, 8, 9]
      }
    ],
    branches: [0, 1, 3, 4, 6, 7, 9]
  },
  {
    id: "bax-original-observed-profile-3",
    rows: [
      {
        label: "Infusion Therapies & Technologies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:InfusionTherapiesAndTechnologiesMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Advanced Surgery",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:AdvancedSurgeryMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Medical Products & Therapies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Care & Connectivity Solutions",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:CareAndConnectivitySolutionsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Front Line Care",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:FrontLineCareMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Healthcare Systems & Technologies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Injectables & Anesthesia",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:InjectablesAndAnesthesiaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Drug Compounding",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:PharmaceuticalCompoundingMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Pharmaceuticals",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Total Baxter",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 2,
        children: [0, 1]
      },
      {
        parent: 5,
        children: [3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 10,
        children: [2, 5, 8, 9]
      }
    ],
    branches: [0, 1, 3, 4, 6, 7, 9]
  },
  {
    id: "bax-original-observed-profile-4",
    rows: [
      {
        label: "Infusion Therapies and Technologies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:InfusionTherapiesAndTechnologiesMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Advanced Surgery",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:AdvancedSurgeryMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Medical Products & Therapies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Care and Connectivity Solutions",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:CareAndConnectivitySolutionsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Front Line Care",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:FrontLineCareMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Healthcare Systems & Technologies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Injectables and Anesthesia",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:InjectablesAndAnesthesiaMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Drug Compounding",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "bax:PharmaceuticalCompoundingMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Pharmaceuticals",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:PharmaceuticalsMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Total Baxter",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 2,
        children: [0, 1]
      },
      {
        parent: 5,
        children: [3, 4]
      },
      {
        parent: 8,
        children: [6, 7]
      },
      {
        parent: 10,
        children: [2, 5, 8, 9]
      }
    ],
    branches: [0, 1, 3, 4, 6, 7, 9]
  },
  {
    id: "bax-original-observed-profile-5",
    rows: [
      {
        label: "Infusion Therapies & Platforms",
        dimensions: {
          "srt:ProductOrServiceAxis": "bax:InfusionTherapiesAndPlatformsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Advanced Surgery",
        dimensions: {
          "srt:ProductOrServiceAxis": "bax:AdvancedSurgeryMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Medical Products & Therapies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:MedicalProductsAndTherapiesMember"
        }
      },
      {
        label: "Care & Connectivity Solutions",
        dimensions: {
          "srt:ProductOrServiceAxis": "bax:CareAndConnectivitySolutionsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Front Line Care",
        dimensions: {
          "srt:ProductOrServiceAxis": "bax:FrontLineCareMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Healthcare Systems & Technologies",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "bax:HealthcareSystemsAndTechnologiesMember"
        }
      },
      {
        label: "Other",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Total Baxter",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 2,
        children: [0, 1]
      },
      {
        parent: 5,
        children: [3, 4]
      },
      {
        parent: 7,
        children: [2, 5, 6]
      }
    ],
    branches: [0, 1, 3, 4, 6]
  }
];
