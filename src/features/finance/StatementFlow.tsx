import { useRef, useState } from "react";
import type { CompanyDataset, FinancialMetrics, StatementChartPeriod } from "./types";
import type { MetricSource } from "./v2-types";
import {
  buildStatementFlow,
  businessGrossMargin,
  layoutStatementFlow,
  percent,
  shortMoney,
  wrapLabel,
  type PositionedNode
} from "./chart-model";
import { ChartExports, chartColors as colors, chartFont } from "./ChartExports";
import { CompanyLogo } from "./CompanyLogo";

function NodeLabel({ node, revenue }: { node: PositionedNode; revenue: number }) {
  const displayedAmount = node.signedAmount ?? node.amount;
  const main = node.group === "main";
  const source = node.group === "segment";
  const detail =
    node.group === "detail" ||
    node.group === "gross-cost-item" ||
    node.group === "tax" ||
    ((node.group === "equity" ||
      node.group === "subsidiary" ||
      node.group === "after-tax-transaction" ||
      node.group === "discontinued" ||
      node.group === "noncontrolling" ||
      node.group === "shareholder" ||
      node.group === "after-tax-adjustment") &&
      node.tone === "expense");
  const nonoperating = node.group === "nonoperating" || node.group === "direct-net-item";
  const operatingAdjustment =
    node.group === "operating-adjustment" || node.group === "after-tax-adjustment";
  const taxBenefit = node.group === "tax-benefit";
  const positiveEquity =
    (node.group === "equity" ||
      node.group === "subsidiary" ||
      node.group === "after-tax-transaction" ||
      node.group === "discontinued") &&
    node.tone === "profit";
  const minorityLoss = node.group === "noncontrolling" && node.tone === "profit";
  const upperInput =
    (node.group === "shareholder" && node.tone === "profit") ||
    positiveEquity ||
    minorityLoss ||
    taxBenefit ||
    (node.group === "operating-item" && node.tone === "profit") ||
    ((nonoperating || operatingAdjustment) && node.tone === "profit");
  const revenueLabel = node.id === "revenue" || node.group === "revenue-base";
  const labelLeft = source;
  const labelRight =
    revenueLabel ||
    detail ||
    node.group === "opex" ||
    ((nonoperating || operatingAdjustment) && node.tone === "expense");
  const x = labelLeft ? node.x - 18 : labelRight ? node.x + (revenueLabel ? 8 : 29) : node.x + 8;
  const textAnchor = labelLeft ? "end" : labelRight ? "start" : "middle";
  const lines = wrapLabel(
    node.label,
    node.group === "revenue-base" ? 16 : detail ? 20 : source || nonoperating ? 17 : 23
  );
  const lineHeight = main ? 24 : 20;
  const titleY = main
    ? node.y - (lines.length * lineHeight + 59)
    : node.group === "revenue-base"
      ? node.y - 83
      : source
        ? node.y + node.height / 2 - (lines.length * lineHeight + (node.business ? 49 : 21)) / 2
        : upperInput
          ? node.y - (lines.length * lineHeight + 49)
          : detail
            ? node.y - 5
            : node.group === "cost" || node.group === "adjustment"
              ? node.y + node.height + 28
              : node.group === "opex"
                ? node.y - 66
                : nonoperating ||
                    operatingAdjustment ||
                    node.group === "equity" ||
                    node.group === "subsidiary" ||
                    node.group === "after-tax-transaction" ||
                    node.group === "discontinued" ||
                    taxBenefit
                  ? node.y - 8
                  : node.y - 43 - (lines.length - 1) * lineHeight;
  // Leave room for the taller Arial fallback metrics used by Linux/Android.
  const valueY = titleY + lines.length * lineHeight + (main ? 12 : 4);
  const marginY = valueY + (main || node.business ? 23 : 21);
  return (
    <g data-flow-node={node.id}>
      <text
        x={x}
        y={titleY}
        textAnchor={textAnchor}
        fill={colors[node.tone]}
        fontSize={main ? 21 : 17}
        fontWeight={700}
      >
        {lines.map((line, index) => (
          <tspan x={x} dy={index === 0 ? 0 : lineHeight} key={line}>
            {line}
            {index < lines.length - 1 ? " " : ""}
          </tspan>
        ))}
      </text>
      <text
        x={x}
        y={valueY}
        textAnchor={textAnchor}
        fill={colors[node.tone]}
        fontSize={main ? 30 : 21}
        fontWeight={700}
      >
        {shortMoney(displayedAmount)}
      </text>
      <text
        x={x}
        y={marginY}
        textAnchor={textAnchor}
        fill={colors.muted}
        fontSize={node.business ? 17 : 13}
      >
        {node.amount > 0 && node.amount / revenue < 0.001
          ? displayedAmount < 0
            ? "<0.1% decrease"
            : "<0.1%"
          : percent(displayedAmount / revenue)}
        {main && !revenueLabel ? " margin" : " of revenue"}
      </text>
      {node.business && (
        <text x={x} y={marginY + 23} textAnchor={textAnchor} fill={colors.muted} fontSize={17}>
          Gross margin: {businessGrossMargin(node.business)}
        </text>
      )}
    </g>
  );
}

export function StatementFlow({
  periods,
  company,
  selection: controlledSelection,
  onSelectionChange,
  showPeriodSelect = true
}: {
  periods: (StatementChartPeriod & {
    metricSources?: Partial<Record<keyof FinancialMetrics, MetricSource>>;
  })[];
  company: CompanyDataset;
  selection?: string;
  onSelectionChange?: (id: string) => void;
  showPeriodSelect?: boolean;
}) {
  const [selection, setSelection] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const period =
    periods.find((entry) => entry.id === (controlledSelection ?? selection)) ?? periods.at(-1)!;
  const result = buildStatementFlow(period);
  const demo = company.dataStatus === "demo";
  const periodSelect = showPeriodSelect && (
    <label className="flow-period-select">
      Period{" "}
      <select
        value={period.id}
        onChange={(event) => (onSelectionChange ?? setSelection)(event.target.value)}
      >
        {[...periods].reverse().map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
  if (!result.ok) {
    return (
      <section className="finance-panel chart-empty" aria-labelledby="flow-heading">
        <div className="panel-heading">
          <div>
            <p className="micro-label">Income statement · {period.label}</p>
            <h2 id="flow-heading">Sankey unavailable for this statement</h2>
          </div>
          {periodSelect}
        </div>
        <p>{result.reason}</p>
        <a href={period.sourceUrl} target="_blank" rel="noreferrer">
          Read the original statement
        </a>
      </section>
    );
  }
  const layout = layoutStatementFlow(result.graph);
  const signedAccounting = result.graph.signedAccounting;
  const hasLoss = result.graph.nodes.some(
    (node) => node.group === "main" && (node.signedAmount ?? node.amount) < 0
  );
  const signedNoteHeight = hasLoss ? 48 : 0;
  const directOperatingFlow = layout.nodes.some((node) => node.id === "operating-costs");
  // The filing reports no operating-profit line; items run straight to pretax profit.
  const pretaxFlow = layout.nodes.some((node) => node.id === "other-items");
  const directNetFlow = !!period.directNetItems;
  const operatingNetFlow = !!period.operatingNetItems;
  const parentNet =
    period.shareholderBridge?.base.scope === "parent" ||
    period.metrics.noncontrollingInterestIncome !== undefined;
  const allocationNoteHeight = parentNet ? 24 : 0;
  const hasBusinesses = layout.nodes.some((node) => node.business);
  const businessNoteHeight = hasBusinesses ? 24 : 0;
  const directFlowNoteHeight =
    directOperatingFlow ||
    pretaxFlow ||
    directNetFlow ||
    operatingNetFlow ||
    period.operatingExpensesBasis
      ? 24
      : 0;
  const summedCosts =
    directOperatingFlow && period.metricSources?.totalOperatingCosts?.method === "calculated";
  const rounding = period.operatingReconciliation;
  const precisionNotes = [
    ...(period.shareholderBridge
      ? [
          `Common-shareholder income: ${shortMoney(period.shareholderBridge.common.amount)} after reported allocations. The preceding net income is unchanged.`
        ]
      : []),
    ...(rounding?.amount
      ? [
          `Operating source rounding: ${rounding.amount > 0 ? "+" : ""}${shortMoney(rounding.amount)}. Original reported totals are unchanged.`
        ]
      : []),
    ...(period.afterTaxReconciliation?.amount
      ? [
          `After-tax source rounding: ${period.afterTaxReconciliation.amount > 0 ? "+" : ""}${shortMoney(period.afterTaxReconciliation.amount)}. Reported net income is unchanged.`
        ]
      : []),
    ...(period.consolidatedIncomeSubtotal
      ? [
          `Intermediate consolidated net income: ${shortMoney(period.consolidatedIncomeSubtotal.amount)} as reported. Final parent income is reconciled independently.`
        ]
      : []),
    ...(period.roundedOperatingExpenseComponents
      ? [
          "Rounded expense components do not exactly partition the reported total; no remainder is invented."
        ]
      : [])
  ];
  const roundingNoteHeight = precisionNotes.length * 24;
  const graph = {
    ...layout,
    height:
      layout.height +
      (period.fx ? 48 : 0) +
      businessNoteHeight +
      directFlowNoteHeight +
      roundingNoteHeight +
      allocationNoteHeight +
      signedNoteHeight
  };
  const footerTop =
    graph.height -
    (period.fx ? 126 : 78) -
    businessNoteHeight -
    directFlowNoteHeight -
    roundingNoteHeight -
    allocationNoteHeight -
    signedNoteHeight;
  const hasSegments = graph.nodes.some((node) => node.group === "segment");
  const hasExpenseDetail = graph.nodes.some((node) => node.group === "detail");
  const sourceUrl = period.sourceUrl;
  const headerStatus = demo ? "DEMONSTRATION · SYNTHETIC VALUES" : "REPORTED COMPANY DATA";
  return (
    <section className="finance-panel flow-panel" aria-labelledby="flow-heading">
      <div className="panel-heading">
        <div>
          <p className="micro-label">Income statement</p>
          <h2 id="flow-heading">
            {hasLoss
              ? "Revenue, expenses and losses"
              : period.shareholderBridge
                ? "Revenue and shareholder income"
                : "From revenue to net profit"}
          </h2>
        </div>
        <div className="flow-controls">
          {periodSelect}
          <ChartExports
            svgRef={svgRef}
            filename={`${company.ticker.toLowerCase()}-${period.id}-income-statement`}
            label="income statement Sankey"
          />
        </div>
      </div>
      <div
        className="chart-scroll"
        role="region"
        aria-label="Scrollable income statement Sankey"
        tabIndex={0}
      >
        <svg
          ref={svgRef}
          className="flow-chart finance-artboard"
          data-signed-accounting={signedAccounting ? "true" : undefined}
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={`${company.name} ${period.label} income statement. Proportional accounting flows connect revenue of ${shortMoney(period.metrics.revenue)} to ${parentNet ? "net income or loss attributable to the parent" : "net income or loss"} of ${shortMoney(period.metrics.netIncome)}. Every line item and exact amount is listed below.`}
          fill={colors.ink}
          fontFamily={chartFont}
          fontSize={16}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <metadata>
            {JSON.stringify({
              ticker: company.ticker,
              period: period.id,
              startDate: period.startDate,
              endDate: period.endDate,
              displayCurrency: period.displayCurrency,
              sourceUrl,
              metricSources: period.metricSources ?? {},
              metrics: period.metrics,
              segments: period.segments,
              segmentBasis: period.segmentBasis,
              segmentSourceUrl: period.segmentSourceUrl,
              revenueAdjustments: period.revenueAdjustments,
              businessBreakdownSource: period.businessBreakdownSource,
              originalStatementCorroboration: period.originalStatementCorroboration,
              netIncomeAttribution: parentNet ? "parent" : undefined,
              shareholderBridge: period.shareholderBridge,
              operatingItems: period.operatingItems,
              grossOperatingItems: period.grossOperatingItems,
              alignInlineIncome: period.alignInlineIncome,
              dardenInlineIncome: period.dardenInlineIncome,
              directNetItems: period.directNetItems,
              operatingNetItems: period.operatingNetItems,
              afterTaxTransactionItems: period.afterTaxTransactionItems,
              operatingReconciliation: rounding,
              operatingExpensesBasis: period.operatingExpensesBasis,
              operatingExpenseDetails: period.operatingExpenseDetails,
              operatingCostDetails: period.operatingCostDetails,
              afterTaxReconciliation: period.afterTaxReconciliation,
              consolidatedIncomeSubtotal: period.consolidatedIncomeSubtotal,
              roundedOperatingExpenseComponents: period.roundedOperatingExpenseComponents,
              flow: signedAccounting
                ? "signed-accounting"
                : pretaxFlow
                  ? "pretax"
                  : directOperatingFlow
                    ? "direct-operating"
                    : "gross-profit",
              nodes: result.graph.nodes,
              links: result.graph.links
            })}
          </metadata>
          <rect width={graph.width} height={graph.height} fill={colors.paper} />
          <text x={50} y={54} fontSize={35} fontWeight={700}>
            {company.name}
          </text>
          <text x={50} y={85} fontSize={17} fill={colors.muted}>
            {period.label} · Income statement · USD · period ending {period.endDate}
          </text>
          <CompanyLogo ticker={company.ticker} x={620} />
          <text
            x={graph.width - 50}
            y={49}
            textAnchor="end"
            fontSize={13}
            fontWeight={700}
            fill={demo ? "#975325" : colors.muted}
          >
            {headerStatus}
          </text>
          <text x={graph.width - 50} y={77} textAnchor="end" fill={colors.muted} fontSize={13}>
            Every ribbon uses the same dollars-to-width scale.
          </text>
          <line x1={50} x2={graph.width - 50} y1={112} y2={112} stroke={colors.grid} />
          {graph.links.some((link) => link.width < 0.75) && (
            <text x={graph.width - 50} y={100} textAnchor="end" fill={colors.muted} fontSize={11}>
              Dotted leaders identify subpixel flows; they do not encode an amount.
            </text>
          )}
          {graph.links.map((link) => (
            <path
              key={`${link.source}-${link.target}`}
              d={link.path}
              fill={colors[`${link.tone}Ribbon`]}
            />
          ))}
          {graph.nodes.map((node) => (
            <rect
              key={node.id}
              data-flow-bar={node.id}
              x={node.x}
              y={node.y}
              width={graph.nodeWidth}
              height={node.height}
              fill={colors[node.tone]}
            />
          ))}
          {graph.links
            .filter((link) => link.width < 0.75)
            .map((link) => (
              <path
                key={`annotation-${link.source}-${link.target}`}
                d={link.annotationPath}
                fill="none"
                stroke={colors.muted}
                strokeWidth={0.7}
                strokeDasharray="2 4"
              />
            ))}
          {graph.nodes.map((node) => (
            <NodeLabel key={node.id} node={node} revenue={period.metrics.revenue} />
          ))}
          {!hasSegments && (
            <text x={50} y={150} fill={colors.muted} fontSize={13}>
              Business-category detail unavailable; flow begins at consolidated revenue.
            </text>
          )}
          {!hasExpenseDetail && (
            <text x={50} y={footerTop - 22} fill={colors.muted} fontSize={13}>
              {period.roundedOperatingExpenseComponents
                ? "Rounded expense components are preserved as independent metrics, not drawn as an exact partition."
                : pretaxFlow
                  ? "Expense line detail is not separately available in this snapshot."
                  : directNetFlow
                    ? "Original expense components and signed items are preserved in the chart metadata and CSV."
                    : "Operating expense detail is not separately available in this snapshot."}
            </text>
          )}
          <line x1={50} x2={graph.width - 50} y1={footerTop} y2={footerTop} stroke={colors.grid} />
          <text x={50} y={footerTop + 26} fill={colors.muted} fontSize={13}>
            {demo
              ? "Synthetic design fixture. Not company results."
              : `Source: ${company.name} company filing. Figures are rounded for display only; geometry uses exact amounts.`}
          </text>
          <text
            x={graph.width - 50}
            y={footerTop + 28}
            textAnchor="end"
            fill={colors.ink}
            fontSize={14}
            fontWeight={700}
          >
            Thales’ Olive
          </text>
          <text x={50} y={footerTop + 50} fill={colors.muted} fontSize={12}>
            {sourceUrl}
          </text>
          {pretaxFlow && (
            <text x={50} y={footerTop + 74} fill={colors.muted} fontSize={13}>
              No operating-profit line is reported; expenses and other items (net) lead to pretax
              profit. Nothing is estimated.
            </text>
          )}
          {directNetFlow && (
            <text x={50} y={footerTop + 74} fill={colors.muted} fontSize={13}>
              Reported revenue, total expenses and signed gains lead directly to net income; absent
              pretax and tax stages are omitted.
            </text>
          )}
          {operatingNetFlow && (
            <text x={50} y={footerTop + 74} fill={colors.muted} fontSize={13}>
              Original operating and net-income rows reconcile directly; no primary pretax subtotal
              is reported or inferred.
            </text>
          )}
          {directOperatingFlow && !operatingNetFlow && (
            <text x={50} y={footerTop + 74} fill={colors.muted} fontSize={13}>
              {period.operatingItems
                ? "Revenue plus reported operating gains equals total operating costs plus operating income. Original signs are preserved."
                : summedCosts
                  ? "Total operating costs are the sum of the listed statement lines. No gross profit is estimated."
                  : signedAccounting
                    ? "Reported total operating costs connect revenue to operating income or loss. No gross profit is estimated."
                    : "Reported total operating costs connect revenue to operating profit. No gross profit is estimated."}
            </text>
          )}
          {period.operatingExpensesBasis && (
            <text x={50} y={footerTop + 74} fill={colors.muted} fontSize={13}>
              {period.grossOperatingItems
                ? [
                    "alb-original-separate-income-v1",
                    "alb-original-inline-operating-gains-v1"
                  ].includes(period.grossOperatingItems.ruleId)
                  ? "Reported business-sale gains and operating expenses stay separate. Expense branches retain original amounts."
                  : "Cost-of-sales restructuring and operating reversals stay separate. Expense branches retain original amounts."
                : "Operating items (net) = reported gross profit minus operating income. Expense components are not inferred."}
            </text>
          )}
          {hasBusinesses && (
            <text
              x={50}
              y={footerTop + 74 + directFlowNoteHeight}
              fill={colors.muted}
              fontSize={14}
            >
              Business gross margin = gross profit ÷ business revenue. — = unavailable for this
              category and period; never estimated.
            </text>
          )}
          {precisionNotes.map((note, index) => (
            <text
              key={note}
              x={50}
              y={footerTop + 74 + directFlowNoteHeight + businessNoteHeight + index * 24}
              fill={colors.muted}
              fontSize={13}
            >
              {note}
            </text>
          ))}
          {parentNet && (
            <text
              x={50}
              y={footerTop + 74 + directFlowNoteHeight + businessNoteHeight + roundingNoteHeight}
              fill={colors.muted}
              fontSize={13}
            >
              {hasLoss ? "Net income or loss" : "Net profit"} is attributable to the parent.
              Noncontrolling interests are a profit allocation, not an operating expense.
            </text>
          )}
          {hasLoss && (
            <g fill={colors.muted} fontSize={13}>
              <text
                x={50}
                y={
                  footerTop +
                  74 +
                  directFlowNoteHeight +
                  businessNoteHeight +
                  roundingNoteHeight +
                  allocationNoteHeight
                }
              >
                Negative subtotals are reported losses. Their ribbons reconcile expenses exceeding
                income.
              </text>
              <text
                x={50}
                y={
                  footerTop +
                  98 +
                  directFlowNoteHeight +
                  businessNoteHeight +
                  roundingNoteHeight +
                  allocationNoteHeight
                }
              >
                Loss allocations may run toward earlier costs. These are accounting relationships;
                all reported signs are preserved.
              </text>
            </g>
          )}
          {period.fx && (
            <g fill={colors.muted} fontSize={12}>
              <text
                x={50}
                y={
                  footerTop +
                  74 +
                  businessNoteHeight +
                  directFlowNoteHeight +
                  roundingNoteHeight +
                  allocationNoteHeight +
                  signedNoteHeight
                }
              >
                Original currency: TWD. Converted at {period.fx.rate.toFixed(4)} TWD/USD, Federal
                Reserve H.10 period average ({period.fx.startDate}–{period.fx.endDate}).
              </text>
              <text
                x={50}
                y={
                  footerTop +
                  96 +
                  businessNoteHeight +
                  directFlowNoteHeight +
                  roundingNoteHeight +
                  allocationNoteHeight +
                  signedNoteHeight
                }
              >
                {period.fx.sourceUrl}
              </text>
            </g>
          )}
        </svg>
      </div>
      <p className="chart-note">
        {period.originalStatementCorroboration &&
          `This complete original statement agrees with the previously saved reported figures from the ${period.originalStatementCorroboration.prior.filedAt} filing. Both source records are retained in SVG and CSV downloads. `}
        {operatingNetFlow &&
          "The primary statement reports operating income followed by signed gains, interest, income tax and consolidated net income. Every original row and ownership allocation is preserved; no pretax subtotal is inferred. Independently disclosed metrics remain in the statement table and exports. "}
        {directNetFlow &&
          "This statement reports total expenses, including interest, and signed gains directly above consolidated net income. The flow preserves those reported values and the subsequent ownership allocations; no gross-profit, operating-profit, pretax or tax subtotal is inferred. "}
        {hasLoss &&
          "Negative income subtotals retain their reported signs. Loss ribbons reconcile expenses exceeding income and may run back toward the costs they cover; they show accounting allocations. Reported tax benefits and other gains offset expenses or losses. "}
        {period.shareholderBridge &&
          "Reported shareholder allocations lead from the unchanged consolidated or parent net-income subtotal to income available to common shareholders. "}
        {period.roundedOperatingExpenseComponents &&
          "The reported operating-expense total and its components differ within their declared source precision. The original components remain in the independent metrics and exports; no residual or rescaling is used to make an expense partition. "}
        {period.consolidatedIncomeSubtotal &&
          `The intermediate consolidated net-income subtotal is reported as ${shortMoney(period.consolidatedIncomeSubtotal.amount)} and corroborates pretax profit minus tax within declared source precision. The exact running arithmetic and the final parent net-income amount are preserved independently. `}
        {period.afterTaxReconciliation &&
          `A separate after-tax source-rounding flow of ${shortMoney(period.afterTaxReconciliation.amount)} reconciles the final net-income scope within declared precision; reported net income is unchanged. `}
        {period.dardenInlineIncome &&
          "The original primary statement reports discontinued operations after tax. Their signed amount connects continuing income to net income; tax-benefit figures embedded in the line label are retained as annotations and are not deducted again. All comparative and cumulative primary columns and original declarations remain in the exports. "}
        {period.grossOperatingItems &&
          (period.alignInlineIncome
            ? "Reported impairment expense and litigation settlement gains enter operating profit separately. The original signed after-tax equity-method loss enters net income after tax. All comparative primary rows, original amounts and declarations remain in the exports. "
            : [
                  "alb-original-separate-income-v1",
                  "alb-original-inline-operating-gains-v1"
                ].includes(period.grossOperatingItems.ruleId)
              ? `Reported operating expenses and gains from business sales enter operating profit separately. After-tax equity-method income, ${period.grossOperatingItems.ruleId === "alb-original-separate-income-v1" ? "discontinued operations and " : ""}minority attribution enter net profit in their reported scopes. Net operating expenses are calculated from the original signed statement lines; the source rows and reported precision remain in the exports. `
              : "The primary statement separately reports restructuring costs before gross profit and signed operating expense lines. Positive expense components keep their original values; a reported negative cost is shown separately as a reversal. The net operating expense sum, original source rows and declared precision remain in the exports. ")}
        {period.operatingExpensesBasis &&
          !period.grossOperatingItems &&
          "Operating expenses and other items (net) are the calculated difference between reported gross profit and operating income. Signed gains, equity income or rounded detail can prevent an exact expense partition; no component or balancing expense is invented. "}
        {pretaxFlow &&
          "This statement reports no operating-profit subtotal. Every item between revenue (or gross profit) and pretax profit, including interest and other non-operating items, is shown as one reported net amount; listed lines appear only when they exactly add up to it. "}
        {directOperatingFlow &&
          (period.operatingItems
            ? "Total operating costs are the exact sum of the reported cost lines. Separately reported operating gains or losses connect revenue, those costs and operating income; every original amount and sign is preserved. "
            : summedCosts
              ? "This statement lists its operating costs without a gross-profit subtotal or a reported total. Total operating costs are the exact sum of those reported lines, which together with operating profit equal revenue; no gross profit is estimated. "
              : signedAccounting
                ? "The flow uses reported total operating costs to connect revenue to operating income or loss; no gross profit is estimated. "
                : "This statement does not provide a complete, separate gross-profit breakdown. The flow uses reported total operating costs to connect revenue directly to operating profit; no gross profit is estimated. ")}
        {rounding?.amount ? (
          <>
            A separate source-rounding flow of {rounding.amount > 0 ? "+" : ""}
            {shortMoney(rounding.amount)} reconciles the reported precision; the reported totals
            remain unchanged.{" "}
            <a href={rounding.sourceUrl} target="_blank" rel="noreferrer">
              Source filing
            </a>
            .{" "}
          </>
        ) : null}
        {graph.links.some((link) => link.width < 0.75) &&
          "Dotted lines identify subpixel flows; they are annotations, not wider ribbons. "}
        {signedAccounting
          ? "Revenue is blue; gains are green; expenses and reported losses are coral. "
          : parentNet
            ? "Profit flows and incoming adjustments are green; costs, taxes and profit allocated to noncontrolling interests are coral. Noncontrolling interests are shown separately from net profit attributable to the parent. "
            : "Profit flows are green; expenses are coral. "}
        Non-operating items bridge operating and pretax profit; taxes are deducted and separately
        reported tax benefits flow into net profit. {period.segmentBasis} Scroll horizontally on
        smaller screens.
      </p>
      <details className="chart-data-detail">
        <summary>View exact amounts and reconciliation</summary>
        <div
          className="table-scroll"
          role="region"
          aria-label="Income statement amounts"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Line item</th>
                <th scope="col">Amount (USD)</th>
                <th scope="col">Share of revenue</th>
                {hasBusinesses && <th scope="col">Business gross profit (USD)</th>}
                {hasBusinesses && <th scope="col">Business gross margin</th>}
              </tr>
            </thead>
            <tbody>
              {graph.nodes.map((node) => {
                const revenueAdjustment = period.revenueAdjustments?.find(
                  (item) => node.id === `adjustment-${item.id}`
                );
                const signedAmount =
                  node.signedAmount ??
                  (node.id === "operating-rounding"
                    ? rounding!.amount
                    : node.id === "after-tax-rounding"
                      ? period.afterTaxReconciliation!.amount
                      : node.id === "noncontrolling"
                        ? period.metrics.noncontrollingInterestIncome!
                        : node.id === "discontinued"
                          ? period.metrics.discontinuedOperationsIncome!
                          : node.id === "subsidiary"
                            ? period.metrics.afterTaxSubsidiaryIncome!
                            : node.id === "after-tax-transaction"
                              ? period.metrics.afterTaxTransactionIncome!
                              : (revenueAdjustment?.revenue ?? node.amount));
                return (
                  <tr key={node.id}>
                    <th scope="row">
                      {node.label}
                      {node.id === "other-opex" && <small> · derived remainder</small>}
                      {node.id === "opex" && period.operatingExpensesBasis && (
                        <small>
                          {period.grossOperatingItems
                            ? [
                                "alb-original-separate-income-v1",
                                "alb-original-inline-operating-gains-v1"
                              ].includes(period.grossOperatingItems.ruleId)
                              ? " · sum of reported expense lines; business-sale gains separate"
                              : " · sum of positive reported expense lines; reversals separate"
                            : " · calculated from reported gross profit and operating income"}
                        </small>
                      )}
                      {node.id === "operating-costs" && summedCosts && (
                        <small> · sum of the listed reported lines</small>
                      )}
                      {node.id === "noncontrolling" && <small> · profit attribution</small>}
                      {(node.id === "operating-rounding" || node.id === "after-tax-rounding") && (
                        <small>
                          {signedAmount < 0
                            ? " · reported-precision decrease"
                            : " · reported-precision increase"}
                        </small>
                      )}
                    </th>
                    <td>
                      {signedAmount < 0 ? "−" : ""}$
                      {Math.abs(signedAmount).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td>{percent(signedAmount / period.metrics.revenue)}</td>
                    {hasBusinesses && (
                      <td>
                        {node.business?.grossProfit !== undefined
                          ? `$${node.business.grossProfit.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                          : node.business
                            ? "Unavailable"
                            : "Not applicable"}
                      </td>
                    )}
                    {hasBusinesses && (
                      <td>
                        {node.business ? businessGrossMargin(node.business) : "Not applicable"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {graph.nodes.some((node) => node.business?.grossProfitSource) && (
          <div className="business-margin-sources">
            <h3>Business gross margin sources</h3>
            {graph.nodes.flatMap((node) => {
              const source = node.business?.grossProfitSource;
              if (!source) return [];
              return [
                <p className="chart-note" key={node.id}>
                  <strong>{node.label}.</strong>{" "}
                  {source.method === "reported"
                    ? "Reported gross profit"
                    : "Reported cost of revenue"}
                  : {source.reportingCurrency}{" "}
                  {source.value.toLocaleString("en-US", { maximumFractionDigits: 2 })}.{" "}
                  <code>{source.tag}</code>. {source.startDate}–{source.endDate}.{" "}
                  <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                    Source filing
                  </a>
                  .
                </p>
              ];
            })}
          </div>
        )}
        <p className="chart-note">
          {pretaxFlow
            ? period.metrics.grossProfit !== undefined
              ? "Revenue = cost of revenue + gross profit. Gross profit = expenses and other items (net) + pretax profit. "
              : "Revenue = costs and other items (net) + pretax profit. "
            : directOperatingFlow
              ? rounding?.amount
                ? "Revenue minus total operating costs plus signed source rounding equals operating profit. "
                : "Revenue = total operating costs + operating profit. "
              : rounding?.amount
                ? "Revenue = cost of revenue + gross profit. Gross profit plus signed source rounding = operating expenses + operating profit. "
                : "Revenue = cost of revenue + gross profit. Gross profit = operating expenses + operating profit. "}
          {!pretaxFlow && "Pretax profit = operating profit + net non-operating items. "}Pretax
          profit minus income tax plus separately reported after-tax equity-method income,
          unconsolidated subsidiary income and discontinued operations
          {period.afterTaxReconciliation && " plus signed after-tax source rounding"}
          {parentNet
            ? " minus signed income attributable to noncontrolling interests equals net profit to the parent. "
            : " equals net profit. "}
          Business revenue plus disclosed adjustments and any labeled source rounding equals
          consolidated revenue.{" "}
          {hasBusinesses &&
            "Business gross margin divides the category’s reported gross profit, or revenue minus its reported cost of revenue, by that category’s revenue. — means unavailable for this category and period; no allocation is estimated. "}
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            Original filing
          </a>
          .
        </p>
      </details>
    </section>
  );
}
