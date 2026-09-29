import { useRef, useState } from "react";
import type { CompanyDataset, FinancialMetrics, FlowStatementPeriod } from "./types";
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
  const main = node.group === "main";
  const source = node.group === "segment";
  const detail =
    node.group === "detail" ||
    node.group === "tax" ||
    ((node.group === "equity" ||
      node.group === "discontinued" ||
      node.group === "noncontrolling") &&
      node.tone === "expense");
  const nonoperating = node.group === "nonoperating";
  const operatingAdjustment = node.group === "operating-adjustment";
  const taxBenefit = node.group === "tax-benefit";
  const positiveEquity =
    (node.group === "equity" || node.group === "discontinued") && node.tone === "profit";
  const minorityLoss = node.group === "noncontrolling" && node.tone === "profit";
  const upperInput =
    positiveEquity ||
    minorityLoss ||
    taxBenefit ||
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
  const titleY =
    main || node.group === "revenue-base"
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
        {shortMoney(node.amount)}
      </text>
      <text
        x={x}
        y={marginY}
        textAnchor={textAnchor}
        fill={colors.muted}
        fontSize={node.business ? 17 : 13}
      >
        {node.amount > 0 && node.amount / revenue < 0.001
          ? "<0.1%"
          : percent(node.amount / revenue)}
        {node.tone === "profit" && main ? " margin" : " of revenue"}
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
  periods: (FlowStatementPeriod & {
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
  const directOperatingFlow = layout.nodes.some((node) => node.id === "operating-costs");
  // The filing reports no operating-profit line; items run straight to pretax profit.
  const pretaxFlow = layout.nodes.some((node) => node.id === "other-items");
  const parentNet = period.metrics.noncontrollingInterestIncome !== undefined;
  const allocationNoteHeight = parentNet ? 24 : 0;
  const hasBusinesses = layout.nodes.some((node) => node.business);
  const businessNoteHeight = hasBusinesses ? 24 : 0;
  const directFlowNoteHeight = directOperatingFlow || pretaxFlow ? 24 : 0;
  const summedCosts =
    directOperatingFlow && period.metricSources?.totalOperatingCosts?.method === "calculated";
  const rounding = directOperatingFlow ? period.operatingReconciliation : undefined;
  const roundingNoteHeight = rounding?.amount ? 24 : 0;
  const graph = {
    ...layout,
    height:
      layout.height +
      (period.fx ? 48 : 0) +
      businessNoteHeight +
      directFlowNoteHeight +
      roundingNoteHeight +
      allocationNoteHeight
  };
  const footerTop =
    graph.height -
    (period.fx ? 126 : 78) -
    businessNoteHeight -
    directFlowNoteHeight -
    roundingNoteHeight -
    allocationNoteHeight;
  const hasSegments = graph.nodes.some((node) => node.group === "segment");
  const hasExpenseDetail = graph.nodes.some((node) => node.group === "detail");
  const sourceUrl = period.sourceUrl;
  const headerStatus = demo ? "DEMONSTRATION · SYNTHETIC VALUES" : "REPORTED COMPANY DATA";
  return (
    <section className="finance-panel flow-panel" aria-labelledby="flow-heading">
      <div className="panel-heading">
        <div>
          <p className="micro-label">Income statement</p>
          <h2 id="flow-heading">From revenue to net profit</h2>
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
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={`${company.name} ${period.label} income statement. Proportional flows connect revenue of ${shortMoney(period.metrics.revenue)} to ${parentNet ? "net profit attributable to the parent" : "net profit"} of ${shortMoney(period.metrics.netIncome)}. Every line item and exact amount is listed below.`}
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
              netIncomeAttribution: parentNet ? "parent" : undefined,
              operatingReconciliation: rounding,
              flow: pretaxFlow
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
              {pretaxFlow
                ? "Expense line detail is not separately available in this snapshot."
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
          {directOperatingFlow && (
            <text x={50} y={footerTop + 74} fill={colors.muted} fontSize={13}>
              {summedCosts
                ? "Total operating costs are the sum of the listed statement lines. No gross profit is estimated."
                : "Reported total operating costs connect revenue to operating profit. No gross profit is estimated."}
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
          {rounding?.amount ? (
            <text
              x={50}
              y={footerTop + 74 + directFlowNoteHeight + businessNoteHeight}
              fill={colors.muted}
              fontSize={13}
            >
              Source rounding: {rounding.amount > 0 ? "+" : ""}
              {shortMoney(rounding.amount)}. Original reported totals are unchanged.
            </text>
          ) : null}
          {parentNet && (
            <text
              x={50}
              y={footerTop + 74 + directFlowNoteHeight + businessNoteHeight + roundingNoteHeight}
              fill={colors.muted}
              fontSize={13}
            >
              Net profit is attributable to the parent. Noncontrolling interests are a profit
              allocation, not an operating expense.
            </text>
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
                  allocationNoteHeight
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
                  allocationNoteHeight
                }
              >
                {period.fx.sourceUrl}
              </text>
            </g>
          )}
        </svg>
      </div>
      <p className="chart-note">
        {pretaxFlow &&
          "This statement reports no operating-profit subtotal. Every item between revenue (or gross profit) and pretax profit, including interest and other non-operating items, is shown as one reported net amount; listed lines appear only when they exactly add up to it. "}
        {directOperatingFlow &&
          (summedCosts
            ? "This statement lists its operating costs without a gross-profit subtotal or a reported total. Total operating costs are the exact sum of those reported lines, which together with operating profit equal revenue; no gross profit is estimated. "
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
        {parentNet
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
                  node.id === "operating-rounding"
                    ? rounding!.amount
                    : node.id === "noncontrolling"
                      ? period.metrics.noncontrollingInterestIncome!
                      : node.id === "discontinued"
                        ? period.metrics.discontinuedOperationsIncome!
                        : (revenueAdjustment?.revenue ?? node.amount);
                return (
                  <tr key={node.id}>
                    <th scope="row">
                      {node.label}
                      {node.id === "other-opex" && <small> · derived remainder</small>}
                      {node.id === "operating-costs" && summedCosts && (
                        <small> · sum of the listed reported lines</small>
                      )}
                      {node.id === "noncontrolling" && <small> · profit attribution</small>}
                      {node.id === "operating-rounding" && (
                        <small>
                          {rounding!.amount < 0
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
              : "Revenue = cost of revenue + gross profit. Gross profit = operating expenses + operating profit. "}
          {!pretaxFlow && "Pretax profit = operating profit + net non-operating items. "}Pretax
          profit minus income tax plus separately reported after-tax equity-method income and
          discontinued operations
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
