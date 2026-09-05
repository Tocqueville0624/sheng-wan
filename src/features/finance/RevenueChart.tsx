import { useRef } from "react";
import type { CompanyDataset, FinancialPeriod } from "./types";
import { buildRevenueHistory, revenueAdjustmentLabel, shortMoney, wrapLabel } from "./chart-model";
import { ChartExports, chartColors as colors, chartFont } from "./ChartExports";
import { CompanyLogo } from "./CompanyLogo";

const segmentColors = [
  { fill: "#245b78", text: "#ffffff" },
  { fill: "#347897", text: "#ffffff" },
  { fill: "#74aec4", text: "#14374a" },
  { fill: "#b0d1dc", text: "#14374a" },
  { fill: "#47786b", text: "#ffffff" },
  { fill: "#8ca9a1", text: "#153a34" },
  { fill: "#636f85", text: "#ffffff" },
  { fill: "#d2c3a5", text: "#443925" }
];

export function RevenueChart({
  periods,
  company
}: {
  periods: FinancialPeriod[];
  company: CompanyDataset;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const history = buildRevenueHistory(periods);
  const available = history.periods.filter((entry) => entry.available);
  const latest = available.at(-1)?.period;
  const demo = company.dataStatus === "demo";
  if (!latest) {
    return (
      <section className="finance-panel chart-empty" aria-labelledby="history-heading">
        <p className="micro-label">Business revenue</p>
        <h2 id="history-heading">A breakdown needs a source.</h2>
        <p>
          Reconciled business-category revenue is not available for {company.name} in this snapshot.
          Consolidated revenue is not substituted for a segment.
        </p>
        <a href={periods.at(-1)?.sourceUrl} target="_blank" rel="noreferrer">
          Read the original company filing
        </a>
      </section>
    );
  }
  const width = 1480;
  const left = 100;
  const right = 55;
  let legendX = left;
  let legendY = 130;
  const legend = history.series.map((series, index) => {
    const itemWidth = series.label.length * 8.5 + 50;
    if (legendX + itemWidth > width - right) {
      legendX = left;
      legendY += 32;
    }
    const item = {
      ...series,
      x: legendX,
      y: legendY,
      color: segmentColors[index % segmentColors.length]
    };
    legendX += itemWidth;
    return item;
  });
  const top = legendY + 70;
  const plotHeight = 430;
  const bottom = top + plotHeight;
  const hasAdjustments = available.some(({ period }) =>
    period.revenueAdjustments?.some((item) => item.revenue !== 0)
  );
  const adjustmentSpace = hasAdjustments ? 45 : 0;
  const sourceMap = new Map<string, string[]>();
  for (const { period } of available) {
    const url = period.segmentSourceUrl ?? period.sourceUrl;
    sourceMap.set(url, [...(sourceMap.get(url) ?? []), period.label]);
    if (period.fx) {
      sourceMap.set(period.fx.sourceUrl, [
        ...(sourceMap.get(period.fx.sourceUrl) ?? []),
        `${period.label}: ${period.fx.rate.toFixed(4)} TWD/USD`
      ]);
    }
  }
  const largest = Math.max(
    ...available.map(({ period }) => period.segments!.reduce((sum, item) => sum + item.revenue, 0))
  );
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  const max = Math.ceil(largest / magnitude / 0.2) * magnitude * 0.2;
  const unit = max >= 1e9 ? 1e9 : 1e6;
  const unitLabel = unit === 1e9 ? "USD billions" : "USD millions";
  const groupWidth = (width - left - right) / periods.length;
  const barWidth = Math.min(210, groupWidth * 0.7);
  const smallSeries = history.series.filter((series) =>
    available.some(({ period }) => {
      const value = period.segments!.find((segment) => segment.id === series.id)?.revenue ?? 0;
      return value > 0 && ((value / max) * plotHeight < 23 || barWidth < 42);
    })
  );
  const smallTableHeight = smallSeries.length ? 76 + smallSeries.length * 36 : 0;
  const sourceTop = bottom + adjustmentSpace + smallTableHeight;
  const basisChanged = new Set(available.map(({ period }) => period.segmentBasis)).size > 1;
  const quarterGaps =
    latest.kind === "quarterly" &&
    periods.some((period, index) => {
      const previous = periods[index - 1];
      return (
        previous &&
        period.fiscalYear * 4 +
          period.fiscalQuarter! -
          (previous.fiscalYear * 4 + previous.fiscalQuarter!) !==
          1
      );
    });
  const basisLines = wrapLabel(
    [
      latest.segmentBasis ??
        "Reported business categories; category definitions may change between filings.",
      basisChanged
        ? "Classification changes: a dash means not separately reported, not zero. Refer to each period's filing."
        : "",
      hasAdjustments
        ? "Bars show business subtotals; signed adjustments below each bar reconcile to consolidated revenue."
        : "",
      latest.fx
        ? "Original currency: TWD. Each period is converted using its Federal Reserve H.10 period-average exchange rate below."
        : "",
      quarterGaps
        ? "Only source-available fiscal quarters are shown. Gaps are not interpolated or estimated."
        : ""
    ]
      .filter(Boolean)
      .join(" "),
    165
  );
  const registerY = sourceTop + 101 + (basisLines.length - 1) * 19;
  let sourceY = registerY + 30;
  const sources = [...sourceMap].map(([url, labels]) => {
    const lines = wrapLabel(labels.join(" · "), 165);
    const source = { url, lines, y: sourceY };
    sourceY += lines.length * 19 + 28;
    return source;
  });
  const height = registerY + 24;
  const exportHeight = sourceY + 12;
  const compactNumber = (value: number) =>
    (value / unit).toLocaleString("en-US", {
      maximumFractionDigits: value > 0 && value / unit < 0.1 ? 3 : 1
    });
  const dataLabel = demo ? "DEMONSTRATION · SYNTHETIC VALUES" : "REPORTED COMPANY DATA";
  const periodText = latest.kind === "annual" ? "Annual" : "Quarterly";
  return (
    <section className="finance-panel history-panel" aria-labelledby="history-heading">
      <div className="panel-heading">
        <div>
          <p className="micro-label">Business revenue · {available.length} reported periods</p>
          <h2 id="history-heading">Where revenue comes from</h2>
        </div>
        <ChartExports
          svgRef={svgRef}
          filename={`${company.ticker.toLowerCase()}-${latest.kind}-business-revenue`}
          label="business revenue chart"
        />
      </div>
      <div
        className="chart-scroll"
        role="region"
        aria-label="Scrollable business revenue chart"
        tabIndex={0}
      >
        <svg
          ref={svgRef}
          className="history-chart finance-artboard"
          viewBox={`0 0 ${width} ${height}`}
          data-export-height={exportHeight}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={`${company.name} revenue by business category. ${periodText} stacked bars show ${available.length} reported periods. Exact values are available in the table below.`}
          fontFamily={chartFont}
          fontSize={16}
          fill={colors.ink}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          <rect data-chart-paper="" width={width} height={height} fill={colors.paper} />
          <text x={left} y={54} fontSize={34} fontWeight={700}>
            {company.name}
          </text>
          <text x={left} y={87} fill={colors.muted} fontSize={17}>
            Revenue by business · {periodText} · {periods[0].label} – {periods.at(-1)!.label} ·{" "}
            {unitLabel}
          </text>
          <CompanyLogo ticker={company.ticker} x={780} />
          <text
            x={width - right}
            y={48}
            textAnchor="end"
            fill={demo ? "#975325" : colors.muted}
            fontSize={13}
            fontWeight={700}
          >
            {dataLabel}
          </text>
          {legend.map((item) => (
            <g key={item.id}>
              <rect
                x={item.x}
                y={item.y - 13}
                width={15}
                height={15}
                rx={2}
                fill={item.color.fill}
              />
              <text x={item.x + 24} y={item.y} fontSize={16}>
                {item.label}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
            const y = bottom - fraction * plotHeight;
            return (
              <g key={fraction}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                  stroke={colors.grid}
                  strokeWidth={1}
                />
                <text x={left - 18} y={y + 5} textAnchor="end" fill={colors.muted} fontSize={15}>
                  {compactNumber(max * fraction)}
                </text>
              </g>
            );
          })}
          {history.periods.map(({ period, available: present }, index) => {
            const x = left + groupWidth * (index + 0.5);
            let accumulated = 0;
            return (
              <g key={period.id}>
                {present ? (
                  <>
                    {history.series.map((series, seriesIndex) => {
                      const value =
                        period.segments!.find((segment) => segment.id === series.id)?.revenue ?? 0;
                      const segmentHeight = (value / max) * plotHeight;
                      accumulated += segmentHeight;
                      const y = bottom - accumulated;
                      const palette = segmentColors[seriesIndex % segmentColors.length];
                      return (
                        <g key={series.id}>
                          <rect
                            x={x - barWidth / 2}
                            y={y}
                            width={barWidth}
                            height={segmentHeight}
                            fill={palette.fill}
                          />
                          {segmentHeight >= 23 && barWidth >= 42 && (
                            <text
                              x={x}
                              y={y + segmentHeight / 2 + 5}
                              textAnchor="middle"
                              fill={palette.text}
                              fontSize={barWidth < 55 ? 13 : 18}
                              fontWeight={700}
                            >
                              {compactNumber(value)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    <text
                      x={x}
                      y={bottom - accumulated - 14}
                      textAnchor="middle"
                      fontSize={periods.length > 12 ? 13 : 19}
                      fontWeight={700}
                    >
                      {shortMoney(period.segments!.reduce((sum, item) => sum + item.revenue, 0))}
                    </text>
                  </>
                ) : (
                  <>
                    <line
                      x1={x - barWidth / 2}
                      x2={x + barWidth / 2}
                      y1={bottom}
                      y2={bottom}
                      stroke={colors.muted}
                      strokeDasharray="4 4"
                    />
                    <text
                      x={x}
                      y={bottom - 16}
                      textAnchor="middle"
                      fontSize={13}
                      fill={colors.muted}
                    >
                      Unavailable
                    </text>
                  </>
                )}
                <text
                  x={x}
                  y={bottom + 28}
                  textAnchor="middle"
                  fill={colors.muted}
                  fontSize={periods.length > 12 ? 12 : 16}
                >
                  {period.kind === "annual"
                    ? `FY ${period.fiscalYear}`
                    : `Q${period.fiscalQuarter} FY${String(period.fiscalYear).slice(2)}`}
                </text>
                {hasAdjustments && present && (
                  <text
                    x={x}
                    y={bottom + 51}
                    textAnchor="middle"
                    fill={colors.muted}
                    fontSize={periods.length > 12 ? 10 : 13}
                  >
                    <tspan x={x}>
                      Adj.{" "}
                      {shortMoney(
                        (period.revenueAdjustments ?? []).reduce(
                          (sum, item) => sum + item.revenue,
                          0
                        )
                      )}
                    </tspan>
                    <tspan x={x} dy={18}>
                      Net {shortMoney(period.metrics.revenue)}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
          {smallSeries.length > 0 && (
            <g>
              <text x={left} y={bottom + adjustmentSpace + 64} fontSize={13} fill={colors.muted}>
                Small categories · {unitLabel} · values too small to label inside the bars
              </text>
              {periods.map((period, index) => (
                <text
                  key={period.id}
                  x={left + 280 + ((width - left - right - 280) / periods.length) * (index + 0.5)}
                  y={bottom + adjustmentSpace + 88}
                  textAnchor="middle"
                  fontSize={periods.length > 12 ? 10 : 12}
                  fontWeight={700}
                >
                  {period.kind === "annual"
                    ? `FY${period.fiscalYear}`
                    : `Q${period.fiscalQuarter} FY${String(period.fiscalYear).slice(2)}`}
                </text>
              ))}
              {smallSeries.map((series, row) => {
                const y = bottom + adjustmentSpace + 115 + row * 36;
                return (
                  <g key={series.id}>
                    <line
                      x1={left}
                      x2={width - right}
                      y1={y + 14}
                      y2={y + 14}
                      stroke={colors.grid}
                    />
                    <text x={left} y={y} fontSize={12} fill={colors.muted}>
                      {wrapLabel(series.label, 32).map((line, index) => (
                        <tspan key={line} x={left} dy={index ? 13 : 0}>
                          {line}
                        </tspan>
                      ))}
                    </text>
                    {periods.map((period, index) => {
                      const value = period.segments?.find((item) => item.id === series.id)?.revenue;
                      return (
                        <text
                          key={period.id}
                          x={
                            left +
                            280 +
                            ((width - left - right - 280) / periods.length) * (index + 0.5)
                          }
                          y={y}
                          textAnchor="middle"
                          fontSize={13}
                        >
                          {value === undefined ? "—" : compactNumber(value)}
                        </text>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          )}
          <line
            x1={left}
            x2={width - right}
            y1={sourceTop + 52}
            y2={sourceTop + 52}
            stroke={colors.grid}
          />
          <text x={left} y={sourceTop + 78} fill={colors.muted} fontSize={13}>
            {basisLines.map((line, index) => (
              <tspan key={line} x={left} dy={index ? 19 : 0}>
                {line}
              </tspan>
            ))}
          </text>
          <text x={left} y={registerY} fill={colors.muted} fontSize={13}>
            {demo
              ? "Synthetic design fixture. Not company results."
              : "Source register — company filings. Displayed amounts are rounded; stacks use exact reported figures."}
          </text>
          <text
            x={width - right}
            y={registerY}
            textAnchor="end"
            fill={colors.ink}
            fontSize={14}
            fontWeight={700}
          >
            Thales’ Olive
          </text>
          <g data-export-only="" aria-hidden="true" style={{ display: "none" }}>
            {sources.map((source) => (
              <g key={source.url}>
                <text x={left} y={source.y} fill={colors.muted} fontSize={13} fontWeight={700}>
                  {source.lines.map((line, index) => (
                    <tspan key={line} x={left} dy={index ? 19 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
                <text
                  x={left}
                  y={source.y + source.lines.length * 19}
                  fill={colors.muted}
                  fontSize={12}
                >
                  {source.url}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <p className="chart-note">
        Business categories, not profit metrics.{" "}
        {hasAdjustments
          ? "Bars show the business subtotal; separately reported adjustments reconcile it to net revenue below each bar."
          : "Each stack reconciles with reported revenue."}{" "}
        {latest.segmentBasis} Scroll horizontally on smaller screens.
        {basisChanged &&
          " Reporting categories changed within this history. A dash means a category was not separately reported; it does not mean zero. See each period's filing for its classification."}
      </p>
      <details className="chart-data-detail">
        <summary>View filing sources and business-revenue data</summary>
        <div
          className="source-register table-scroll"
          role="region"
          aria-label="Filing source register"
          tabIndex={0}
        >
          <ul>
            {[...sourceMap].map(([url, labels]) => (
              <li key={url}>
                <strong>{labels.join(" · ")}</strong>
                <a href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="table-scroll" role="region" aria-label="Business revenue data" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Period</th>
                {history.series.map((series) => (
                  <th scope="col" key={series.id}>
                    {series.label}
                  </th>
                ))}
                {hasAdjustments && <th scope="col">Revenue adjustments</th>}
                <th scope="col">Total revenue</th>
              </tr>
            </thead>
            <tbody>
              {history.periods.map(({ period, available: present }) => (
                <tr key={period.id}>
                  <th scope="row">
                    <a
                      href={period.segmentSourceUrl ?? period.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {period.label}
                    </a>
                  </th>
                  {history.series.map((series) => {
                    const segment = period.segments?.find((entry) => entry.id === series.id);
                    return (
                      <td key={series.id}>
                        {present
                          ? segment
                            ? `$${segment.revenue.toLocaleString("en-US")}`
                            : "Not separately reported"
                          : "Unavailable"}
                      </td>
                    );
                  })}
                  {hasAdjustments && (
                    <td>
                      {(period.revenueAdjustments ?? [])
                        .map(
                          (item) => `${revenueAdjustmentLabel(item)}: ${shortMoney(item.revenue)}`
                        )
                        .join("; ") || "None reported"}
                    </td>
                  )}
                  <td>${period.metrics.revenue.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
