#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_REF="${REASSURE_BASELINE_REF:-origin/main}"
WORKTREE_DIR="$(mktemp -d)"

cleanup() {
  git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR/baseline" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE_DIR"
}
trap cleanup EXIT

git -C "$ROOT_DIR" fetch origin
git -C "$ROOT_DIR" worktree add --detach "$WORKTREE_DIR/baseline" "$BASELINE_REF"

rm -rf "$WORKTREE_DIR/baseline/performance"
cp "$ROOT_DIR/jest.reassure.config.js" "$WORKTREE_DIR/baseline/jest.reassure.config.js"
cp -R "$ROOT_DIR/performance" "$WORKTREE_DIR/baseline/performance"
ln -s "$ROOT_DIR/node_modules" "$WORKTREE_DIR/baseline/node_modules"

(
  cd "$WORKTREE_DIR/baseline"
  TEST_RUNNER_PATH="$ROOT_DIR/node_modules/jest/bin/jest.js" \
    TEST_RUNNER_ARGS='--runInBand --config jest.reassure.config.js' \
    node "$ROOT_DIR/scripts/reassure-measure.js" --baseline
)

mkdir -p "$ROOT_DIR/.reassure"
cp "$WORKTREE_DIR/baseline/.reassure/baseline.perf" "$ROOT_DIR/.reassure/baseline.perf"

cd "$ROOT_DIR"
npm run test:performance
