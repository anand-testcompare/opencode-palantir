#!/usr/bin/env bash
set -euo pipefail

SOCKET_NAME="opencode-smoke"
SESSION_NAME="opencode-smoke"
REPO_PATH="${1:-}"
FOUNDRY_URL="${2:-}"

if [[ -z "${REPO_PATH}" ]]; then
  echo "Usage: scripts/dev/opencode-smoke-tmux.sh <repoPath> [foundryUrl]" >&2
  echo "Example: scripts/dev/opencode-smoke-tmux.sh ../palantir-compute-module-pipeline-search https://23dimethyl.usw-3.palantirfoundry.com" >&2
  exit 2
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "[ERROR] tmux is not installed." >&2
  exit 1
fi

# If the session already exists, pick a unique suffix.
if tmux -L "${SOCKET_NAME}" has-session -t "${SESSION_NAME}" 2>/dev/null; then
  TS="$(date +%Y%m%d-%H%M%S)"
  SESSION_NAME="${SESSION_NAME}-${TS}"
fi

opencode_bin=""
if [[ -n "${OPENCODE_BIN:-}" ]]; then
  opencode_bin="${OPENCODE_BIN}"
elif [[ -x "${HOME}/.opencode/bin/opencode" ]]; then
  opencode_bin="${HOME}/.opencode/bin/opencode"
else
  opencode_bin="$(command -v opencode || true)"
fi

if [[ -z "${opencode_bin}" ]]; then
  echo "[ERROR] opencode binary not found. Install opencode or set OPENCODE_BIN." >&2
  exit 1
fi

CMD="cd '$(pwd)' && \
  export OPENCODE_SMOKE_REPO='${REPO_PATH}' && \
  export OPENCODE_BIN='${opencode_bin}' && \
  ${FOUNDRY_URL:+export OPENCODE_SMOKE_FOUNDRY_URL='${FOUNDRY_URL}' && }\
  echo '[smoke] running vitest smoke...' && \
  bun test src/__tests__/opencodeSmoke.test.ts; \
  ec=\$?; \
  echo \"[smoke] done (exit=\$ec).\"; \
  exec bash"

tmux -L "${SOCKET_NAME}" new-session -d -s "${SESSION_NAME}" "bash -lc \"${CMD}\""

echo "Started tmux session: ${SESSION_NAME}" >&2
echo "Attach with: tmux -L ${SOCKET_NAME} attach -t ${SESSION_NAME}" >&2
