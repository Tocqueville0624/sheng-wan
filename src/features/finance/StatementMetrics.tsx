import { useRef } from "react";
import { amount } from "./BasicHistory";
import { ChartExports, chartColors as colors, chartFont } from "./ChartExports";
import { CompanyLogo } from "./CompanyLogo";
import type { CompanyV2, PeriodV2 } from "./v2-types";

const metrics = [
  ["revenue", "Revenue"],
  ["grossProfit", "Gross profit"],
  ["operatingIncome", "Operating income"],
  ["pretaxIncome", "Pretax income"],
  ["incomeTax", "Income tax"],
  ["netIncome", "Net income"]
] as const;

/** Independent signed bars do not imply a balanced flow or estimate missing costs. */
export function StatementMetrics({ company, period }: { company: CompanyV2; period: PeriodV2 }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const values = metrics.flatMap(([key]) =>
    period.metrics[key] === undefined ? [] : [period.metrics[key]!]
  );
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low || 1;
  const x = (value: number) => 275 + ((value - low) / span) * 565;
  const zero = x(0);
  const width = 1060;
  const height = 685;
  const netRevenue = period.metricSources.revenue?.tag.endsWith("RevenuesNetOfInterestExpense");
  return (
    <section className="finance-panel" aria-labelledby="statement-metrics-heading">
      <div className="panel-heading">
        <div>
          <p className="micro-label">Selected reporting period</p>
          <h2 id="statement-metrics-heading">Financial metrics · {period.label}</h2>
        </div>
        <ChartExports
          svgRef={svgRef}
          filename={`${company.ticker.toLowerCase()}-${period.id.toLowerCase()}-financial-metrics`}
          label="financial metrics chart"
        />
      </div>
      <div
        className="chart-scroll"
        role="region"
        aria-label="Scrollable financial metrics chart"
        tabIndex={0}
      >
        <svg
          ref={svgRef}
          className="metrics-chart finance-artboard"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${company.name}, ${period.label}, ${period.displayCurrency}. Separate financial metrics on a common scale. Negative values extend left of zero. Unavailable metrics have no bar.`}
          style={{ fontFamily: chartFont }}
        >
          <metadata>
            {JSON.stringify({
              ticker: company.ticker,
              version: company.version,
              period: period.id,
              currency: period.displayCurrency,
              metrics: period.metrics,
              sources: period.metricSources,
              originalStatementCorroboration: period.originalStatementCorroboration
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
            {period.label} · {period.startDate} to {period.endDate} · {period.displayCurrency}
          </text>
          <CompanyLogo ticker={company.ticker} x={width - 225} />
          <text x={36} y={128} fontSize={14} fill={colors.muted}>
            Independent measures · common scale · missing values are not zero
          </text>
          <line x1={zero} x2={zero} y1={168} y2={527} stroke={colors.muted} />
          <text x={zero} y={157} textAnchor="middle" fontSize={12} fill={colors.muted}>
            0
          </text>
          {metrics.map(([key, title], i) => {
            const value = period.metrics[key];
            const label = key === "revenue" && netRevenue ? "Revenue, net of interest" : title;
            const y = 190 + i * 62;
            const derived = period.metricSources[key]?.method === "calculated";
            return (
              <g key={key} data-metric={key}>
                <text x={36} y={y + 5} fontSize={16} fill={colors.ink}>
                  {label}
                </text>
                {value !== undefined && (
                  <rect
                    x={Math.min(x(value), zero)}
                    y={y - 15}
                    width={Math.abs(x(value) - zero)}
                    height={28}
                    rx={2}
                    fill={
                      key === "incomeTax"
                        ? value < 0
                          ? colors.profit
                          : colors.expense
                        : value < 0
                          ? colors.expense
                          : key === "revenue"
                            ? colors.revenue
                            : colors.profit
                    }
                  >
                    <title>{`${label}: ${amount(value, period.displayCurrency)}${derived ? " (calculated)" : " (reported)"}`}</title>
                  </rect>
                )}
                <text x={1024} y={y + 5} textAnchor="end" fontSize={16} fill={colors.ink}>
                  {value === undefined ? "Not available" : amount(value, period.displayCurrency)}
                </text>
                {derived && (
                  <text x={1024} y={y + 23} textAnchor="end" fontSize={11} fill={colors.muted}>
                    calculated
                  </text>
                )}
              </g>
            );
          })}
          <line x1={36} x2={1024} y1={552} y2={552} stroke={colors.grid} />
          <text x={36} y={582} fontSize={13} fill={colors.muted}>
            Source: SEC filing dated {period.filedAt}. Values rounded for display; exact facts and
            sources are embedded.
          </text>
          <text x={36} y={605} fontSize={11} fill={colors.muted}>
            {period.sourceUrl}
          </text>
          <text x={36} y={633} fontSize={12} fill={colors.muted}>
            These measures have distinct accounting scopes. Bars are not additive and do not
            represent business segments.
          </text>
          <text x={1024} y={663} textAnchor="end" fontSize={13} fontWeight={700} fill={colors.ink}>
            Thales’ Olive · {company.version}
          </text>
        </svg>
      </div>
      <p className="chart-note">
        This view works with incomplete statements, financial institutions and losses. Each bar
        shows an available metric; missing costs and business splits are left unfilled. A
        profit-flow diagram is shown only when all of its accounting relationships reconcile.{" "}
        <a href={period.sourceUrl} target="_blank" rel="noreferrer">
          Read the original statement
        </a>
        .
      </p>
    </section>
  );
}
