import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OriginalStandaloneXbrlError,
  parseOriginalStandaloneXbrl
} from "../scripts/finance/standalone-xbrl";

const fixture = (ticker: string) =>
  readFileSync(
    new URL(`./fixtures/finance/${ticker.toLowerCase()}-original-standalone.xml`, import.meta.url),
    "utf8"
  );
const ame = fixture("AME"),
  cik = "0001037868";
describe("original separate XBRL declarations", () => {
  it.each([
    ["AME", "0001037868", 4, 0],
    ["ALB", "0000915913", 8, 0],
    ["BAX", "0000010456", 1, 2],
    ["FDS", "0001013237", 1, 2],
    ["ES", "0000072741", 2, 0],
    ["TSM", "0001046179", 1, 0],
    ["HST", "0001070750", 1, 0]
  ])("preserves %s original declarations and resource references", (ticker, owner, facts, nils) => {
    const xml = fixture(String(ticker)),
      result = parseOriginalStandaloneXbrl(xml, String(owner));
    expect(result.facts).toHaveLength(Number(facts));
    expect(result.nilFacts).toHaveLength(Number(nils));
    for (const f of result.facts) {
      expect(xml).toContain(f.originalEvidence.originalXml);
      expect(xml).toContain(f.context.originalXml);
      expect(xml).toContain(f.originalEvidence.unit.originalXml);
      expect(f.originalEvidence.contextId).toBe(f.context.id);
      expect(f.value).toBe(Number(f.originalEvidence.lexical));
      expect(f.decimals).toBe(
        f.originalEvidence.originalDecimals === "INF"
          ? Infinity
          : Number(f.originalEvidence.originalDecimals)
      );
      expect(f.originalEvidence.originalXml).not.toMatch(/\b(?:scale|sign|format)=/);
    }
    expect(result.facts.every((f) => Number(f.context.cik) === Number(owner))).toBe(true);
  });
  it("keeps original AMETEK business contexts distinct from the independent total", () => {
    const p = parseOriginalStandaloneXbrl(ame, cik);
    const revenue = p.facts.filter(
      (f) => f.tag === "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax"
    );
    expect(
      revenue.filter((f) => !Object.keys(f.context.dimensions).length).map((f) => f.value)
    ).toEqual([3840087000]);
    expect(
      revenue.filter((f) => Object.keys(f.context.dimensions).length).map((f) => f.value)
    ).toEqual([2360281000, 1479806000]);
    expect(
      revenue.every(
        (f) =>
          f.context.start === "2016-01-01" && f.context.end === "2016-12-31" && f.currency === "USD"
      )
    ).toBe(true);
    expect(p.metadata.find((m) => m.tag === "dei:DocumentFiscalYearFocus")?.lexical).toBe("2018");
    expect(p.metadata.find((m) => m.tag === "dei:DocumentPeriodEndDate")?.lexical).toBe(
      "2018-12-31"
    );
  });
  it("does not reverse the original sign of Albemarle other nonoperating expense", () => {
    const p = parseOriginalStandaloneXbrl(fixture("ALB"), "0000915913");
    const f = p.facts.find((f) => f.tag === "us-gaap:OtherNonoperatingIncomeExpense")!;
    expect(f.value).toBe(-20535000);
    expect(f.originalEvidence.lexical).toBe("-20535000");
    expect(p.facts.find((f) => f.tag === "us-gaap:GainLossOnSaleOfBusiness")?.value).toBe(
      122298000
    );
  });
  it("retains both Eversource original precision copies instead of selecting or balancing them", () => {
    const p = parseOriginalStandaloneXbrl(fixture("ES"), "0000072741");
    expect(p.facts.map((f) => f.value)).toEqual([7639129000, 7639100000]);
    expect(new Set(p.facts.map((f) => f.decimals)).size).toBe(2);
    expect(p.facts.every((f) => !Object.keys(f.context.dimensions).length)).toBe(true);
  });
  it.each(["BAX", "FDS"])(
    "retains %s self-closing nils and namespace bindings without inserting zero",
    (ticker) => {
      const p = parseOriginalStandaloneXbrl(
        fixture(ticker),
        ticker === "BAX" ? "0000010456" : "0001013237"
      );
      expect(p.nilFacts).toHaveLength(2);
      expect(
        p.nilFacts.every((f) => f.originalXml.endsWith("/>") && !Object.hasOwn(f, "value"))
      ).toBe(true);
      expect(
        p.nilFacts.some((f) =>
          p.facts.some((v) => v.originalEvidence.originalXml === f.originalXml)
        )
      ).toBe(false);
      expect(p.nilFacts[0].originalXml).toContain(
        ticker === "BAX" ? 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' : 'xs:nil="true"'
      );
    }
  );
  it("does not convert original TWD amounts or default-namespace resources to USD", () => {
    const p = parseOriginalStandaloneXbrl(fixture("TSM"), "0001046179");
    expect(p.namespaces[""]).toBe("http://www.xbrl.org/2003/instance");
    expect(p.facts[0].currency).toBe("TWD");
    expect(p.facts[0].value).toBe(947938300000);
    expect(p.facts[0].tag).toBe("ifrs-full:Revenue");
  });
  it("retains an exactly representable large HST amount without rescaling it", () => {
    const p = parseOriginalStandaloneXbrl(fixture("HST"), "0001070750");
    expect(p.facts[0].originalEvidence.lexical).toBe("15347835590000000");
    expect(BigInt(p.facts[0].value)).toBe(15347835590000000n);
    expect(p.facts[0].decimals).toBe(-6);
  });
  it("retains original Caterpillar QNames ending in a period without dropping or renaming them", () => {
    const p = parseOriginalStandaloneXbrl(fixture("CAT"), "0000018230");
    const f = p.facts.filter((f) => f.tag === "cat:ProceedsfromFinancialProducts.");
    expect(f.map((v) => v.value)).toEqual([5109000000, 8702000000, 8850000000]);
    expect(
      f.every((v) =>
        v.originalEvidence.originalXml.includes("</cat:ProceedsfromFinancialProducts.>")
      )
    ).toBe(true);
  });
  it("accepts legal XML decimal zero lexical forms while preserving them", () => {
    for (const lexical of [".0", "-.0", "+.0", "+000.00"]) {
      const p = parseOriginalStandaloneXbrl(ame.replace(">3840087000<", `>${lexical}<`), cik);
      const f = p.facts.find((f) => f.originalEvidence.lexical === lexical)!;
      expect(f).toBeDefined();
      expect(Math.abs(f.value)).toBe(0);
    }
  });
  it("marks unfamiliar segment content as unreviewed instead of nondimensional consolidated scope", () => {
    const xml = ame.replace(
      "</xbrli:entity>",
      "<xbrli:segment><ame:UnknownScope>private</ame:UnknownScope></xbrli:segment></xbrli:entity>"
    );
    const p = parseOriginalStandaloneXbrl(xml, cik);
    expect(p.contexts.some((c) => c.unreviewedScope)).toBe(true);
  });
  it.each([
    [
      "external entities",
      (s: string) => '<!DOCTYPE xbrl [<!ENTITY amount SYSTEM "https://example.invalid/">]>' + s
    ],
    [
      "foreign root",
      (s: string) =>
        s.replace(
          'xmlns:xbrli="http://www.xbrl.org/2003/instance"',
          'xmlns:xbrli="https://example.invalid/"'
        )
    ],
    ["missing closing root", (s: string) => s.replace(/<\/xbrli:xbrl>\s*$/, "")],
    [
      "missing resource",
      (s: string) => s.replace(/<xbrli:context\b[^>]*>[\s\S]*?<\/xbrli:context>/, "")
    ],
    [
      "duplicate context",
      (s: string) =>
        s.replace(
          "</xbrli:xbrl>",
          s.match(/<xbrli:context\b[^>]*>[\s\S]*?<\/xbrli:context>/)![0] + "</xbrli:xbrl>"
        )
    ],
    ["unresolved context", (s: string) => s.replace(/contextRef="[^"]*"/, 'contextRef="missing"')],
    ["unresolved unit", (s: string) => s.replace(/unitRef="[^"]*"/, 'unitRef="missing"')],
    ["invalid date", (s: string) => s.replace("2016-12-31", "2016-02-30")],
    ["missing precision", (s: string) => s.replace(/ decimals="-3"/, "")],
    ["inline rescaling", (s: string) => s.replace('decimals="-3"', 'decimals="-3" scale="3"')],
    ["inline sign", (s: string) => s.replace('decimals="-3"', 'decimals="-3" sign="-"')],
    ["unreported rounded integer", (s: string) => s.replace(">3840087000<", ">9007199254740993<")],
    [
      "malformed monetary closing tag",
      (s: string) =>
        s.replace(
          "</us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax>",
          "</ame:Unknown>"
        )
    ]
  ])("withholds %s", (_label, mutate) =>
    expect(() => parseOriginalStandaloneXbrl(mutate(ame), cik)).toThrow(OriginalStandaloneXbrlError)
  );
  it("withholds a nil declaration containing an amount", () => {
    const xml = fixture("BAX").replace(
      /(<us-gaap:CommitmentsAndContingencies\b[^>]*)\/>/,
      "$1>0</us-gaap:CommitmentsAndContingencies>"
    );
    expect(() => parseOriginalStandaloneXbrl(xml, "0000010456")).toThrow(
      /nil monetary declaration has content/
    );
  });
  it("enforces the requested byte bound and expected issuer", () => {
    expect(() => parseOriginalStandaloneXbrl(ame, cik, 1)).toThrow(/size/);
    expect(() => parseOriginalStandaloneXbrl(ame, "0000915913")).toThrow(/expected issuer/);
    expect(() => parseOriginalStandaloneXbrl(ame, cik, 129 * 1024 ** 2)).toThrow(/size bound/);
  });
});
