#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

echo "[1/3] setup.ts を実行します..."
npm run setup

echo "[2/3] ツールドキュメントを再生成します..."
npm run docs:tools

echo "[3/3] テストを実行します..."
npm test

echo "完了しました。"
