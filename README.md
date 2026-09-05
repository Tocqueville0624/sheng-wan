# Sheng Wan — Academic Website

An English-language academic website and public coding portfolio for Sheng Wan, a PhD student in Political Science at the University of Washington. The site combines fast static academic pages with three carefully scoped Playground projects.

## Stack

- Astro 7 static pages with small React islands
- Cloudflare Worker for cached finance reads and public on-demand SEC imports
- SQLite-backed Durable Object for the persistent finance queue and per-company snapshots; optional legacy KV
- pnpm 10 and Node 24.18
- Sharp for privacy-preserving responsive image derivatives
- Vitest, Playwright, axe, ESLint, Prettier, and Astro type checks

Ordinary academic pages remain static. Olive reads invoke the API; only explicit refresh/import requests start SEC work. Visitors need no login or paid API. Free-tier quotas can pause updates; verified saved data remains the fallback.

## Local development

```sh
fnm use
pnpm install
pnpm dev
```

Use `pnpm preview` to build the site and run it through the same Worker entry point used in production. The default Wrangler URL is `http://localhost:8787`.
For local SEC imports, copy `.dev.vars.example` to the ignored `.dev.vars`; it enables only the local preview. Production updates are enabled after protected cloud acceptance. Preview and staging configurations keep `FINANCE_PUBLIC_UPDATES=disabled` by default; any future environment must pass edge validation before enabling public updates.

Important commands:

```sh
pnpm verify       # formatting, lint, types, unit tests, media privacy, production build
pnpm test:e2e     # browser smoke and accessibility tests
pnpm media:build  # regenerate sanitized responsive derivatives from local originals
pnpm data:update  # fetch and validate official SEC/Fed data
pnpm data:catalog # validate and atomically save the dated public S&P 500 catalog
FINANCE_LIVE_CHECK=1 pnpm test:e2e # additionally inspect already-imported local history
```

## Content model

- `src/content/cv/resume.json` is the accessible HTML CV content.
- `public/downloads/sheng-wan-cv.pdf` is the unchanged user-provided PDF download.
- `src/content/research/` and `src/content/hugo/` contain authored content.
- `src/data/generated/media.json` is a generated image manifest; `public/media/` contains sanitized derivatives only.
- `src/data/generated/finance.json` is the bundled snapshot used for local preview and safe fallback.

The bundled finance fallback has real SEC business-category statements for seven companies (three annual/six quarterly periods each). Online v2 searches a dated S&P 500 catalog plus TSM and imports basic SEC metrics on demand, targeting ten years/twenty available quarters. Recent validated data appears first; history follows. Missing quarters remain gaps. Business categories require reviewed filing adapters; banks, insurers and unsupported/loss structures are not forced into a profit-flow chart. TSM retains exact 6-K/20-F amounts and period-average Federal Reserve currency conversion. A failed source, changed taxonomy or failed reconciliation never replaces verified data. See [finance-data.md](docs/agent/finance-data.md) for source mappings and safeguards.

## API

- `GET /api/finance/v2/catalog`
- `GET /api/finance/v2/companies/:ticker`
- `POST /api/finance/v2/companies/:ticker/refresh`
- `GET /api/finance/v2/jobs/:id`

Existing data is readable immediately; the explicit update button joins a persisted job. Updates are limited to five new jobs per IP/hour, one shared check per CIK/hour, twenty first imports and one hundred updates/day. A separate 4,000-step daily processing budget pauses queued work until the next UTC day and reserves room for reads. The UI distinguishes check time, changed-data time and filing dates. The older read-only API remains compatible:

- `GET /api/finance/snapshot`
- `GET /api/finance/companies`
- `GET /api/finance/companies/:ticker?period=annual|quarterly`

Legacy responses include a version, data status, cache policy, and ETag. Unsupported tickers and invalid periods return structured JSON errors. V2 has per-period capability and field-level provenance; being searchable does not mean a company has complete chart coverage.

## Deployment

The production address is `https://shengwan.org`. `pnpm run deploy` creates a production build and deploys the named `production` environment. The root environment is `sheng-wan-preview`; `staging` is `sheng-wan-staging`. Each Worker has its own SQLite `FINANCE_STORE`. Production serves the apex and `www` custom domains and disables workers.dev and version-preview URLs. The Cloudflare zone must be active before production deployment. Configure a zone-level Single Redirect from `www` to the apex with HTTP 308 and query preservation, plus Always Use HTTPS. Owner-specific setup, account and renewal records remain in the local deployment runbook rather than the public repository.

Builds default to noindex. Only `PUBLIC_SITE_INDEXABLE=true` with `PUBLIC_SITE_URL=https://shengwan.org` produces an indexable build. `pnpm build:production` sets both. Preview and staging deployments must receive their actual HTTPS address in `PUBLIC_SITE_URL`.

Staging routes every request, including static assets, through bearer-token authentication. Set `STAGING_ACCESS_TOKEN` with Wrangler secret storage; the staging gate denies access even if the secret is missing. Keep the token out of URLs, logs and source files.

Confirm the account remains on the free plan. `wrangler.jsonc` declares the SQLite `FINANCE_STORE` binding/migration; no paid resource is provisioned by local preview. Keep production `FINANCE_PUBLIC_UPDATES=disabled` while verifying SEC access, the largest supported filing and alarm recovery in a protected staging environment; enable public updates only after those checks pass. A disabled update gate still serves saved data. Local emulation cannot prove SEC accepts the cloud egress IP. If the binding is unavailable, the API returns bundled reads and an honest update-unavailable state. Do not enable billing automatically.

The legacy daily workflow refreshes/tests and saves artifacts. Optional KV publication requires a `FINANCE_KV` namespace, `FINANCE_PUBLISH=true` and Cloudflare secrets. Credentials belong in secret storage, never repository files. SEC contact identification is sent only to `sec.gov`, never to the FX source or another domain. No cloud deployment is implied merely by having configuration files.

CI verifies a production build and runs desktop/mobile browser tests before saving the exact static artifact. After initial domain setup and acceptance, repository variable `DEPLOYMENT_ENABLED=true` enables automatic production deployment from `main`. Pull requests never deploy or receive deployment credentials. The legacy finance workflow saves validated artifacts; it does not automatically update production's bundled data or Durable Object.

## Licensing

Source code is released under the MIT License. Personal text, CV content, and photographs are © Sheng Wan, all rights reserved. See [CONTENT_LICENSE.md](CONTENT_LICENSE.md).
