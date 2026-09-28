# Commit metadata migration

[简体中文](README.zh-CN.md)

On 2026-09-27, the main branch’s Git metadata was corrected: four commits had inherited a workstation identity, and thirteen commit messages contained AI co-author trailers. The four author/committer pairs now use `Sheng Wan <swan0624@uw.edu>`. The other nine already used Sheng Wan’s GitHub noreply identity and are unchanged.

The annotated `launch-2026-09-05` tag points to the equivalent migrated commit. One AI trailer was removed from its annotation; its tagger, date and other text are unchanged. Neither the original main commits nor this tag was signed.

## Verification

All thirteen migrated main commits have exactly the same file trees as their originals. Their dates and other message bytes are unchanged. Code, site content, media, data and licenses are unchanged by this migration. The attribution policy and this record are a separate documentation commit marked `[skip ci]`; no tests, build or deployment were started.

[commit-map.csv](commit-map.csv) contains the old IDs, new IDs and identical tree IDs. [rewrite-audit.json](rewrite-audit.json) records the checks. Original build, test and deployment records retain their original revision IDs; a mapped ID identifies equivalent contents, not a new execution. A private, verified backup preserves the original history and complete local checkout, including ignored and untracked files.

## Local synchronization

Retain any old checkout and clone into a new directory. Copy only needed local changes and results; do not copy the old `.git` directory or merge the old main history. The map resolves old recorded revisions. New commits should use the repository-local identity specified in AGENTS.md.

## Contributor statistics

GitHub’s contributor display is separate from Git commit metadata. After a history rewrite, its statistics can take about 24 hours to refresh. Persistent discrepancies can be reported to GitHub Support. See [GitHub’s contributor documentation](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors#contributor-data-is-stale-after-history-changes).

Old commit URLs, Actions records, pull-request references, caches and other clones may retain the original metadata. This migration does not claim to purge those copies or change how the project was produced. Source attribution and licensing remain in force.
