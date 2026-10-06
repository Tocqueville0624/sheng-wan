import type { ProductPortfolioCell, ProductPortfolioProof, RevenueSegment } from "./types";
import type { PeriodV2 } from "./v2-types";

export const productPortfolioRule = "abbv-original-product-portfolios-v1";
export const productContractTag = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
export const productCollaborationTag =
  "us-gaap:RevenueFromCollaborativeArrangementExcludingRevenueFromContractWithCustomer";
export const portfolioCalculationTag = "sum of reported product revenues";
export const abbviePortfolios: Record<string, string[]> = {
  Immunology: ["abbv:ImmunologyMember"],
  Neuroscience: ["abbv:NeuroscienceMember"],
  "Hematologic Oncology": ["abbv:HematologicOncologyMember"],
  Oncology: ["abbv:OncologyMember", "abbv:HematologicOncologyMember"],
  HCV: ["abbv:HCVMember"],
  Aesthetics: ["abbv:AestheticsMember"],
  "Eye Care": ["abbv:EyeCareMember"],
  "Women's Health": ["abbv:WomensHealthMember"],
  "Other Key Products": ["abbv:OtherKeyProductsMember"]
};
const products: Record<string, string> = {
  humira: "HUMIRA",
  skyrizi: "SKYRIZI",
  rinvoq: "RINVOQ",
  imbruvica: "Imbruvica",
  venclexta: "VENCLEXTA",
  mavyret: "MAVYRET",
  viekira: "VIEKIRA",
  creon: "Creon",
  lupron: "Lupron",
  synthroid: "Synthroid",
  synagis: "Synagis",
  duodopa: "Duodopa",
  sevoflurane: "Sevoflurane",
  kaletra: "Kaletra",
  androgel: "AndroGel",
  orilissa: "ORILISSA",
  "all other": "OtherProducts",
  "botox cosmetic": "BotoxCosmetic",
  "juvederm collection": "JuvedermCollection",
  "other aesthetics": "OtherAesthetics",
  "botox therapeutic": "BotoxTherapeutic",
  vraylar: "Vraylar",
  ubrelvy: "Ubrelvy",
  "other neuroscience": "OtherNeuroscience",
  "lumigan/ganfort": "LumiganGanfort",
  "alphagan/combigan": "AlphaganCombigan",
  restasis: "Restasis",
  "other eye care": "OtherEyeCare",
  "lo loestrin": "LoLoestrin",
  "orilissa/oriahnn": "OrilissaOriahnn",
  "other women's health": "OtherWomensHealth",
  "linzess/constella": "LinzessConstella",
  qulipta: "Qulipta",
  epkinly: "Epkinly",
  ozurdex: "Ozurdex",
  elahere: "Elahere",
  vyalev: "Vyalev",
  "other oncology": "OtherOncology",
  linzess: "LinzessConstella"
};
export function abbvieProductMember(label: string) {
  const name = label.endsWith(" (a)") ? label.slice(0, -4) : label;
  const member = products[name.toLowerCase()];
  return member ? `abbv:${member}Member` : undefined;
}
export const productScopeLabels = [
  "United States",
  "International",
  "Total",
  "Collaboration revenues",
  "Collaboration Revenues",
  ""
];
export class ProductPortfolioProofError extends Error {}
function demand(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new ProductPortfolioProofError(reason);
}
function integer(value: number, max = 5000) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}
export function originalProductCellValid(cell: ProductPortfolioCell) {
  if (
    !integer(cell.columnIndex, 64) ||
    !integer(cell.span, 32) ||
    cell.span < 1 ||
    typeof cell.label !== "string" ||
    cell.label.length > 100 ||
    !Array.isArray(cell.facts) ||
    cell.facts.length > 2
  )
    return false;
  for (const fact of cell.facts) {
    if (
      !Number.isSafeInteger(fact.value) ||
      fact.value < 0 ||
      fact.decimals !== -6 ||
      !fact.contextId ||
      fact.contextId.length > 1000 ||
      !fact.dimensions ||
      !Array.isArray(fact.declarations) ||
      fact.declarations.length < 1 ||
      fact.declarations.length > 2
    )
      return false;
    const lexical = cell.label.replace(/[,$\s]/g, "");
    const zero = ["—", "–", "-"].includes(lexical);
    if (
      (!zero && !/^\d+(?:\.\d+)?$/.test(lexical)) ||
      (zero ? 0 : Number(lexical) * 1e6) !== fact.value
    )
      return false;
    for (const declaration of fact.declarations) {
      if (
        (declaration.id !== undefined && (!declaration.id || declaration.id.length > 1000)) ||
        ![
          "",
          "ixt:num-dot-decimal",
          "ixt:numdotdecimal",
          "ixt:fixed-zero",
          "ixt:zerodash"
        ].includes(declaration.format) ||
        (zero && !["ixt:fixed-zero", "ixt:zerodash"].includes(declaration.format))
      )
        return false;
    }
  }
  return true;
}

/** Independent normalized-proof validation. This does not fetch or reinterpret a filing. */
export function productPortfolioGroups(proof: ProductPortfolioProof, period: PeriodV2) {
  demand(
    proof.ruleId === productPortfolioRule &&
      proof.startDate === period.startDate &&
      proof.endDate === period.endDate &&
      /^(10-K|10-Q)(\/A)?$/.test(proof.form) &&
      /^\d{4}-\d\d-\d\d$/.test(proof.reportDate),
    "Product source identity/dates"
  );
  demand(
    proof.tables.length >= 1 &&
      proof.tables.length <= 2 &&
      proof.products.length >= 2 &&
      proof.products.length <= 32 &&
      proof.headings.length >= 2 &&
      proof.headings.length <= 9,
    "Bounded complete product section"
  );
  const indices = new Set<number>();
  const occupied = new Set<string>();
  const rowKey = (table: number, row: number) => `${table}:${row}`;
  const claim = (table: number, row: number) => {
    const t = proof.tables.find((t) => t.tableIndex === table);
    demand(t && integer(row, t.rowCount - 1), "Original source row coordinates");
    const key = rowKey(table, row);
    demand(!occupied.has(key), "Duplicate original source row");
    occupied.add(key);
  };
  for (const table of proof.tables) {
    demand(
      integer(table.tableIndex) &&
        !indices.has(table.tableIndex) &&
        integer(table.rowCount, 200) &&
        table.rowCount > 3,
      "Original source table coordinates"
    );
    indices.add(table.tableIndex);
    const year = table.year,
      temporal = table.temporal;
    demand(
      year.label === period.endDate.slice(0, 4) &&
        integer(year.rowIndex, 3) &&
        integer(year.columnIndex, 64) &&
        year.span === 3 &&
        integer(temporal.rowIndex, 3) &&
        integer(temporal.columnIndex, 64) &&
        integer(temporal.span, 32) &&
        temporal.span > 0 &&
        [1, 2].includes(temporal.rowSpan),
      "Original year/temporal headers"
    );
    if (period.kind === "annual") {
      demand(
        period.startDate === `${year.label}-01-01` &&
          period.endDate === `${year.label}-12-31` &&
          /^years ended December 31 \(in millions\)$/i.test(temporal.label) &&
          temporal.rowIndex === year.rowIndex &&
          temporal.method === "original-spanning-header" &&
          !table.quarter1ComparisonYears,
        "Original annual header"
      );
    } else {
      const date = temporal.label.match(
        /^Three months ended (March 31|June 30|September 30|December 31),$/
      );
      const ends: Record<string, string> = {
        "March 31": "03-31",
        "June 30": "06-30",
        "September 30": "09-30",
        "December 31": "12-31"
      };
      const starts: Record<string, string> = {
        "March 31": "01-01",
        "June 30": "04-01",
        "September 30": "07-01",
        "December 31": "10-01"
      };
      demand(
        date &&
          period.endDate === `${year.label}-${ends[date[1]]}` &&
          period.startDate === `${year.label}-${starts[date[1]]}` &&
          temporal.rowIndex < year.rowIndex,
        "Original three-month source duration"
      );
      if (temporal.method === "original-single-Q1-table-caption") {
        const comparison = table.quarter1ComparisonYears;
        demand(
          date[1] === "March 31" &&
            comparison?.length === 2 &&
            new Set(comparison.map((y) => y.label)).size === 2 &&
            comparison.every(
              (y) => /^\d{4}$/.test(y.label) && integer(y.columnIndex, 64) && y.span === 3
            ) &&
            comparison.some((y) => y.label === year.label && y.columnIndex === year.columnIndex),
          "Original single-Q1 caption and two source years"
        );
      } else
        demand(
          temporal.method === "original-spanning-header" &&
            !table.quarter1ComparisonYears &&
            year.columnIndex >= temporal.columnIndex &&
            year.columnIndex + year.span <= temporal.columnIndex + temporal.span &&
            temporal.rowIndex + temporal.rowSpan <= year.rowIndex,
          "Original temporal span"
        );
    }
    demand(
      table.headerRows.length >= 1 && table.headerRows.every((r) => r <= year.rowIndex),
      "Source header rows"
    );
    for (const row of [...table.headerRows, ...table.emptyRows]) claim(table.tableIndex, row);
  }
  demand(proof.continuations.length === proof.tables.length - 1, "Complete original pagination");
  for (let index = 1; index < proof.tables.length; index++) {
    const before = proof.tables[index - 1],
      after = proof.tables[index],
      c = proof.continuations[index - 1];
    demand(
      c.fromTable === before.tableIndex &&
        c.toTable === after.tableIndex &&
        c.footerTableIndex === before.tableIndex + 1 &&
        after.tableIndex === before.tableIndex + 2,
      "Original footer-only continuation"
    );
    const escapedForm = proof.form.replace("/A", ""),
      reportYear = proof.reportDate.slice(0, 4);
    demand(
      new RegExp(
        `^(?:\\d+ \\| ${reportYear} Form ${escapedForm}|${reportYear} Form ${escapedForm} \\| \\d+)$`
      ).test(c.label),
      "Original filing footer year/form"
    );
  }
  const order = (table: number, row: number) => table * 1000 + row;
  let lastHeading = -1;
  for (const heading of proof.headings) {
    demand(
      abbviePortfolios[heading.label] && order(heading.tableIndex, heading.rowIndex) > lastHeading,
      "Original portfolio heading order"
    );
    lastHeading = order(heading.tableIndex, heading.rowIndex);
    claim(heading.tableIndex, heading.rowIndex);
  }
  demand(
    proof.headings[0].label === "Immunology" &&
      proof.headings[0].tableIndex === proof.tables[0].tableIndex,
    "Original product-section start"
  );
  const ids = new Set<string>();
  const groups: { label: string; revenue: number; products: string[] }[] = [];
  let previous = -1;
  for (const product of proof.products) {
    const member = abbvieProductMember(product.label);
    demand(
      member &&
        product.id === member &&
        !ids.has(member) &&
        product.rows.length >= 1 &&
        product.rows.length <= 4 &&
        product.rows[0].label === product.label,
      "Reviewed original product identity"
    );
    ids.add(member);
    const first = product.rows[0],
      firstOrder = order(first.tableIndex, first.rowIndex);
    demand(firstOrder > previous, "Original product block order");
    const heading = proof.headings.findLast((h) => order(h.tableIndex, h.rowIndex) < firstOrder);
    demand(
      product.label === "All other"
        ? product.portfolio === undefined
        : heading?.label === product.portfolio,
      "Original product/portfolio hierarchy"
    );
    const original: { fact: ProductPortfolioCell["facts"][number]; scope: string }[] = [];
    for (const [index, row] of product.rows.entries()) {
      const at = order(row.tableIndex, row.rowIndex);
      demand(
        at > previous &&
          (index === 0 || row.label === "") &&
          productScopeLabels.includes(row.scope),
        "Original product row order/scope"
      );
      previous = at;
      claim(row.tableIndex, row.rowIndex);
      const table = proof.tables.find((t) => t.tableIndex === row.tableIndex)!;
      let column = table.year.columnIndex;
      for (const cell of row.cells) {
        demand(
          originalProductCellValid(cell) && cell.columnIndex === column,
          "Exact original product cell"
        );
        column += cell.span;
        if (!cell.facts.length)
          demand(["", "$", "—", "–", "-"].includes(cell.label), "Original blank remains absent");
        for (const fact of cell.facts) {
          const d = fact.dimensions,
            geography = d["srt:StatementGeographicalAxis"];
          demand(
            [productContractTag, productCollaborationTag].includes(fact.tag) &&
              d["srt:ProductOrServiceAxis"] === member &&
              Object.keys(d).every((axis) =>
                [
                  "srt:ProductOrServiceAxis",
                  "abbv:KeyProductPortfolioAxis",
                  "srt:StatementGeographicalAxis",
                  "us-gaap:TypeOfArrangementAxis"
                ].includes(axis)
              ),
            "Original product concept/dimensions"
          );
          demand(
            product.portfolio
              ? abbviePortfolios[product.portfolio]?.includes(d["abbv:KeyProductPortfolioAxis"])
              : !d["abbv:KeyProductPortfolioAxis"] && member === "abbv:OtherProductsMember",
            "Original portfolio member"
          );
          if (row.scope === "United States")
            demand(geography === "country:US", "Original US scope");
          else if (row.scope === "International")
            demand(geography === "us-gaap:NonUsMember", "Original international scope");
          else if (row.scope === "Total" || row.scope === "")
            demand(!geography, "Original total scope");
          else
            demand(
              (fact.tag === productCollaborationTag ||
                d["us-gaap:TypeOfArrangementAxis"] === "us-gaap:CollaborativeArrangementMember") &&
                (geography === undefined ||
                  ["country:US", "us-gaap:NonUsMember"].includes(geography)),
              "Original collaboration scope"
            );
          if (d["us-gaap:TypeOfArrangementAxis"])
            demand(
              d["us-gaap:TypeOfArrangementAxis"] === "us-gaap:CollaborativeArrangementMember" &&
                fact.tag === productContractTag &&
                row.scope === "Collaboration revenues" &&
                geography === "us-gaap:NonUsMember" &&
                member === "abbv:ImbruvicaMember" &&
                d["abbv:KeyProductPortfolioAxis"] === "abbv:HematologicOncologyMember",
              "Reviewed historical arrangement scope"
            );
          original.push({ fact, scope: row.scope });
        }
      }
      demand(
        column === table.year.columnIndex + table.year.span &&
          row.cells.flatMap((c) => c.facts).length <= 1,
        "Complete original current product column"
      );
    }
    const totals = original.filter((f) => f.scope === "Total"),
      components = original.filter((f) => f.scope !== "Total");
    demand(totals.length <= 1, "One original product total");
    let selected;
    if (totals.length) {
      selected = totals[0].fact;
      demand(
        components.length >= 1 &&
          components.reduce((sum, f) => sum + f.fact.value, 0) === selected.value,
        "Original product total corroborates all components once"
      );
    } else if (components.length) {
      demand(components.length === 1, "Sole reported no-total product row");
      selected = components[0].fact;
    }
    if (!selected) continue;
    demand(
      selected.tag === productContractTag ||
        (selected.tag === productCollaborationTag &&
          member === "abbv:EpkinlyMember" &&
          selected.value === 0 &&
          components.every((f) => f.fact.value === 0)),
      "Reported product leaf, including declared historical zero"
    );
    const label = product.portfolio ?? product.label;
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { label, revenue: 0, products: [] };
      groups.push(group);
    }
    group.revenue += selected.value;
    group.products.push(product.id);
  }
  demand(
    proof.total.tableIndex === proof.tables.at(-1)!.tableIndex &&
      order(proof.total.tableIndex, proof.total.rowIndex) > previous,
    "Original closing revenue row"
  );
  claim(proof.total.tableIndex, proof.total.rowIndex);
  const totalTable = proof.tables.at(-1)!;
  let column = totalTable.year.columnIndex;
  for (const cell of proof.total.cells) {
    demand(
      originalProductCellValid(cell) && cell.columnIndex === column,
      "Original consolidated closing cells"
    );
    column += cell.span;
  }
  demand(
    column === totalTable.year.columnIndex + totalTable.year.span,
    "Complete original closing column"
  );
  const totalFacts = proof.total.cells.flatMap((c) => c.facts);
  demand(
    totalFacts.length >= 1 &&
      totalFacts.length <= 2 &&
      totalFacts.every(
        (f) =>
          ["us-gaap:Revenues", productContractTag].includes(f.tag) &&
          !Object.keys(f.dimensions).length &&
          f.value === period.metrics.revenue
      ),
    "Original reported consolidated product-section total"
  );
  demand(
    integer(proof.primary.tableIndex) &&
      !indices.has(proof.primary.tableIndex) &&
      integer(proof.primary.rowIndex, 200) &&
      proof.primary.label === "Net revenues" &&
      originalProductCellValid(proof.primary.cell) &&
      proof.primary.cell.facts.some(
        (f) =>
          f.tag === period.metricSources.revenue?.tag &&
          f.value === period.metrics.revenue &&
          !Object.keys(f.dimensions).length
      ),
    "Independent original primary revenue row"
  );
  for (const table of proof.tables)
    for (let row = 0; row < table.rowCount; row++)
      demand(
        occupied.has(rowKey(table.tableIndex, row)),
        "Exhaustive original product-section rows"
      );
  demand(
    groups.length >= 2 &&
      groups.length <= 10 &&
      groups.reduce((sum, g) => sum + g.revenue, 0) === period.metrics.revenue,
    "Reported leaves reconcile exactly to unchanged primary revenue"
  );
  return groups.filter((g) => g.revenue > 0);
}

export function portfolioSegments(
  period: PeriodV2,
  proof: ProductPortfolioProof
): RevenueSegment[] {
  return productPortfolioGroups(proof, period).map((group) => ({
    id: `portfolio-${group.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label: group.label,
    revenue: group.revenue,
    revenueSource: {
      sourceUrl: period.sourceUrl,
      accession: period.accession!,
      filedAt: period.filedAt,
      startDate: period.startDate,
      endDate: period.endDate,
      currency: "USD",
      tag: portfolioCalculationTag,
      dimensions: {},
      value: group.revenue,
      decimals: -6,
      tableLabel: group.label,
      calculation: { method: "sum-of-reported-products", products: group.products }
    }
  }));
}

export function productPortfolioProblem(period: PeriodV2): string | undefined {
  try {
    const source = period.businessBreakdownSource,
      proof = source?.productPortfolios;
    demand(
      source?.method === "reported-product-portfolios" &&
        source.ruleId === productPortfolioRule &&
        proof &&
        period.reportingCurrency === "USD" &&
        period.displayCurrency === "USD" &&
        period.sourceUrl.startsWith(
          `https://www.sec.gov/Archives/edgar/data/1551152/${period.accession?.replaceAll("-", "")}/`
        ) &&
        source.sourceUrl === period.sourceUrl &&
        source.accession === period.accession &&
        source.revenueTag === period.metricSources.revenue?.tag &&
        source.revenue === period.metrics.revenue &&
        source.revenueDecimals === -6 &&
        source.tableIndex === proof.tables[0]?.tableIndex &&
        source.totalTableIndex === proof.total.tableIndex &&
        source.totalLabel === "Total net revenues" &&
        !source.axis &&
        !source.qualifiers &&
        !source.layout &&
        !source.externalCustomerColumns &&
        !source.omittedZeroColumns &&
        !source.omittedSubtotals.length &&
        !period.revenueAdjustments?.length,
      "Finite product-portfolio source contract"
    );
    const expected = portfolioSegments(period, proof);
    demand(
      canonicalJson(period.segments) === canonicalJson(expected),
      "Calculated groups retain exact original inputs and provenance"
    );
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid product portfolio proof";
  }
}

// JSON object property order is incidental; original array/source order is not.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
