import { useRef, useState } from "react";
import type { CompanyDataset, FinancialPeriod } from "./types";
import {
  buildStatementFlow,
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
    (node.group === "equity" && node.tone === "expense");
  const nonoperating = node.group === "nonoperating";
  const taxBenefit = node.group === "tax-benefit";
  const positiveEquity = node.group === "equity" && node.tone === "profit";
  const upperInput = positiveEquity || taxBenefit || (nonoperating && node.tone === "profit");
  const revenueLabel = node.id === "revenue" || node.group === "revenue-base";
  const labelLeft = source;
  const labelRight =
    revenueLabel || detail || node.group === "opex" || (nonoperating && node.tone === "expense");
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
        ? node.y + node.height / 2 - (lines.length * lineHeight + 21) / 2
        : upperInput
          ? node.y - (lines.length * lineHeight + 49)
          : detail
            ? node.y - 5
            : node.group === "cost" || node.group === "adjustment"
              ? node.y + node.height + 28
              : node.group === "opex"
                ? node.y - 66
                : nonoperating || node.group === "equity" || taxBenefit
                  ? node.y - 8
                  : node.y - 43 - (lines.length - 1) * lineHeight;
  // Leave room for the taller Arial fallback metrics used by Linux/Android.
  const valueY = titleY + lines.length * lineHeight + (main ? 12 : 4);
  const marginY = valueY + (main ? 23 : 21);
  return (
    <g>
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
      <text x={x} y={marginY} textAnchor={textAnchor} fill={colors.muted} fontSize={13}>
        {node.amount > 0 && node.amount / revenue < 0.001
          ? "<0.1%"
          : percent(node.amount / revenue)}
        {node.tone === "profit" && main ? " margin" : " of revenue"}
      </text>
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
  periods: FinancialPeriod[];
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
  const graph = { ...layout, height: layout.height + (period.fx ? 48 : 0) };
  const footerTop = graph.height - (period.fx ? 126 : 78);
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
          aria-label={`${company.name} ${period.label} income statement. Proportional flows connect revenue of ${shortMoney(period.metrics.revenue)} to net profit of ${shortMoney(period.metrics.netIncome)}. Every line item and exact amount is listed below.`}
          fill={colors.ink}
          fontFamily={chartFont}
          fontSize={16}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
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
              Operating expense detail is not separately available in this snapshot.
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
          {period.fx && (
            <g fill={colors.muted} fontSize={12}>
              <text x={50} y={footerTop + 74}>
                Original currency: TWD. Converted at {period.fx.rate.toFixed(4)} TWD/USD, Federal
                Reserve H.10 period average ({period.fx.startDate}–{period.fx.endDate}).
              </text>
              <text x={50} y={footerTop + 96}>
                {period.fx.sourceUrl}
              </text>
            </g>
          )}
        </svg>
      </div>
      <p className="chart-note">
        {graph.links.some((link) => link.width < 0.75) &&
          "Dotted lines identify subpixel flows; they are annotations, not wider ribbons. "}
        Profit flows are green; expenses are coral. Non-operating items bridge operating and pretax
        profit; taxes are deducted and separately reported tax benefits flow into net profit.{" "}
        {period.segmentBasis} Scroll horizontally on smaller screens.
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
              </tr>
            </thead>
            <tbody>
              {graph.nodes.map((node) => (
                <tr key={node.id}>
                  <th scope="row">
                    {node.label}
                    {node.id === "other-opex" && <small> · derived remainder</small>}
                  </th>
                  <td>${node.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                  <td>{percent(node.amount / period.metrics.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="chart-note">
          Revenue = cost of revenue + gross profit. Gross profit = operating expenses + operating
          profit. Pretax profit = operating profit + net non-operating items. Pretax profit minus
          income tax plus separately reported after-tax equity-method income equals net profit.
          Business revenue plus separately reported revenue adjustments equals consolidated revenue.{" "}
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            Original filing
          </a>
          .
        </p>
      </details>
    </section>
  );
}
