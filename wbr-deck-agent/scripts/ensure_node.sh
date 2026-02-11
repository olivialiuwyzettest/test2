#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="${ROOT_DIR}/.dev"

NODE_VERSION="${NODE_VERSION:-20.11.1}"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "${OS}" == "Darwin" && "${ARCH}" == "arm64" ]]; then
  PLATFORM="darwin-arm64"
elif [[ "${OS}" == "Darwin" && "${ARCH}" == "x86_64" ]]; then
  PLATFORM="darwin-x64"
elif [[ "${OS}" == "Linux" && "${ARCH}" == "x86_64" ]]; then
  PLATFORM="linux-x64"
else
  echo "Unsupported platform: ${OS}/${ARCH}. Install Node.js 20.x and ensure node/npm are on PATH." >&2
  exit 2
fi

TARBALL="node-v${NODE_VERSION}-${PLATFORM}.tar.gz"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${TARBALL}"
EXTRACTED_DIR="${DEV_DIR}/node-v${NODE_VERSION}-${PLATFORM}"

mkdir -p "${DEV_DIR}"

if [[ ! -x "${EXTRACTED_DIR}/bin/node" ]]; then
  echo "Downloading Node.js v${NODE_VERSION} (${PLATFORM})..." >&2
  curl -fsSL "${URL}" -o "${DEV_DIR}/${TARBALL}"
  tar -xzf "${DEV_DIR}/${TARBALL}" -C "${DEV_DIR}"
fi

echo "${EXTRACTED_DIR}/bin"

