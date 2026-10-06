import type { ShareholderIncomeBridge } from "./types";
import type { MetricSource } from "./v2-types";

export const commonIncomeTag = "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic";
export const dilutedIncomeTag = "us-gaap:NetIncomeLossAvailableToCommonStockholdersDiluted";
export const parentIncomeTags = new Set([
  "us-gaap:NetIncomeLoss",
  "ifrs-full:ProfitLossAttributableToOwnersOfParent"
]);
export const consolidatedIncomeTags = new Set(["us-gaap:ProfitLoss", "ifrs-full:ProfitLoss"]);
export const shareholderAllocationTags = new Set([
  "us-gaap:ConvertiblePreferredDividendsNetOfTax",
  "us-gaap:ParticipatingSecuritiesDistributedAndUndistributedEarningsLossDiluted"
]);
export const minorityIncomeTag =
  /^(?:us-gaap:(?:NetIncomeLossAttributableTo(?:Nonredeemable|Redeemable)?NoncontrollingInterest|NoncontrollingInterestInNetIncomeLoss\w*|IncomeLossFromContinuingOperationsAttributableToNoncontrollingEntity|IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableToNoncontrollingInterest|MinorityInterestInNetIncomeLossOfConsolidatedEntities)|ifrs-full:ProfitLossAttributableToNoncontrollingInterests)$/;

export function shareholderBridgeProblem(period: {
  shareholderBridge?: ShareholderIncomeBridge;
  metrics: { revenue?: number; netIncome?: number };
  metricSources?: { netIncome?: MetricSource };
  sourceUrl: string;
  accession?: string;
  filedAt: string;
  displayCurrency?: string;
  reportingCurrency?: string;
}) {
  const bridge = period.shareholderBridge;
  if (!bridge) return;
  const source = period.metricSources?.netIncome;
  const scope = parentIncomeTags.has(source?.tag ?? "")
    ? "parent"
    : consolidatedIncomeTags.has(source?.tag ?? "")
      ? "consolidated"
      : undefined;
  if (
    period.displayCurrency !== "USD" ||
    period.reportingCurrency !== "USD" ||
    bridge.sourceUrl !== period.sourceUrl ||
    bridge.accession !== period.accession ||
    bridge.filedAt !== period.filedAt ||
    !source ||
    source.method !== "reported" ||
    source.sourceUrl !== period.sourceUrl ||
    source.accession !== period.accession ||
    source.filedAt !== period.filedAt ||
    bridge.base.scope !== scope ||
    !bridge.base.label ||
    !bridge.common.label ||
    bridge.common.tag !== commonIncomeTag ||
    !Number.isFinite(bridge.base.amount) ||
    bridge.base.amount !== period.metrics.netIncome ||
    !Number.isFinite(bridge.common.amount) ||
    (bridge.base.tag !== source.tag &&
      !(
        bridge.base.tag === dilutedIncomeTag &&
        scope === "parent" &&
        bridge.base.corroboratingTag === source.tag
      )) ||
    (bridge.base.corroboratingTag !== undefined && bridge.base.corroboratingTag !== source.tag) ||
    !bridge.allocations.length ||
    new Set(bridge.allocations.map((a) => a.id)).size !== bridge.allocations.length ||
    bridge.allocations.some(
      (a) =>
        !a.id ||
        !a.label ||
        !Number.isFinite(a.amount) ||
        !(
          shareholderAllocationTags.has(a.tag) ||
          (scope === "consolidated" && minorityIncomeTag.test(a.tag))
        )
    ) ||
    [bridge.base, bridge.common, ...bridge.allocations].some(
      (a) => a.decimals !== undefined && !Number.isInteger(a.decimals)
    ) ||
    Math.abs(
      bridge.base.amount -
        bridge.allocations.reduce((sum, a) => sum + a.amount, 0) -
        bridge.common.amount
    ) > Math.max(1e-6, Math.abs(period.metrics.revenue ?? 0) * 1e-9)
  )
    return "The reported common-shareholder allocation does not reconcile with its source and net-income scope.";
}
