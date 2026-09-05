# Agent Instructions

## Mission

- Build and maintain Sheng Wan's English-language academic website and code portfolio.
- Favor accurate, polished, accessible, fast, low-maintenance public pages.
- Treat biography, affiliation, education, research, awards, teaching, contact, and CV details as factual claims; never invent missing details.

## Architecture

- Astro 7 static site with React islands; Cloudflare Worker handles only `/api/*` and static assets.
- pnpm 10 on Node 24.18; never mix package managers. Follow `pnpm-lock.yaml`.
- Content lives in `src/content/`; generated sanitized media/data live in `public/media/` and `src/data/generated/`.
- Raw photographs, portraits, HEIC files, and source CV archives are local-only and ignored by Git.

## Canonical Commands

- Install: `pnpm install`; develop: `pnpm dev`; Worker preview: `pnpm preview`.
- Check: `pnpm check`; lint: `pnpm lint`; tests: `pnpm test`; build: `pnpm build`.
- Full gate: `pnpm verify`; media: `pnpm media:build` / `pnpm media:check`.
- Official finance refresh: `pnpm data:update`; never replace verified data after a failed refresh.

## File-Scoped Commands

- Lint: `pnpm lint:file -- <paths>`; format: `pnpm exec prettier --check <paths>`.
- One test: `pnpm exec vitest run <path>`.

## Public Facts & Design

- User-provided facts are canonical unless an authoritative source supersedes them with user approval.
- Research abstract and keywords remain absent until the user provides them.
- Academic pages use minimal motion; Playground may be richer but must respect reduced motion.
- Preserve WCAG 2.2 AA, semantic HTML, keyboard operation, responsive layouts, and light/dark themes.
- Never claim a visual result from source alone; inspect the rendered page in a real browser.

## Progressive Project Memory

- Keep this file under 60 lines and limited to durable cross-task rules.
- Finance details: `docs/agent/finance-data.md`; media workflow: `docs/agent/media-pipeline.md`.
- Visual conventions: `docs/agent/visual-system.md` (read only for design work).
- Replace stale guidance instead of appending task logs. Keep secrets and sensitive personal data out.

## Verification & Delivery

- Run the smallest relevant check first, then `pnpm verify` before delivery.
- Verify links, metadata, responsive layout, keyboard access, dark mode, and important interactions.
- Preserve unrelated user changes. Inventory scope before destructive or bulk actions.
- Report changed paths and validation results concisely in Chinese when the request is Chinese.

## Commit Attribution

AI commits MUST include `Co-Authored-By: OpenAI Codex <codex@openai.com>`.
