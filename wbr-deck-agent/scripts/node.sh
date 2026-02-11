#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ensure_node.sh"
NODE_BIN="$("${BIN_DIR}")"
export PATH="${NODE_BIN}:${PATH}"

exec node "$@"

