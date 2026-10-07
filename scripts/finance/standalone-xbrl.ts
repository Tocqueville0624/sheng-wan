import { XMLParser } from "fast-xml-parser";
import type { XbrlFact, XbrlContext } from "./ixbrl";

export class OriginalStandaloneXbrlError extends Error {}
function demand(value: unknown, message: string): asserts value {
  if (!value) throw new OriginalStandaloneXbrlError(message);
}
type XmlNode = Record<string, unknown>;
export type OriginalInstanceContext = XbrlContext & {
  originalXml: string;
  /** Non-dimensional content in a segment/scenario is retained, never interpreted
   * as an unqualified consolidated fact by a later source reader. */
  unreviewedScope: boolean;
};
export type OriginalInstanceUnit = {
  id: string;
  measures: string[];
  divided: boolean;
  originalXml: string;
};
export type OriginalInstanceDeclaration = {
  tag: string;
  contextId: string;
  unitRef: string;
  originalXml: string;
  originalDecimals?: string;
  originalPrecision?: string;
};
export type OriginalInstanceFact = XbrlFact & {
  context: OriginalInstanceContext;
  originalEvidence: OriginalInstanceDeclaration & {
    lexical: string;
    unit: OriginalInstanceUnit;
  };
};
export type OriginalInstance = {
  originalRoot: string;
  namespaces: Record<string, string>;
  contexts: OriginalInstanceContext[];
  units: OriginalInstanceUnit[];
  facts: OriginalInstanceFact[];
  nilFacts: (OriginalInstanceDeclaration & { context: OriginalInstanceContext })[];
  metadata: {
    tag: string;
    contextId: string;
    lexical: string;
    originalXml: string;
  }[];
};
const local = (name: string) => name.split(":").at(-1);
const text = (node: unknown): string =>
  typeof node === "string"
    ? node
    : node && typeof node === "object"
      ? String((node as XmlNode)["#text"] ?? "")
      : "";
const descendants = (node: unknown, name: string): unknown[] => {
  if (!node || typeof node !== "object") return [];
  const found: unknown[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@") || key === "#text") continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (local(key) === name) found.push(child);
      found.push(...descendants(child, name));
    }
  }
  return found;
};
const date = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  trimValues: true
});
const firstNode = (xml: string): XmlNode => {
  const parsed = parser.parse(xml) as XmlNode;
  demand(Object.keys(parsed).length === 1, "Ambiguous original XML fragment.");
  const node = Object.values(parsed)[0];
  demand(
    node && typeof node === "object" && !Array.isArray(node),
    "Invalid original XML resource."
  );
  return node as XmlNode;
};
const bindings = (node: XmlNode, inherited: Record<string, string>) => {
  const resolved = { ...inherited };
  for (const [name, value] of Object.entries(node)) {
    if (name === "@xmlns") resolved[""] = String(value);
    else if (name.startsWith("@xmlns:")) resolved[name.slice(7)] = String(value);
  }
  return resolved;
};

/** Read the original separate XBRL instance. This does not create inline markup,
 * rename concepts, resolve business meanings, join visible HTML cells, derive a
 * period or publish chart coverage. Consumers must establish those separately.
 * The normal cloud source bound remains 24 MiB; larger explicit local audits
 * never increase the Worker download limit. */
export function parseOriginalStandaloneXbrl(
  xml: string,
  expectedCik: string,
  maxDocumentBytes = 24 * 1024 ** 2
): OriginalInstance {
  demand(/^\d{10}$/.test(expectedCik) && Number(expectedCik) > 0, "Invalid original issuer.");
  demand(
    Number.isSafeInteger(maxDocumentBytes) &&
      maxDocumentBytes > 0 &&
      maxDocumentBytes <= 128 * 1024 ** 2,
    "Invalid original instance size bound."
  );
  demand(
    new TextEncoder().encode(xml).length <= maxDocumentBytes && !/<!DOCTYPE|<!ENTITY/i.test(xml),
    "Unsupported original XML size or entity declarations."
  );
  const prolog = xml.match(/^\s*(?:<\?xml\b[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/)?.[0] ?? "";
  demand(prolog.length <= 262144, "Oversized original XML prolog.");
  const root = xml.slice(prolog.length).match(/^<((?:[\w.-]+:)?xbrl)\b([^>]*)>/);
  demand(root && !/<ix:nonFraction\b/i.test(xml), "Missing original standalone XBRL root.");
  const originalRoot = root[0];
  const rootNode = firstNode(originalRoot.replace(/>$/, "/>"));
  const namespaces = bindings(rootNode, {});
  const prefix = root[1].includes(":") ? root[1].split(":")[0] : "";
  demand(
    namespaces[prefix] === "http://www.xbrl.org/2003/instance" &&
      new RegExp(`<\\/${root[1]}\\s*>\\s*$`).test(xml),
    "Invalid original instance namespace or closing root."
  );
  const contexts = new Map<string, OriginalInstanceContext>();
  const units = new Map<string, OriginalInstanceUnit>();
  for (const tag of ["context", "unit"] as const) {
    const rx = new RegExp(`<((?:[\\w.-]+:)?${tag})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "g");
    for (const match of xml.matchAll(rx)) {
      const raw = match[0],
        resourcePrefix = match[1].includes(":") ? match[1].split(":")[0] : "";
      demand(
        raw.length <= 262144 && namespaces[resourcePrefix] === "http://www.xbrl.org/2003/instance",
        "Unreviewed original resource namespace or size."
      );
      const node = firstNode(raw),
        id = node["@id"];
      demand(
        typeof id === "string" && id.length > 0 && id.length <= 4096,
        "Missing original resource ID."
      );
      if (tag === "unit") {
        demand(!units.has(id), "Duplicate original unit ID.");
        const measures = descendants(node, "measure").map(text);
        demand(
          measures.length > 0 && measures.every((m) => m.length > 0 && m.length <= 250),
          "Missing original unit measures."
        );
        units.set(id, {
          id,
          measures,
          divided: descendants(node, "divide").length > 0,
          originalXml: raw
        });
        continue;
      }
      demand(!contexts.has(id), "Duplicate original context ID.");
      const identifiers = descendants(node, "identifier");
      demand(
        identifiers.length === 1 &&
          (identifiers[0] as XmlNode)["@scheme"] === "http://www.sec.gov/CIK",
        "Ambiguous original issuer resource."
      );
      const cik = text(identifiers[0]);
      demand(/^\d+$/.test(cik) && Number(cik) > 0, "Invalid original issuer declaration.");
      const starts = descendants(node, "startDate").map(text),
        ends = descendants(node, "endDate").map(text),
        instants = descendants(node, "instant").map(text);
      demand(
        (starts.length === 1 && ends.length === 1 && !instants.length) ||
          (!starts.length && !ends.length && instants.length === 1),
        "Invalid original period resource."
      );
      const start = starts[0],
        end = ends[0] ?? instants[0];
      demand(
        date(end) && (!start || (date(start) && start <= end)),
        "Invalid original context dates."
      );
      const dimensions: Record<string, string> = {};
      for (const member of descendants(node, "explicitMember")) {
        const axis = (member as XmlNode)["@dimension"],
          value = text(member);
        demand(
          typeof axis === "string" &&
            /^[\w.-]+:[\w.-]+$/.test(axis) &&
            /^[\w.-]+:[\w.-]+$/.test(value) &&
            !Object.hasOwn(dimensions, axis) &&
            namespaces[axis.split(":")[0]] &&
            namespaces[value.split(":")[0]],
          "Invalid or duplicate original axis."
        );
        dimensions[axis] = value;
      }
      const scoped = [...descendants(node, "segment"), ...descendants(node, "scenario")];
      const unreviewedScope = scoped.some(
        (n) =>
          !n ||
          typeof n !== "object" ||
          Object.keys(n).some(
            (k) =>
              !k.startsWith("@") &&
              !(k === "#text" && !String((n as XmlNode)[k]).trim()) &&
              !["explicitMember", "typedMember"].includes(local(k)!)
          )
      );
      contexts.set(id, {
        id,
        cik,
        start,
        end,
        dimensions,
        typed: descendants(node, "typedMember").length > 0,
        unreviewedScope,
        originalXml: raw
      });
    }
  }
  demand(
    contexts.size > 0 && contexts.size <= 100000 && units.size > 0 && units.size <= 1000,
    "Missing or oversized original resources."
  );
  const facts: OriginalInstanceFact[] = [],
    nilFacts: OriginalInstance["nilFacts"] = [],
    metadata: OriginalInstance["metadata"] = [];
  let declarations = 0;
  // Original empty/self-closing nil declarations are retained as missing, never
  // zero. Resource elements and text blocks lack monetary context/unit refs.
  const rx = /<([\w.-]+:[\w.-]+)(?=[\s/>])([^>]*?)(?:\/>|>([^<]*)<\/\1\s*>)/g;
  let expectedDeclarations = 0;
  for (const match of xml.matchAll(/<([\w.-]+:[\w.-]+)(?=[\s/>])([^>]*?)\/?\s*>/g)) {
    if (
      /(?:^|\s)contextRef\s*=/.test(match[2]) &&
      (/(?:^|\s)unitRef\s*=/.test(match[2]) ||
        /^dei:Document(?:FiscalYearFocus|FiscalPeriodFocus|PeriodEndDate)$/.test(match[1]))
    )
      expectedDeclarations++;
  }
  for (const match of xml.matchAll(rx)) {
    if (!/(?:^|\s)contextRef\s*=/.test(match[2])) continue;
    if (
      !/(?:^|\s)unitRef\s*=/.test(match[2]) &&
      !/^dei:Document(?:FiscalYearFocus|FiscalPeriodFocus|PeriodEndDate)$/.test(match[1])
    )
      continue;
    const raw = match[0],
      tag = match[1],
      node = firstNode(raw),
      contextId = node["@contextRef"];
    if (!contextId) continue;
    demand(
      ++declarations <= 100000 &&
        raw.length <= 262144 &&
        typeof contextId === "string" &&
        namespaces[tag.split(":")[0]],
      "Invalid original fact declaration."
    );
    const context = contexts.get(contextId);
    demand(context, "Unresolved original fact context.");
    const unitRef = node["@unitRef"],
      lexical = (match[3] ?? "").trim();
    if (!unitRef) {
      if (/^dei:Document(?:FiscalYearFocus|FiscalPeriodFocus|PeriodEndDate)$/.test(tag))
        metadata.push({ tag, contextId, lexical, originalXml: raw });
      continue;
    }
    demand(typeof unitRef === "string", "Invalid original unit reference.");
    const unit = units.get(unitRef);
    demand(unit, "Unresolved original monetary unit.");
    const measure = unit.measures[0],
      money = measure.match(/^([\w.-]+):([A-Z]{3})$/);
    if (
      unit.divided ||
      unit.measures.length !== 1 ||
      !money ||
      namespaces[money[1]] !== "http://www.xbrl.org/2003/iso4217"
    )
      continue;
    const originalDecimals = node["@decimals"],
      originalPrecision = node["@precision"];
    const evidence: OriginalInstanceDeclaration = {
      tag,
      contextId,
      unitRef,
      originalXml: raw,
      ...(typeof originalDecimals === "string" ? { originalDecimals } : {}),
      ...(typeof originalPrecision === "string" ? { originalPrecision } : {})
    };
    const factBindings = bindings(node, namespaces);
    const nilAttributes = Object.keys(node).filter(
      (name) =>
        /^@[^:]+:nil$/.test(name) &&
        factBindings[name.slice(1).split(":")[0]] === "http://www.w3.org/2001/XMLSchema-instance"
    );
    demand(nilAttributes.length <= 1, "Conflicting original nil declarations.");
    const nil = nilAttributes.length ? node[nilAttributes[0]] : undefined;
    if (nil !== undefined) {
      demand(
        ["true", "false", "1", "0"].includes(String(nil)),
        "Invalid original nil declaration."
      );
      if (nil === "true" || nil === "1") {
        demand(!lexical, "Original nil monetary declaration has content.");
        nilFacts.push({ ...evidence, context });
        continue;
      }
    }
    demand(
      /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(lexical),
      "Unreviewed original monetary lexical format."
    );
    const value = Number(lexical);
    const integerPart = lexical.split(".")[0],
      integerLexical =
        !integerPart || integerPart === "+" ? "0" : integerPart === "-" ? "-0" : integerPart;
    demand(
      Number.isFinite(value) &&
        (!Number.isInteger(value) ||
          (/^[-+]?(?:\d+(?:\.0*)?|\.0+)$/.test(lexical) &&
            BigInt(value) === BigInt(integerLexical))),
      "Nonfinite or unsafe original monetary amount."
    );
    demand(
      typeof originalDecimals === "string" &&
        (originalDecimals === "INF" || /^-?\d+$/.test(originalDecimals)) &&
        originalPrecision === undefined,
      "Missing or unreviewed original monetary precision."
    );
    demand(
      node["@scale"] === undefined && node["@sign"] === undefined && node["@format"] === undefined,
      "Standalone XML cannot be silently transformed, rescaled or re-signed."
    );
    facts.push({
      tag,
      context,
      currency: money[2],
      value,
      decimals: originalDecimals === "INF" ? Infinity : Number(originalDecimals),
      originalEvidence: { ...evidence, lexical, unit }
    });
  }
  demand(
    declarations === expectedDeclarations,
    "Unresolved or malformed original fact declarations."
  );
  demand(
    facts.some((f) => Number(f.context.cik) === Number(expectedCik)),
    "No original monetary declarations for the expected issuer."
  );
  return {
    originalRoot,
    namespaces,
    facts,
    nilFacts,
    metadata,
    contexts: [...contexts.values()],
    units: [...units.values()]
  };
}
