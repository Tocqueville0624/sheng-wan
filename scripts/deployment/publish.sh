#!/bin/sh
set -eu

# A unique tag binds promotion to this upload, even if another release starts.
tag=$(node -p "require('node:crypto').randomBytes(12).toString('hex')")
pnpm exec wrangler versions upload --env production --tag "$tag"
pnpm exec wrangler versions deploy --env production --version-tag "${tag}@100" --yes
