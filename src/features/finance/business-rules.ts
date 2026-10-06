/** Reviewed source schemas contain identities and accounting classifications, never amounts.
 * A new or renamed segment fails the schema until its source table is reviewed.
 */
export type BusinessRule = {
  id: string;
  cik: string;
  totalTag: string;
  totalLabel: string;
  layout?: "columns" | "rows";
  separateTotal?: boolean;
  /** A reviewed external-customer row, distinct from gross/intersegment sales.
   * Every source column is accounted for, including duplicate totals and blanks.
   */
  externalCustomerColumns?: {
    primaryLabel: string;
    totalLabels: string[];
    blankLabels: string[];
  };
  basis: string;
  branches: {
    label: string;
    columnLabel?: string;
    rowLabel: string;
    tag: string;
    dimensions: Record<string, string>;
    costTag?: string;
  }[];
};

export const businessRules: BusinessRule[] = [
  {
    id: "iex-external-customers-columns-v1",
    cik: "0000832101",
    totalTag: "us-gaap:Revenues",
    totalLabel: "External customers",
    layout: "columns",
    separateTotal: true,
    externalCustomerColumns: {
      primaryLabel: "Net sales",
      totalLabels: ["Total Segments", "IDEX"],
      blankLabels: ["Eliminations"]
    },
    basis:
      "Reported external-customer sales for Health & Science Technologies (HST), Fluid & Metering Technologies (FMT) and Fire & Safety/Diversified Products (FSDP). Both source totals reconcile to the independent primary net-sales row. Gross and intersegment sales are not counted again; the untagged elimination dash remains blank.",
    branches: [
      ["Health & Science Technologies", "HST", "iex:HealthAndScienceTechnologiesMember"],
      ["Fluid & Metering Technologies", "FMT", "iex:FluidAndMeteringTechnologiesMember"],
      ["Fire & Safety/Diversified Products", "FSDP", "iex:FireAndSafetyDiversifiedProductsMember"]
    ].map(([label, columnLabel, member]) => ({
      label,
      columnLabel,
      rowLabel: "External customers",
      tag: "us-gaap:Revenues",
      dimensions: { "us-gaap:StatementBusinessSegmentsAxis": member }
    }))
  },
  {
    id: "flex-its-rms-cpi-quarterly-v1",
    cik: "0000866374",
    totalTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    totalLabel: "Net Sales",
    layout: "columns",
    basis:
      "Reported net sales under the quarterly source table's ITS, RMS and CPI headings. Each original business context is retained without mixing the annual corporate classification.",
    branches: [
      ["ITS", "flex:IntegratedTechnologySolutionsMember"],
      ["RMS", "flex:RegulatedManufacturingSolutionsMember"],
      ["CPI", "flex:CloudAndPowerInfrastructureMember"]
    ].map(([label, member]) => ({
      label,
      rowLabel: "Net Sales",
      tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      dimensions: { "us-gaap:StatementBusinessSegmentsAxis": member }
    }))
  },
  {
    id: "flex-fas-frs-columns-v1",
    cik: "0000866374",
    totalTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    totalLabel: "Net Sales",
    layout: "columns",
    basis:
      "Reported net sales under the original FAS and FRS headings, plus the separately tagged Corporate & Other amount. A zero requires an actual reported numeric fact; a blank cell is never filled.",
    branches: [
      ...[
        ["FAS", "flex:FlexAgilitySolutionsFASMember"],
        ["FRS", "flex:FlexReliabilitySolutionsFRSMember"]
      ].map(([label, member]) => ({
        label,
        rowLabel: "Net Sales",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": member
        }
      })),
      {
        label: "Corporate & Other",
        rowLabel: "Net Sales",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: { "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember" }
      }
    ]
  },
  {
    id: "flex-fas-frs-rows-v1",
    cik: "0000866374",
    totalTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    totalLabel: "Net sales",
    layout: "rows",
    separateTotal: true,
    basis:
      "Reported Flex Agility Solutions and Flex Reliability Solutions sales reconcile to the independent primary consolidated sales row in the same filing. Historical classifications stay separate.",
    branches: [
      ["Flex Agility Solutions", "flex:FlexAgilitySolutionsFASMember"],
      ["Flex Reliability Solutions", "flex:FlexReliabilitySolutionsFRSMember"]
    ].map(([label, member]) => ({
      label,
      rowLabel: label,
      tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      dimensions: {
        "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
        "us-gaap:StatementBusinessSegmentsAxis": member
      }
    }))
  },
  {
    id: "flex-its-rms-cpi-annual-v1",
    cik: "0000866374",
    totalTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    totalLabel: "Net Sales",
    layout: "columns",
    basis:
      "Reported annual net sales under the source table's ITS, RMS and CPI headings. CPI retains its actual reported corporate context; no revenue is assigned from a residual.",
    branches: [
      ...[
        ["ITS", "flex:IntegratedTechnologySolutionsITSMember"],
        ["RMS", "flex:RegulatedManufacturingSolutionsRMSMember"]
      ].map(([label, member]) => ({
        label,
        rowLabel: "Net Sales",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": member
        }
      })),
      {
        label: "CPI",
        rowLabel: "Net Sales",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: { "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember" }
      }
    ]
  },
  ...["quarterly", "annual"].map<BusinessRule>((kind) => ({
    id: `abt-four-businesses-${kind}-v1`,
    cik: "0000001800",
    totalTag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    totalLabel: "Net sales",
    layout: "rows",
    basis:
      "Reported net sales to external customers by four operating businesses, plus separately reported Other revenue. Other is the filing's corporate scope, not a balancing residual.",
    branches: [
      ...[
        ["Established Pharmaceuticals", "abt:EstablishedPharmaceuticalProductsMember"],
        [
          kind === "annual" ? "Nutritionals" : "Nutritional Products",
          "abt:NutritionalProductsMember"
        ],
        [kind === "annual" ? "Diagnostics" : "Diagnostic Products", "abt:DiagnosticProductsMember"],
        ["Medical Devices", "abt:MedicalDevicesMember"]
      ].map(([label, member]) => ({
        label,
        rowLabel: label,
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": member
        }
      })),
      {
        label: "Other",
        rowLabel: "Other",
        tag: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        dimensions: { "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember" }
      }
    ]
  })),
  ...["Corporate", "Corporate and Other"].map<BusinessRule>((corporate) => ({
    id: `mmm-three-businesses-${corporate === "Corporate" ? "corporate" : "corporate-other"}-v1`,
    cik: "0000066740",
    totalTag: "us-gaap:Revenues",
    totalLabel: "Total Company",
    layout: "rows",
    basis:
      "Reported net sales by Safety and Industrial, Transportation and Electronics, and Consumer, plus the filing's separately reported corporate revenue. Corporate revenue is not an allocation to the operating businesses.",
    branches: [
      ...[
        ["Safety and Industrial", "mmm:SafetyAndIndustrialSegmentMember"],
        ["Transportation and Electronics", "mmm:TransportationAndElectronicsSegmentMember"],
        ["Consumer", "mmm:ConsumerSegmentMember"]
      ].map(([label, member]) => ({
        label,
        rowLabel: label,
        tag: "us-gaap:Revenues",
        dimensions: {
          "srt:ConsolidationItemsAxis": "us-gaap:OperatingSegmentsMember",
          "us-gaap:StatementBusinessSegmentsAxis": member
        }
      })),
      {
        label: corporate,
        rowLabel: corporate,
        tag: "us-gaap:Revenues",
        dimensions: { "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember" }
      }
    ]
  })),
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

/** Only an explicitly reported zero with this standard reconciliation scope
 * may be omitted from a revenue partition. The caller must check the zero fact,
 * precision and source coordinates; a visible dash by itself is not a fact.
 */
export const isZeroRevenueReconciliation = (label: string, dimensions: Record<string, string>) =>
  /^\s*(?:less:\s*)?corporate\b/i.test(label) &&
  !!dimensions &&
  sameDimensions(dimensions, {
    "srt:ConsolidationItemsAxis": "us-gaap:CorporateNonSegmentMember"
  });

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
