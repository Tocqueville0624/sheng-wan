import { useRef } from "react";
import type { CompanyV2, PeriodV2 } from "./v2-types";
import { ChartExports, chartColors as colors, chartFont } from "./ChartExports";
import { CompanyLogo } from "./CompanyLogo";
import { historySlots } from "./history-slots";

export function amount(value: number | undefined, currency = "USD") {
  if (value === undefined) return "Not available";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

export function BasicHistory({
  company,
  periods,
  selected
}: {
  company: CompanyV2;
  periods: PeriodV2[];
  selected: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const currency = periods.at(-1)?.displayCurrency ?? "USD";
  const comparable = periods.filter((p) => p.displayCurrency === currency);
  const slots = historySlots(periods).map((slot) => ({
    ...slot,
    period: slot.period?.displayCurrency === currency ? slot.period : undefined
  }));
  const values = comparable.flatMap((p) =>
    [p.metrics.revenue, p.metrics.netIncome].filter((v): v is number => v !== undefined)
  );
  const rawLow = Math.min(0, ...values),
    rawHigh = Math.max(1, ...values);
  const rough = (rawHigh - rawLow) / 4,
    power = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / power;
  const tickStep = power * (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10);
  const lo = Math.floor(rawLow / tickStep) * tickStep,
    hi = Math.ceil(rawHigh / tickStep) * tickStep;
  const ticks = Array.from(
    { length: Math.round((hi - lo) / tickStep) + 1 },
    (_, i) => lo + i * tickStep
  );
  const width = Math.max(1060, slots.length * 76 + 170),
    height = 670;
  const plot = { left: 110, top: 165, height: 330, width: width - 165 };
  const y = (v: number) => plot.top + ((hi - v) / (hi - lo)) * plot.height;
  const step = plot.width / Math.max(1, slots.length);
  return (
    <section className="finance-panel" aria-labelledby="basic-heading">
      <div className="panel-heading">
        <div>
          <p className="micro-label">Consolidated financial history</p>
          <h2 id="basic-heading">Revenue and net income</h2>
        </div>
        <ChartExports
          svgRef={svgRef}
          filename={`${company.ticker.toLowerCase()}-${periods[0]?.kind}-consolidated-history`}
          label="consolidated financial history"
        />
      </div>
      <div
        className="chart-scroll"
        role="region"
        aria-label="Scrollable consolidated financial chart"
        tabIndex={0}
      >
        <svg
          ref={svgRef}
          className="history-chart finance-artboard"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${company.name} consolidated revenue and net income, ${currency}. Missing values have no bar; exact values and sources follow in the table.`}
          style={{ fontFamily: chartFont }}
        >
          <metadata>
            {JSON.stringify({
              ticker: company.ticker,
              version: company.version,
              currency,
              periods: periods.map((p) => ({ id: p.id, sources: p.metricSources }))
            })}
          </metadata>
          <rect width={width} height={height} fill={colors.paper} />
          <text
            x={36}
            y={55}
            fontSize={Math.min(27, (width - 310) / Math.max(1, company.name.length * 0.62))}
            fontWeight={700}
            fill={colors.ink}
          >
            {company.name}
          </text>
          <text x={36} y={84} fontSize={15} fill={colors.muted}>
            {periods[0]?.kind === "annual" ? "Annual" : "Quarterly"} · {currency} · consolidated
            totals, not business segments
          </text>
          <CompanyLogo ticker={company.ticker} x={width - 225} />
          <text x={36} y={126} fontSize={15} fill={colors.revenue}>
            Revenue
          </text>
          <text x={140} y={126} fontSize={15} fill={colors.profit}>
            Net income
          </text>
          <text x={270} y={126} fontSize={15} fill={colors.expense}>
            Net loss below zero
          </text>
          {ticks.map((v) => {
            return (
              <g key={v}>
                <line x1={plot.left} x2={width - 40} y1={y(v)} y2={y(v)} stroke={colors.grid} />
                <text
                  x={plot.left - 12}
                  y={y(v) + 5}
                  textAnchor="end"
                  fontSize={13}
                  fill={colors.muted}
                >
                  {amount(v, currency)}
                </text>
              </g>
            );
          })}
          <line
            x1={plot.left}
            x2={width - 40}
            y1={y(0)}
            y2={y(0)}
            stroke={colors.ink}
            strokeWidth={1}
          />
          {slots.map(({ period: p, fiscalYear, fiscalQuarter }, i) => (
            <g key={`${fiscalYear}-${fiscalQuarter}`}>
              {!p && (
                <text
                  x={plot.left + (i + 0.5) * step}
                  y={y(0) - 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill={colors.muted}
                >
                  No data
                </text>
              )}
              {p?.id === selected && (
                <rect
                  x={plot.left + i * step + 2}
                  y={plot.top - 8}
                  width={step - 4}
                  height={plot.height + 18}
                  fill={colors.revenue}
                  opacity={0.05}
                />
              )}
              {(["revenue", "netIncome"] as const).map((key, j) => {
                const v = p?.metrics[key];
                if (v === undefined) return null;
                return (
                  <rect
                    key={key}
                    x={plot.left + i * step + step * 0.18 + j * step * 0.32}
                    y={Math.min(y(v), y(0))}
                    width={step * 0.28}
                    height={Math.abs(y(v) - y(0))}
                    fill={
                      key === "revenue" ? colors.revenue : v < 0 ? colors.expense : colors.profit
                    }
                  >
                    <title>
                      {p!.label} {key}: {amount(v, currency)}
                    </title>
                  </rect>
                );
              })}
              <text
                x={plot.left + (i + 0.5) * step}
                y={525}
                textAnchor="middle"
                fontSize={13}
                fill={colors.ink}
              >
                <tspan x={plot.left + (i + 0.5) * step}>
                  {fiscalQuarter ? `Q${fiscalQuarter}` : "FY"}
                </tspan>
                <tspan x={plot.left + (i + 0.5) * step} dy={18}>
                  {fiscalYear}
                </tspan>
              </text>
            </g>
          ))}
          <line x1={36} x2={width - 36} y1={583} y2={583} stroke={colors.grid} />
          <text x={36} y={610} fontSize={13} fill={colors.muted}>
            Source: SEC company filings. Missing periods are not estimated. Values rounded only for
            display.
          </text>
          <text x={36} y={632} fontSize={11} fill={colors.muted}>
            {periods.at(-1)?.sourceUrl}
          </text>
          <text
            x={width - 36}
            y={654}
            textAnchor="end"
            fontSize={13}
            fontWeight={700}
            fill={colors.ink}
          >
            Thales’ Olive · {company.version}
          </text>
        </svg>
      </div>
      <p className="chart-note">
        These bars show consolidated totals, not a business breakdown. Gaps have no bar; negative
        income is shown below zero. Reporting scopes and exact sources are listed below.
        {comparable.length !== periods.length
          ? ` Only ${currency} periods are plotted; other currencies remain in the table.`
          : ""}
      </p>
    </section>
  );
}
