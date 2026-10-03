# Full-catalog SEC corpus

The target inventory is every CIK in the versioned website catalog: currently 504 securities and 501 issuers. Share classes retain all ticker aliases under one issuer record. This work is incomplete until the entire inventory has been checked; a pilot or raw download is not full coverage.

## Acquire and replay

- `pnpm data:corpus -- --all --download` acquires Submissions, Company Facts, the latest ten annual and twenty quarterly filing sources, and additional sources required by the retained financial periods. A per-file atomic checkpoint makes interruption recoverable. Run only one downloader at a time.
- `pnpm data:corpus -- --all --audit` replays acquired sources offline and writes normalized company datasets and gap records. Audit checkpoints are separate from download checkpoints, so one auditor may run alongside the downloader. Each invocation reads the inventory available at its start; repeat to pick up newly acquired issuers.
- `--tickers WMT,JNJ`, `--limit N`, `--force`, and `--retry-failed` bound or explicitly retry work. Partial downloads are retried by default; previously failed issuers require `--retry-failed`. A changed parser, reviewed schema, seed history, or acquired source set causes another audit.
- Private sources, raw-body hashes, inventory, normalized datasets, analysis records, and errors live in ignored `.cache/finance/`. Nothing is published or placed in public assets by this command. Existing reviewed featured-company history is retained as an audit seed, matching the public import's preservation of verified prior periods.
- New CLI caches use compressed JSON envelopes. Legacy uncompressed caches remain readable and are not deleted. The corpus downloader permits up to 64 MiB per response and stops when less than 3 GiB remains available. The public Worker retains its existing response bound and request limits. An oversized or unavailable source remains a recorded gap.

## Review and acceptance

- Every issuer keeps its acquisition status, current annual/quarterly capabilities, per-period gap list, parser hash, and acquired-source hash. `analysis: complete` means the parser accepts every retained period and current source date; it is not evidence of browser rendering or a guarantee for an unknown future taxonomy.
- A complete source acquisition, matching current report dates and at least the current filing dates, and both validated capabilities for every retained period are required. Missing sources, parse failures, stale statements, incomplete history partitions, and absent profit flows cannot count as complete.
- The original seven adapters and generic revenue rows remain available. New reviewed schemas in `src/features/finance/business-rules.ts` contain only issuer identities, table labels, tags and exact dimensions. They never store financial values or silently accept renamed/extra segments.
- Walmart's reviewed vertical table includes total segment revenues and the separately reported corporate membership income. Net sales alone cannot replace consolidated revenue. JNJ's reviewed column table has two operating segments; its amounts reconcile to the primary consolidated sales table in the same filing and period. Both preserve full branch provenance and source precision.
- Generic matrix row totals must share one logical column, business classification, period, currency and fixed scope. An explicit total in the same table must equal the consolidated revenue; interior product-by-region intersections are excluded. Only the standard operating-segments consolidation qualifier is permitted. APD's preserved source provides three product totals; its reported loss still prevents a positive-profit flow.
- Applied Materials' reviewed column schema includes Semiconductor Systems, Applied Global Services and the explicitly reported Other revenue. It never fills a residual to make the operating segments add up. A changed classification is withheld until reviewed.
- Financial groups, joint registrants, reorganized CIKs, nondollar sources, older separate-XBRL filings, undisclosed categories, losses, and changes in accounting classifications require explicit source review. Do not reuse another issuer's facts or infer an unreported business split to close the inventory.
- Use real preserved SEC fragments for positive regression tests. Run browser checks of amounts, proportional node heights, light/dark themes, narrow viewports and SVG/PNG metadata before a parser release. Source-only tests do not establish rendered acceptance.
- An existing generic split of a revenue sub-line may be cleared when the primary statement proves a broader consolidated total. Its branches and revenue-derived margins must then be re-read together; no figures from the former partition are carried into the new total.

## Current release behavior

The full-corpus command does not warm production storage. Public imports use the same generic parsing steps, including reviewed schemas; previously imported issuers acquire the new result after a SEC check. Incremental fixes can be released while the full corpus remains under review, but report their scope and keep the full goal open.
