# Paused WFC source work

Saved on 2026-10-07 at the user's request to pause and retain existing results.
This is an unfinished development checkpoint, not a production release.

## Accepted release

- GitHub main: `b515f9599226bdde1f3b8c196209659efaea2b51`.
- Successful CI run: https://github.com/Tocqueville0624/sheng-wan/actions/runs/37698032076.
- Cloudflare production version: `c7c06d53-9452-474f-bbb9-ff9d931d437e`.
- JPM: 30 annual/quarterly periods retain original business and profit-flow proof;
  14 production browser cases and 12 unrelated company controls passed.
- The complete 501-company objective remains unfinished.

## Unfinished code saved in this checkpoint

- `scripts/finance/ixbrl.ts`: a separate original inline document-set parser.
  The existing single-document parser remains intact. The new parser has no
  production consumer and still needs source provenance validation and tests.
- `scripts/finance/original-revenue-grid.ts`: optional separate resource bodies
  for resolving units without concatenating source documents.
- `src/features/finance/wfc-original-rows.ts`: draft lossless row representation,
  including identifier prefix compression. The latest revision is unverified.
- `tests/fixtures/finance/wfc-documents/`: losslessly compressed original SEC
  financial documents and covers for eight source cases, with source hashes.

The partial row-fixture generator stopped on the earlier context bound. Its four
`*-rows.json` files use the preceding representation and are incompatible with
the latest draft decoder. The manifest was not augmented with these partial
generated files. Review and regenerate these derived fixtures before any test
or release; preserve the original compressed source documents.

No WFC source-selection integration, canonical business/income reader, normal
Worker import integration, complete regression suite, or production acceptance
has been completed. The latest draft has not passed lint, type checks, tests,
or the full verification gate. It must not be deployed as a supported release.

## Locally retained evidence

Original source caches and diagnostic receipts remain under the ignored local
directory `.cache/finance/corpus/release/`; they are not published in Git.
Relevant records include:

- `next-jpm-v56-release-acceptance.json` and production browser/export receipts.
- `shared-original-before-next-wfc-integration-b515f95/`: immutable accepted
  baseline, 1,017 compressed files, 14,666 protected periods and 17,001 source pins.
- `next-wfc-original-attachments-registration.json`: 26 additive original SEC
  source pins; prior pins remain unchanged.
- `next-wfc-document-set-integration-plan.json` and `next-wfc-original-*`
  document, resource, physical-column and accounting-identity diagnostics.
- `next-wfc-original-row-fixtures.log`: the retained partial generator failure.

The legacy 2018 standalone XML exceeds the existing cloud source-size limit.
Its local audit is evidence only, not proof of cloud import support. Existing
service limits, storage namespaces, quotas and billing settings remain unchanged.

Work is paused. Resume only after a new user instruction.
