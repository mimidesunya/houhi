#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

echo "[1/2] setup.ts を実行します..."
npm run setup

echo "[2/2] ツールドキュメントを再生成します..."
npm run docs:tools

echo "完了しました。"
