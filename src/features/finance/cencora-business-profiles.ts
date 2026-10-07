import type { OriginalHierarchyProfile } from "./original-hierarchy-profiles";

/** Exact original Cencora/AmerisourceBergen revenue labels, declared dimensions and
 * parent/leaf topology. These finite source profiles contain no financial values.
 * Reported negative internal eliminations remain a separate original row. */
export type CencoraBusinessProfile = OriginalHierarchyProfile & {
  rows: (OriginalHierarchyProfile["rows"][number] & { tag: string })[];
  elimination: number;
  sections: string[][];
};
export const cencoraBusinessProfiles: CencoraBusinessProfile[] = [
  {
    id: "cor-original-business-1",
    rows: [
      {
        label: "Pharmaceutical Distribution Services",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:PharmaceuticalDistributionMember"
        }
      },
      {
        label: "MWI Animal Health",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:MWIAnimalHealthMember"
        }
      },
      {
        label: "Global Commercialization Services",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:GlobalCommercializationServicesMember"
        }
      },
      {
        label: "Total Other",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Intersegment eliminations",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember"
        }
      },
      {
        label: "Revenue",
        tag: "us-gaap:Revenues",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 3,
        children: [1, 2]
      },
      {
        parent: 5,
        children: [0, 3, 4]
      }
    ],
    branches: [0, 1, 2],
    elimination: 4,
    sections: [["Other:"]]
  },
  {
    id: "cor-original-business-2",
    rows: [
      {
        label: "Pharmaceutical Distribution Services",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "abc:PharmaceuticalDistributionMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "MWI Animal Health",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:SubsegmentsAxis": "abc:MWIAnimalHealthMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Alliance Healthcare",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:SubsegmentsAxis": "abc:AllianceHealthcareMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Global Commercialization Services",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:SubsegmentsAxis": "abc:GlobalCommercializationServicesMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Total Other",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "us-gaap:AllOtherSegmentsMember"
        }
      },
      {
        label: "Intersegment eliminations",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember"
        }
      },
      {
        label: "Revenue",
        tag: "us-gaap:Revenues",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 4,
        children: [1, 2, 3]
      },
      {
        parent: 6,
        children: [0, 4, 5]
      }
    ],
    branches: [0, 1, 2, 3],
    elimination: 5,
    sections: [["Other:"]]
  },
  {
    id: "cor-original-business-3",
    rows: [
      {
        label: "Human Health",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:SubsegmentsAxis": "cor:HumanHealthMember",
          "us-gaap:StatementBusinessSegmentsAxis": "cor:USHealthcareSolutionsMember"
        }
      },
      {
        label: "Animal Health",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:SubsegmentsAxis": "cor:AnimalHealthMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "cor:USHealthcareSolutionsMember"
        }
      },
      {
        label: "Total U.S. Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "cor:USHealthcareSolutionsMember"
        }
      },
      {
        label: "Alliance Healthcare",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "cor:InternationalHealthcareSolutionsMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:SubsegmentsAxis": "cor:AllianceHealthcareMember"
        }
      },
      {
        label: "Other Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:SubsegmentsAxis": "cor:OtherHealthcareSolutionsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "cor:InternationalHealthcareSolutionsMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Total International Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:StatementBusinessSegmentsAxis": "cor:InternationalHealthcareSolutionsMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
        }
      },
      {
        label: "Intersegment eliminations",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember"
        }
      },
      {
        label: "Revenue",
        tag: "us-gaap:Revenues",
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
    branches: [0, 1, 3, 4],
    elimination: 6,
    sections: [
      ["U.S. Healthcare Solutions", "International Healthcare Solutions"],
      ["U.S. Healthcare Solutions:", "International Healthcare Solutions:"]
    ]
  },
  {
    id: "cor-original-business-4",
    rows: [
      {
        label: "Human Health",
        tag: "us-gaap:Revenues",
        dimensions: {
          "us-gaap:SubsegmentsAxis": "abc:HumanHealthMember",
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:USHealthcareSolutionsMember"
        }
      },
      {
        label: "Animal Health",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:USHealthcareSolutionsMember",
          "us-gaap:SubsegmentsAxis": "abc:AnimalHealthMember"
        }
      },
      {
        label: "Total U.S. Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:USHealthcareSolutionsMember"
        }
      },
      {
        label: "Alliance Healthcare",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:InternationalHealthcareSolutionsMember",
          "us-gaap:SubsegmentsAxis": "abc:AllianceHealthcareMember"
        }
      },
      {
        label: "Other Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:InternationalHealthcareSolutionsMember",
          "us-gaap:SubsegmentsAxis": "abc:OtherHealthcareSolutionsMember"
        }
      },
      {
        label: "Total International Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "abc:InternationalHealthcareSolutionsMember"
        }
      },
      {
        label: "Intersegment eliminations",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember"
        }
      },
      {
        label: "Revenue",
        tag: "us-gaap:Revenues",
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
    branches: [0, 1, 3, 4],
    elimination: 6,
    sections: [["U.S. Healthcare Solutions:", "International Healthcare Solutions:"]]
  },
  {
    id: "cor-original-business-5",
    rows: [
      {
        label: "U.S. Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "cor:USHealthcareSolutionsMember"
        }
      },
      {
        label: "Alliance Healthcare",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "cor:AllianceHealthcareMember",
          "us-gaap:StatementBusinessSegmentsAxis": "cor:InternationalHealthcareSolutionsMember"
        }
      },
      {
        label: "Other Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "srt:ProductOrServiceAxis": "cor:OtherHealthcareSolutionsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "cor:InternationalHealthcareSolutionsMember"
        }
      },
      {
        label: "Total International Healthcare Solutions",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": "cor:InternationalHealthcareSolutionsMember"
        }
      },
      {
        label: "Animal Health",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember",
          "srt:ProductOrServiceAxis": "cor:AnimalHealthMember"
        }
      },
      {
        label: "Other non-strategic businesses",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember",
          "srt:ProductOrServiceAxis": "cor:OtherNonStrategicBusinessesMember"
        }
      },
      {
        label: "Total Other",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
        }
      },
      {
        label: "Intersegment eliminations",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:IntersegmentEliminationMember"
        }
      },
      {
        label: "Revenue",
        tag: "us-gaap:Revenues",
        dimensions: {}
      }
    ],
    groups: [
      {
        parent: 3,
        children: [1, 2]
      },
      {
        parent: 6,
        children: [4, 5]
      },
      {
        parent: 8,
        children: [0, 3, 6, 7]
      }
    ],
    branches: [0, 1, 2, 4, 5],
    elimination: 7,
    sections: [["International Healthcare Solutions:", "Other:"]]
  }
];
