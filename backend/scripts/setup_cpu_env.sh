#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UV_BIN="${UV_BIN:-${HOME}/.local/bin/uv}"
PYTHON_VERSION="${PYTHON_VERSION:-3.11}"
VENV_PATH="${VENV_PATH:-${ROOT_DIR}/.venv}"
DEFAULT_INDEX="${UV_DEFAULT_INDEX:-https://mirrors.cloud.tencent.com/pypi/simple}"

if [[ ! -x "${UV_BIN}" ]]; then
  echo "uv not found at ${UV_BIN}" >&2
  echo "Install uv first, or set UV_BIN to the correct path." >&2
  exit 1
fi

echo "Installing Python ${PYTHON_VERSION} with uv..."
"${UV_BIN}" python install "${PYTHON_VERSION}"

echo "Recreating virtual environment at ${VENV_PATH}..."
"${UV_BIN}" venv "${VENV_PATH}" --python "${PYTHON_VERSION}" --seed --clear

echo "Installing backend dependencies with CPU-only PyTorch wheels..."
echo "Using package index: ${DEFAULT_INDEX}"
"${UV_BIN}" pip install \
  --python "${VENV_PATH}/bin/python" \
  --default-index "${DEFAULT_INDEX}" \
  --torch-backend cpu \
  -e "${ROOT_DIR}"

cat <<EOF

Backend CPU environment is ready.

Start the backend with:
  cd ${ROOT_DIR}
  ${VENV_PATH}/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
EOF
