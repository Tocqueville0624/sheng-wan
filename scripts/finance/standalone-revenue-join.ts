import { createHash } from "node:crypto";
import {
  readOriginalStandaloneRevenueRows,
  type OriginalStandaloneSource,
  type OriginalStandaloneTableSelection
} from "./standalone-revenue-reader";
export { OriginalStandaloneRevenueJoinError } from "./standalone-revenue-reader";
export type {
  OriginalStandaloneSource,
  OriginalStandaloneTableSelection
} from "./standalone-revenue-reader";
/** Local synchronous wrapper. Runtime acquisition uses native Web Crypto to pin
 * both original bodies before calling the shared source reader. */
export function joinOriginalStandaloneRevenueRows(
  source: OriginalStandaloneSource,
  selections: OriginalStandaloneTableSelection[]
) {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  return readOriginalStandaloneRevenueRows(source, selections, {
    primarySha256: hash(source.primaryHtml),
    instanceSha256: hash(source.instanceXml)
  });
}
