/** Reviewed source schemas contain identities and accounting classifications, never amounts.
 * A new or renamed segment fails the schema until its source table is reviewed.
 */
export type BusinessRule = {
  id: string;
  cik: string;
  totalTag: string;
  totalLabel: string;
  layout?: "columns";
  separateTotal?: boolean;
  basis: string;
  branches: {
    label: string;
    rowLabel: string;
    tag: string;
    dimensions: Record<string, string>;
    costTag?: string;
  }[];
};

export const businessRules: BusinessRule[] = [
  ...["Revenue", "Net revenue"].map<BusinessRule>((totalLabel) => ({
    id: `amat-semiconductor-services-${totalLabel === "Revenue" ? "other" : "corporate"}-v1`,
    cik: "0000006951",
    totalTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    totalLabel,
    layout: "columns",
    basis:
      "Reported revenue from Semiconductor Systems, Applied Global Services and the separately reported Other column. Other is a source value, not a residual.",
    branches: [
      ...[
        ["Semiconductor Systems", "amat:SemiconductorSystemsSegmentMember"],
        ["Applied Global Services", "amat:AppliedGlobalServicesSegmentMember"]
      ].map(([label, member]) => ({
        label,
        rowLabel: totalLabel,
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": member
        }
      })),
      {
        label: totalLabel === "Revenue" ? "Other" : "Corporate and Other",
        rowLabel: totalLabel,
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: { "srt:ConsolidationItemsAxis": "amat:CorporateAndReconcilingItemsMember" }
      }
    ]
  })),
  {
    id: "wmt-operating-segments-v1",
    cik: "0000104169",
    totalTag: "us-gaap:Revenues",
    totalLabel: "Total revenues",
    basis:
      "Reported total revenue by operating segment, including membership and other income. Corporate revenue is a separately reported source row.",
    branches: [
      ...[
        ["Walmart U.S.", "wmt:WalmartUSMember"],
        ["Walmart International", "wmt:WalmartInternationalMember"],
        ["Sam's Club U.S.", "wmt:SamsClubUSMember"]
      ].map(([label, member]) => ({
        label,
        rowLabel: "Total revenues",
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": member
        },
        costTag: "us-gaap:CostOfRevenue"
      })),
      {
        label: "Corporate and support",
        rowLabel: "Membership and other income",
        tag: "us-gaap:OtherIncome",
        dimensions: { "srt:ConsolidationItemsAxis": "wmt:CorporateAndReconcilingItemsMember" }
      }
    ]
  },
  {
    id: "jnj-innovative-medicine-medtech-v1",
    cik: "0000200406",
    totalTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    totalLabel: "Sales to customers",
    layout: "columns",
    separateTotal: true,
    basis:
      "Sales to customers by reported operating segment. The two segment revenues reconcile to the consolidated sales line from the same filing and period.",
    branches: [
      ["Innovative Medicine", "jnj:InnovativeMedicineMember"],
      ["MedTech", "jnj:MedTechMember"]
    ].map(([label, member]) => ({
      label,
      rowLabel: "Sales to customers",
      tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      dimensions: {
        "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
        "us-gaap:StatementBusinessSegmentsAxis": member
      },
      costTag: "us-gaap:CostOfGoodsAndServicesSold"
    }))
  }
];

export const sameDimensions = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort(([x], [y]) => x.localeCompare(y))) ===
  JSON.stringify(Object.entries(b).sort(([x], [y]) => x.localeCompare(y)));

export const businessAxes = [
  "srt:ProductOrServiceAxis",
  "us-gaap:ProductOrServiceAxis",
  "us-gaap:StatementBusinessSegmentsAxis"
] as const;

/** Contract timing is a revenue disclosure, not a business/product category.
 * Some filings put these members on ProductOrServiceAxis; do not label them as
 * the businesses supplying revenue. A reported operating-segment axis is kept.
 */
export const isBusinessCategory = (axis: string, member: string, label: string) =>
  axis === "us-gaap:StatementBusinessSegmentsAxis" ||
  (!/^(?:recurring|non[ -]?recurring|over time|(?:at a )?point in time)$/i.test(label.trim()) &&
    !/Revenue(?:fromContractwithCustomerMeasurement(?:Recurring|Nonrecurring)|Recognized(?:OverTime|AtPointInTime))Member$/i.test(
      member
    ));

/** A scope qualifier is not another partition. Only this standard, explicitly
 * consolidated operating-segment scope may accompany a generic business axis.
 */
export const validBusinessQualifiers = (dimensions: Record<string, string>) =>
  !Object.keys(dimensions).length ||
  sameDimensions(dimensions, {
    "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember"
  });

export const sourceLabel = (text: string) =>
  text
    .replace(/\s*\((?:Note\s+)?\d+\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
