import bundledSnapshot from "../src/data/generated/finance.json";
import { companies as supportedCompanies } from "../scripts/finance/companies";
import { assertPublishableManifest } from "../scripts/finance/validate";
import type { CompanyDataset, FinanceManifest, PeriodKind } from "../src/features/finance/types";
import { catalog, catalogIdentity, bundledCompany } from "./finance-store";
export { FinanceStore } from "./finance-store";

type Env = {
  ASSETS: Fetcher;
  FINANCE_KV?: KVNamespace;
  FINANCE_STORE?: DurableObjectNamespace;
  FINANCE_PUBLIC_UPDATES?: string;
  CANONICAL_ORIGIN?: string;
};

const allowedPeriods = new Set<PeriodKind>(["annual", "quarterly"]);
const allowedTickers = new Set(supportedCompanies.map((company) => company.ticker));

function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(value), { ...init, headers });
}

async function snapshot(env: Env): Promise<FinanceManifest> {
  if (env.FINANCE_KV) {
    for (const key of ["finance:current", "finance:previous"]) {
      try {
        const candidate = await env.FINANCE_KV.get<FinanceManifest>(key, "json");
        if (!candidate) continue;
        assertPublishableManifest(candidate);
        if (
          candidate.companies.length !== allowedTickers.size ||
          candidate.companies.some((company) => !allowedTickers.has(company.ticker))
        )
          continue;
        if (key === "finance:current") return candidate;
        return {
          ...candidate,
          dataStatus: "delayed",
          note: "The latest refresh is unavailable; showing the previous source-validated snapshot."
        };
      } catch {
        // Corrupt, unavailable, or legacy demo KV data must never replace good bundled data.
      }
    }
  }
  const bundled = bundledSnapshot as FinanceManifest;
  assertPublishableManifest(bundled);
  return bundled;
}

async function api(request: Request, env: Env) {
  if (new URL(request.url).pathname.startsWith("/api/finance/v2/")) return apiV2(request, env);
  if (request.method !== "GET")
    return json(
      { error: { code: "NOT_FOUND", message: "Only GET is supported." } },
      { status: 405, headers: { Allow: "GET" } }
    );
  const url = new URL(request.url);
  const loaded = await snapshot(env);
  const manifest = {
    ...loaded,
    companies: loaded.companies.filter((company) => allowedTickers.has(company.ticker))
  };
  let payload: unknown;
  if (url.pathname === "/api/finance/snapshot") {
    payload = manifest;
  } else if (url.pathname === "/api/finance/companies") {
    payload = {
      schemaVersion: manifest.schemaVersion,
      version: manifest.version,
      updatedAt: manifest.updatedAt,
      dataStatus: manifest.dataStatus,
      note: manifest.note,
      companies: manifest.companies.map((company) => ({
        schemaVersion: company.schemaVersion,
        version: company.version,
        ticker: company.ticker,
        name: company.name,
        cik: company.cik,
        accent: company.accent,
        reportingCurrency: company.reportingCurrency,
        latestPeriod: company.latestPeriod,
        dataStatus: company.dataStatus,
        updatedAt: company.updatedAt,
        note: company.note
      }))
    };
  } else {
    const match = url.pathname.match(/^\/api\/finance\/companies\/([A-Za-z]+)$/);
    if (!match)
      return json(
        { error: { code: "NOT_FOUND", message: "API route not found." } },
        { status: 404 }
      );
    const period = (url.searchParams.get("period") ?? "annual") as PeriodKind;
    if (!allowedPeriods.has(period))
      return json(
        { error: { code: "INVALID_PERIOD", message: "Period must be annual or quarterly." } },
        { status: 400 }
      );
    const company = manifest.companies.find((entry) => entry.ticker === match[1].toUpperCase());
    if (!company)
      return json(
        {
          error: {
            code: "UNSUPPORTED_COMPANY",
            message: "This company is not in the supported universe."
          }
        },
        { status: 404 }
      );
    payload = {
      ...company,
      periods: company[period],
      annual: undefined,
      quarterly: undefined
    } satisfies Partial<CompanyDataset> & { periods: CompanyDataset[PeriodKind] };
  }
  const body = JSON.stringify(payload);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${manifest.version}:${body}`)
  );
  const etag = `"${[...new Uint8Array(digest)]
    .slice(0, 10)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}"`;
  if (request.headers.get("If-None-Match") === etag)
    return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control":
        manifest.dataStatus === "verified"
          ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
          : "public, max-age=60",
      ETag: etag,
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function apiV2(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/finance/v2", "");
  const isRefresh = /^\/companies\/[A-Z0-9.-]+\/refresh$/i.test(path);
  if (request.method !== (isRefresh ? "POST" : "GET"))
    return json(
      { error: { message: "Method not supported." } },
      { status: 405, headers: { Allow: isRefresh ? "POST" : "GET" } }
    );
  if (isRefresh && request.headers.get("Origin") && request.headers.get("Origin") !== url.origin)
    return json(
      { error: { message: "Update requests must originate from this website." } },
      { status: 403 }
    );
  if (!(
    path === "/catalog" ||
    /^\/companies\/[A-Z0-9.-]+(?:\/refresh)?$/i.test(path) ||
    /^\/jobs\/[a-f0-9-]{36}$/.test(path)
  ))
    return json({ error: { message: "API route not found." } }, { status: 404 });
  const updatesEnabled = env.FINANCE_PUBLIC_UPDATES === "enabled";
  if (isRefresh && !updatesEnabled)
    return json(
      {
        error: {
          code: "UPDATES_NOT_ACTIVATED",
          message:
            "Public updates are not activated in this environment. Saved data remains available."
        }
      },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } }
    );
  if (env.FINANCE_STORE) {
    try {
      const store = env.FINANCE_STORE.get(env.FINANCE_STORE.idFromName("finance-v2"));
      const response = await store.fetch(
        new Request(`https://finance.internal${path}`, {
          method: request.method,
          headers: { "X-Client-Key": request.headers.get("CF-Connecting-IP") ?? "local-preview" }
        })
      );
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      if (
        !updatesEnabled &&
        response.ok &&
        (path === "/catalog" || /^\/companies\/[^/]+$/.test(path))
      ) {
        const body = (await response.json()) as Record<string, unknown>;
        return json({ ...body, available: false }, { status: response.status, headers });
      }
      return new Response(response.body, { status: response.status, headers });
    } catch {
      /* Keep the immutable bundled fallback when storage is unavailable. */
    }
  }
  if (path === "/catalog")
    return json(
      {
        ...catalog,
        available: false,
        companies: catalog.companies.map((c) => ({
          ...c,
          status: bundledCompany(c) ? "ready" : "available"
        }))
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  const companyMatch = path.match(/^\/companies\/([A-Z0-9.-]+)$/i);
  if (companyMatch) {
    const identity = catalogIdentity(companyMatch[1]);
    if (!identity) return json({ error: { message: "Company not in catalog." } }, { status: 404 });
    return json(
      { company: bundledCompany(identity) ?? null, job: null, available: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  return json(
    {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Online updates are temporarily unavailable. Saved data has not changed."
      }
    },
    { status: 503, headers: { "Retry-After": "300", "Cache-Control": "no-store" } }
  );
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (env.CANONICAL_ORIGIN && url.hostname === "www.shengwan.org") {
      const target = new URL(env.CANONICAL_ORIGIN);
      target.pathname = url.pathname;
      target.search = url.search;
      return Response.redirect(target, 308);
    }
    if (/^\/playground\/?$/.test(url.pathname)) {
      return Response.redirect(new URL("/playground/thales-olive/", url), 301);
    }
    if (url.pathname.startsWith("/api/")) return api(request, env);
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;

export { api };
