import { useEffect, useRef, useState } from "react";
import { RevenueChart } from "./RevenueChart";
import { StatementFlow } from "./StatementFlow";
import { amount } from "./BasicHistory";
import { downloadFile } from "./ChartExports";
import { percent } from "./chart-model";
import { statementPeriod, validateV2 } from "../../../scripts/finance/v2-model";
import type { CompanyDataset, PeriodKind } from "./types";
import {
  pendingJob,
  type CatalogCompany,
  type CompanyResponse,
  type CompanyV2,
  type FinanceCatalog,
  type FinanceJob
} from "./v2-types";
import "./thales.css";

type Props = { initialCompany: CompanyV2; featured: CatalogCompany[]; canonicalHost: string };
type Selection = { ticker: string; kind: PeriodKind; id: string };
type CatalogEntry = CatalogCompany & { status?: "ready" | "available" | "processing" };
const labels = {
  revenue: "Revenue",
  grossProfit: "Gross profit",
  operatingIncome: "Operating income",
  netIncome: "Net income"
};
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString("en-US", {
        timeZone: "UTC",
        dateStyle: "medium",
        timeStyle: "short"
      }) + " UTC"
    : "Not checked yet";
const api = "/api/finance/v2";
function readSelection(): Selection {
  const url = new URL(location.href);
  const ticker = url.searchParams.get("ticker")?.toUpperCase().replace("-", ".") ?? "AAPL";
  return {
    ticker: /^[A-Z0-9.]{1,12}$/.test(ticker) ? ticker : "AAPL",
    kind: url.searchParams.get("period") === "quarterly" ? "quarterly" : "annual",
    id: url.searchParams.get("statement") ?? ""
  };
}
function selectionUrl(selection: Selection) {
  const url = new URL(location.href);
  url.searchParams.set("ticker", selection.ticker);
  url.searchParams.set("period", selection.kind);
  if (selection.id) url.searchParams.set("statement", selection.id);
  else url.searchParams.delete("statement");
  return url;
}
async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      (body as { error?: { message?: string } }).error?.message ??
        "The service is unavailable. Saved data has not changed."
    );
  return body as T;
}

export default function ThalesOlive({ initialCompany, featured, canonicalHost }: Props) {
  const [selection, setSelection] = useState<Selection>({
    ticker: initialCompany.ticker,
    kind: "annual",
    id: ""
  });
  const [hydrated, setHydrated] = useState(false);
  const [datasets, setDatasets] = useState<Record<string, CompanyV2>>({
    [initialCompany.ticker]: initialCompany
  });
  const [catalog, setCatalog] = useState<CatalogEntry[]>(
    featured.map((c) => ({ ...c, status: "ready" }))
  );
  const [catalogMeta, setCatalogMeta] = useState<FinanceCatalog>();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(24);
  const [job, setJob] = useState<FinanceJob | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const activeTicker = useRef(selection.ticker);
  activeTicker.current = selection.ticker;
  const datasetRef = useRef(datasets);
  datasetRef.current = datasets;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const company = datasets[selection.ticker];
  const periods = company?.[selection.kind] ?? [];
  const current = periods.find((p) => p.id === selection.id) ?? periods.at(-1);
  const identity = catalog.find((c) => c.ticker === selection.ticker);
  const busy = pendingJob(job);
  const filtered: CatalogEntry[] = query.trim()
    ? catalog.filter((c) =>
        (c.ticker + " " + c.name).toLowerCase().includes(query.trim().toLowerCase())
      )
    : [
        ...featured.map((f) => catalog.find((c) => c.ticker === f.ticker) ?? f),
        ...catalog.filter(
          (c) => c.ticker === selection.ticker && !featured.some((f) => f.ticker === c.ticker)
        )
      ];
  const choose = (next: Selection) => {
    history.pushState({}, "", selectionUrl(next));
    setSelection(next);
  };

  useEffect(() => {
    const sync = () => setSelection(readSelection());
    sync();
    setHydrated(true);
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(api + "/catalog", { signal: abort.signal })
      .then((r) => readJson<FinanceCatalog & { available: boolean; companies: CatalogEntry[] }>(r))
      .then((body) => {
        if (body.schemaVersion !== 2 || !body.companies.length)
          throw new Error("Catalog unavailable");
        setCatalog(body.companies);
        setCatalogMeta(body);
        setAvailable(body.available);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError(
            "Company search is temporarily limited to the saved companies. Retry the connection below."
          );
      });
    return () => abort.abort();
  }, [reload]);
  useEffect(() => {
    if (!hydrated) return;
    const ticker = selection.ticker;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let lastCompleted = -1;
    let activeJob: FinanceJob | null = null;
    setLoading(true);
    setJob(null);
    setError("");
    const load = async () => {
      const response = await readJson<CompanyResponse>(
        await fetch(api + "/companies/" + encodeURIComponent(ticker), { signal: abort.signal })
      );
      if (response.company) {
        validateV2(response.company);
        const expectedCik = catalogRef.current.find((c) => c.ticker === ticker)?.cik;
        if (
          response.company.ticker !== ticker ||
          (expectedCik && expectedCik !== response.company.cik)
        )
          throw new Error("The returned company does not match the selection.");
        const previous = datasetRef.current[ticker];
        if (previous && Date.parse(previous.updatedAt) > Date.parse(response.company.updatedAt))
          throw new Error(
            "An older server response was ignored; the newer saved data remains visible."
          );
        datasetRef.current = { ...datasetRef.current, [ticker]: response.company };
        setDatasets((prior) => ({ ...prior, [ticker]: response.company! }));
      }
      setAvailable(response.available);
      setJob(response.job);
      activeJob = response.job;
      lastCompleted = response.job?.completed ?? -1;
      setLoading(false);
    };
    const poll = async () => {
      if (document.hidden) {
        timer = setTimeout(() => void poll(), 5000);
        return;
      }
      try {
        if (!activeJob) return;
        const next = await readJson<FinanceJob>(
          await fetch(api + "/jobs/" + activeJob.id, { signal: abort.signal })
        );
        setJob(next);
        activeJob = next;
        if (
          !pendingJob(next) ||
          next.completed - lastCompleted >= 4 ||
          (next.state === "backfilling" && lastCompleted < 4)
        )
          await load();
        if (pendingJob(activeJob)) timer = setTimeout(() => void poll(), 3000);
      } catch (reason) {
        if (!abort.signal.aborted) {
          setError(String(reason instanceof Error ? reason.message : reason));
          timer = setTimeout(() => void poll(), 10000);
        }
      }
    };
    void load()
      .then(() => {
        if (pendingJob(activeJob)) timer = setTimeout(() => void poll(), 2000);
      })
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setLoading(false);
          setError(
            reason instanceof Error
              ? reason.message
              : "Connection unavailable; saved data remains visible."
          );
        }
      });
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [hydrated, selection.ticker, reload]);
  useEffect(() => {
    if (hydrated && current && current.id !== selection.id) {
      const next = { ...selection, id: current.id };
      history.replaceState({}, "", selectionUrl(next));
      setSelection(next);
    }
  }, [hydrated, current, selection]);

  const refresh = async () => {
    const ticker = selection.ticker;
    setSubmitting(true);
    setError("");
    try {
      const response = await readJson<{ job: FinanceJob }>(
        await fetch(api + "/companies/" + encodeURIComponent(ticker) + "/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        })
      );
      if (activeTicker.current === ticker) {
        setJob(response.job);
        setReload((v) => v + 1);
      }
    } catch (reason) {
      if (activeTicker.current === ticker)
        setError(
          reason instanceof Error ? reason.message : "Update failed; saved data remains unchanged."
        );
    } finally {
      setSubmitting(false);
    }
  };
  const exportCsv = () => {
    const rows = [
      [
        "company",
        "frequency",
        "period",
        "currency",
        "revenue",
        "gross_profit",
        "operating_income",
        "net_income",
        "source",
        "filed_at",
        "snapshot",
        "metric_provenance",
        "gross_profit_adjustments"
      ],
      ...periods.map((p) => [
        selection.ticker,
        selection.kind,
        p.label,
        p.displayCurrency,
        p.metrics.revenue ?? "",
        p.metrics.grossProfit ?? "",
        p.metrics.operatingIncome ?? "",
        p.metrics.netIncome ?? "",
        p.sourceUrl,
        p.filedAt,
        company?.version,
        JSON.stringify(p.metricSources),
        JSON.stringify(p.grossProfitAdjustments ?? [])
      ])
    ];
    downloadFile(
      selection.ticker.toLowerCase() + "-" + selection.kind + "-history.csv",
      new Blob(
        [
          rows
            .map((row) => row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(","))
            .join("\n")
        ],
        { type: "text/csv;charset=utf-8" }
      )
    );
  };
  const statements = periods.flatMap((p) => {
    const statement = statementPeriod(p);
    return statement ? [statement] : [];
  });
  const segmentPeriods = statements.filter((p) => p.segments?.length);
  const chartCompany = company
    ? ({ ...company, schemaVersion: 1, annual: [], quarterly: [] } as CompanyDataset)
    : undefined;
  const selectedStatement =
    current && current.coverage.sankey ? statementPeriod(current) : undefined;
  const prior = current
    ? periods.find(
        (p) =>
          p.fiscalYear === current.fiscalYear - 1 &&
          p.fiscalQuarter === current.fiscalQuarter &&
          p.displayCurrency === current.displayCurrency
      )
    : undefined;
  return (
    <div className="finance-app">
      <section className="company-picker" aria-labelledby="company-heading">
        <div className="picker-heading">
          <div>
            <p className="micro-label">S&amp;P 500 + selected international companies</p>
            <h2 id="company-heading">Choose a company</h2>
          </div>
          <label>
            <span className="sr-only">Search companies</span>
            <input
              type="search"
              placeholder="Search ticker or company"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(24);
              }}
            />
          </label>
        </div>
        <div className={"company-row" + (query.trim() ? " company-row--results" : "")}>
          {filtered.slice(0, limit).map((c) => (
            <button
              key={c.ticker}
              data-ticker={c.ticker}
              aria-pressed={c.ticker === selection.ticker}
              onClick={() => choose({ ticker: c.ticker, kind: selection.kind, id: "" })}
            >
              <span>{c.ticker}</span>
              <small>{c.name}</small>
              <small>
                {(job?.ticker === c.ticker ? busy : c.status === "processing")
                  ? "Processing"
                  : c.status === "ready" || datasets[c.ticker]
                    ? "Saved data"
                    : "Available to import"}
              </small>
            </button>
          ))}
        </div>
        {!filtered.length && (
          <p role="status">
            No matching company.{" "}
            <button className="text-button" onClick={() => setQuery("")}>
              Clear search
            </button>
          </p>
        )}
        {filtered.length > limit && (
          <button className="csv-button" onClick={() => setLimit((v) => v + 24)}>
            Show more ({filtered.length} matches)
          </button>
        )}
        {catalogMeta && (
          <p className="chart-note">
            {catalogMeta.companies.length} securities.{" "}
            <a href={catalogMeta.sourceUrl} target="_blank" rel="noreferrer">
              Constituent list
            </a>{" "}
            saved {new Date(catalogMeta.asOf).toLocaleDateString("en-US", { timeZone: "UTC" })};
            issuer identity is checked with SEC on import. Search does not initiate a crawl.
          </p>
        )}
      </section>
      <section className="finance-update" aria-label="SEC data update">
        <div>
          <strong>{identity?.name ?? selection.ticker}</strong>
          <p>
            {company
              ? "Saved data: " + date(company.updatedAt)
              : "Choose Get SEC data to import this company. No values are estimated."}
          </p>
          <p>Last SEC check: {date(company?.checkedAt)}</p>
        </div>
        <div>
          <button
            className="csv-button"
            disabled={!available || busy || submitting || !identity}
            onClick={() => void refresh()}
          >
            {submitting
              ? "Requesting…"
              : busy
                ? "SEC task in progress"
                : company
                  ? "Check latest SEC filings"
                  : "Get SEC data"}
          </button>
          <p className="chart-note">Free service · requests are queued and shared</p>
        </div>
        {job && (
          <div className="finance-job" role="status">
            <strong>
              {job.state === "backfilling"
                ? "Filling source-available history"
                : job.state === "partial"
                  ? "Data available · partial coverage"
                  : job.state.replaceAll("-", " ")}
            </strong>
            <p>{job.message}</p>
            {!busy && (
              <p className="chart-note">
                Checks for the same issuer are shared for one hour from {date(job.createdAt)}.
                Repeating a request during that window reuses this result.
              </p>
            )}
            {busy && (
              <progress
                aria-label="Financial data task progress"
                value={job.completed}
                max={Math.max(job.completed + 1, job.total)}
              />
            )}
          </div>
        )}
        {(!available || error) && (
          <div className="finance-job" role="status">
            <p>
              {error || "Online updates are temporarily unavailable; saved data remains visible."}
            </p>
            <button className="text-button" onClick={() => setReload((v) => v + 1)}>
              Retry connection
            </button>
          </div>
        )}
      </section>
      {!company && (
        <section className="finance-panel" aria-busy={loading}>
          <h2>
            {loading
              ? "Loading saved data…"
              : (identity?.name ?? selection.ticker) + ": not imported yet"}
          </h2>
          <p>
            {loading
              ? "Checking the saved company snapshot."
              : "Use Get SEC data above. You can leave this page while the task runs and return to see its progress."}
          </p>
        </section>
      )}
      {company && (
        <>
          <div className="finance-toolbar">
            <div className="period-tabs" aria-label="Reporting period">
              {(["annual", "quarterly"] as const).map((kind) => (
                <button
                  key={kind}
                  aria-pressed={selection.kind === kind}
                  onClick={() => choose({ ...selection, kind, id: "" })}
                >
                  {kind === "annual"
                    ? "Annual (" + company.annual.length + " years)"
                    : "Quarterly (" + company.quarterly.length + " quarters)"}
                </button>
              ))}
            </div>
            <button className="csv-button" disabled={!periods.length} onClick={exportCsv}>
              Download CSV
            </button>
          </div>
          <p className="chart-note">
            Target: 10 annual / 20 quarterly periods where sources permit. Missing periods remain
            gaps; business classifications may change. CSV includes all {periods.length} available{" "}
            {selection.kind} periods.
          </p>
          {!current && (
            <section className="finance-panel">
              <h2>No {selection.kind} periods available</h2>
              <p>Try the other reporting frequency or check for new SEC filings.</p>
            </section>
          )}
          {current && (
            <>
              <section className="company-summary">
                <div>
                  <p className="micro-label">
                    {selection.ticker} · {current.label}
                  </p>
                  <h2>{company.name}</h2>
                </div>
                <label className="flow-period-select">
                  Period{" "}
                  <select
                    value={current.id}
                    onChange={(e) => choose({ ...selection, id: e.target.value })}
                  >
                    {[...periods].reverse().map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p>Figures in {current.displayCurrency} · reported company filings</p>
              </section>
              <section className="kpi-grid" aria-label="Selected period key performance indicators">
                {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => {
                  const value = current.metrics[key],
                    older = prior?.metrics[key];
                  const change =
                    value !== undefined && older !== undefined && older > 0
                      ? value / older - 1
                      : undefined;
                  const margin =
                    value !== undefined && (current.metrics.revenue ?? 0) > 0
                      ? value / current.metrics.revenue!
                      : undefined;
                  return (
                    <article key={key}>
                      <p title={current.metricSources[key]?.label}>
                        {key === "revenue" &&
                        current.metricSources.revenue?.tag.endsWith("RevenuesNetOfInterestExpense")
                          ? "Revenue, net of interest"
                          : labels[key]}
                      </p>
                      <strong>{amount(value, current.displayCurrency)}</strong>
                      <span>
                        {key !== "revenue" && margin !== undefined
                          ? percent(margin) + " margin · "
                          : ""}
                        {change === undefined
                          ? "YoY unavailable"
                          : (change >= 0 ? "+" : "") + percent(change) + " YoY"}
                      </span>
                    </article>
                  );
                })}
              </section>
              {!!segmentPeriods.length && (
                <>
                  <p className="chart-note">
                    Reviewed business-category detail is available for {segmentPeriods.length} of
                    these {periods.length} periods. Each chart uses the classifications in its cited
                    filing.
                  </p>
                  <RevenueChart periods={segmentPeriods} company={chartCompany!} />
                </>
              )}
              {selectedStatement ? (
                <StatementFlow
                  periods={[selectedStatement]}
                  company={chartCompany!}
                  selection={current.id}
                  showPeriodSelect={false}
                />
              ) : (
                <section className="finance-panel chart-empty">
                  <h2>Statement detail · {current.label}</h2>
                  <p>
                    A proportional profit-flow chart is not available for this reporting structure
                    or coverage. The reported figures below remain available; missing costs or
                    business splits are not invented.
                  </p>
                  <a href={current.sourceUrl} target="_blank" rel="noreferrer">
                    Read the original statement
                  </a>
                </section>
              )}
              <section className="finance-panel table-panel">
                <div className="panel-heading">
                  <h2>Period detail</h2>
                </div>
                {periods.length > 6 && (
                  <p className="table-scroll-hint" id="period-scroll-hint">
                    Scroll within the table to view all {periods.length} periods.
                  </p>
                )}
                <div
                  className="table-scroll table-scroll--compact"
                  tabIndex={0}
                  role="region"
                  aria-label="Financial history table"
                  aria-describedby={periods.length > 6 ? "period-scroll-hint" : undefined}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Period</th>
                        <th scope="col">Currency</th>
                        <th scope="col">Revenue</th>
                        <th scope="col">Gross profit</th>
                        <th scope="col">Operating income</th>
                        <th scope="col">Net income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...periods].reverse().map((p) => (
                        <tr key={p.id} aria-current={p.id === current.id ? "true" : undefined}>
                          <th scope="row">
                            <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                              {p.label}
                            </a>
                            {p.derived && <small> includes calculations</small>}
                          </th>
                          <td>{p.displayCurrency}</td>
                          {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
                            <td key={key}>{amount(p.metrics[key], p.displayCurrency)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details className="chart-data-detail">
                  <summary>Metric definitions and sources · {current.label}</summary>
                  <ul>
                    {Object.entries(current.metricSources).map(([key, source]) => (
                      <li key={key}>
                        <strong>{key}</strong>: {source.label} · {source.method} · {source.tag}.{" "}
                        <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                          Filed {source.filedAt}
                        </a>
                        {source.inputs && <span> · Inputs: {source.inputs.join("; ")}</span>}
                      </li>
                    ))}
                    {current.grossProfitAdjustments?.map((item) => (
                      <li key={item.label}>
                        <strong>Gross profit adjustment</strong>: {item.label} ·{" "}
                        {amount(item.amount, current.displayCurrency)} ·{" "}
                        <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                          Source filing
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
              <footer className="finance-source">
                <p>
                  <strong>Thales’ Olive</strong> · {canonicalHost}
                </p>
                <p>
                  Snapshot {company.version} · updated {date(company.updatedAt)}
                </p>
                <p>
                  {current.label} · period ending {current.endDate} ·{" "}
                  <a href={current.sourceUrl} target="_blank" rel="noreferrer">
                    filed {current.filedAt}
                  </a>
                </p>
                {current.fx && (
                  <p>
                    Converted from {current.reportingCurrency} using the{" "}
                    <a href={current.fx.sourceUrl}>Federal Reserve period-average rate</a>:{" "}
                    {current.fx.rate.toFixed(3)} TWD/USD.
                  </p>
                )}
                <p>For research and demonstration only. Not investment advice.</p>
                {!!company.warnings.length && (
                  <details>
                    <summary>Coverage notes ({company.warnings.length})</summary>
                    <ul>
                      {company.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </footer>
            </>
          )}
        </>
      )}
    </div>
  );
}
