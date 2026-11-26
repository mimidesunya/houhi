#!/bin/sh
# 組版エンジン検討の試作を通しで再現する（Git Bash で実行）。
# 前提: 作業フォルダを環境変数 TYPST_WORK に指定し、その中に次を用意する（repo には入れない）。
#   dl/typst-cli/typst-x86_64-pc-windows-msvc/typst.exe  Typst 0.15.1（github.com/typst/typst の Releases）
#   npm-rc/  typst.ts 0.8.0-rc4（npm install --ignore-scripts @myriaddreamin/typst-ts-web-compiler@0.8.0-rc4 ほか）
#   fonts/win-msmincho/msmincho.ttc など  字の写し
# repo では先に npm run build をしておく（dist の convert_to_pdf.js・court_markdown.js と node_modules/pdfjs-dist を読む）。
# repo には書かない。
set -e
S=$(cd "$(dirname "$0")" && pwd)
T="${TYPST_WORK:?TYPST_WORK に作業フォルダを指定してください}"
B="$T/baseline"
REPO=$(cd "$S/../../.." && pwd)
TYPST="$T/dl/typst-cli/typst-x86_64-pc-windows-msvc/typst.exe"
cd "$S"

echo '== 0. 比べる相手（デスクトップの Chrome エンジンの PDF）を作る'
mkdir -p "$B"
cp "$REPO"/src/templates/*.md "$REPO/src/base/sample.md" "$B/"
node make_long_evidence.js "$B/長い証拠説明書.md"
node desktop_baseline.js "$REPO" "$B" "$B/baseline.json"

echo '== 1. 3文書を Typst（MS 明朝）で組み、Chrome 版と比べる'
mkdir -p "$T/out/msmincho"
node md2typ.js "$REPO/src/templates/訴訟.訴状.md" "$T/out/msmincho/訴訟.訴状.typ"
node md2typ.js "$REPO/src/templates/訴訟.準備書面.md" "$T/out/msmincho/訴訟.準備書面.typ"
node md2typ.js "$B/長い証拠説明書.md" "$T/out/msmincho/長い証拠説明書.typ"
for d in 訴訟.訴状 訴訟.準備書面 長い証拠説明書; do
  "$TYPST" compile --ignore-system-fonts --font-path "$T/fonts/win-msmincho" "$T/out/msmincho/$d.typ" "$T/out/msmincho/$d.pdf"
  node pagetext.js "$B/$d.pdf" "$T/out/msmincho/$d.pdf" | grep -v '^  [AB]:'
  PYTHONIOENCODING=utf-8 python linediff.py "$B/$d.pdf" "$T/out/msmincho/$d.pdf"
done

echo '== 2. 字ごとの時間と大きさ（Typst CLI）'
node bench_cli.js "$TYPST" "$T/fonts" "$T/out/fonts" 7

echo '== 3. PDF/A'
mkdir -p "$T/out/pdfa"
for d in 訴訟.訴状 訴訟.準備書面 長い証拠説明書; do for std in a-1b a-2b; do
  "$TYPST" compile --ignore-system-fonts --font-path "$T/fonts/win-msmincho" --pdf-standard $std "$T/out/msmincho/$d.typ" "$T/out/pdfa/$d.$std.pdf"
done; done

echo '== 4. WASM（Node と headless Chrome）'
node wasm_compile.mjs "$T/npm-rc" "$T/fonts/win-msmincho/msmincho.ttc" "MS Mincho" "$T/out/wasm-rc" - "$T/out/msmincho/訴訟.訴状.typ" "$T/out/msmincho/訴訟.準備書面.typ" "$T/out/msmincho/長い証拠説明書.typ"
node wasm_compile.mjs "$T/npm-rc" "$T/fonts/win-msmincho/msmincho.ttc" "MS Mincho" "$T/out/wasm-rc-pdfa1b" a-1b "$T/out/msmincho/訴訟.訴状.typ"
node browser_compile.js "$T/npm-rc" "$T/fonts/win-msmincho/msmincho.ttc" "MS Mincho" "$T/out/msmincho" "$T/out/browser" 訴訟.訴状 訴訟.準備書面 長い証拠説明書

echo '== 5. 禁則の試験（素の Chrome の印刷と Typst）'
mkdir -p "$T/out/kinsoku"
node make_kinsoku.js "$T/out/kinsoku/禁則試験.md"
node chrome_plain.js "$T/out/kinsoku/禁則試験.md" "$T/out/kinsoku/禁則試験.chrome.pdf"
node md2typ.js "$T/out/kinsoku/禁則試験.md" "$T/out/kinsoku/禁則試験.typ"
"$TYPST" compile --ignore-system-fonts --font-path "$T/fonts/win-msmincho" "$T/out/kinsoku/禁則試験.typ" "$T/out/kinsoku/禁則試験.typst.pdf"
PYTHONIOENCODING=utf-8 python lines.py "$T/out/kinsoku/禁則試験.chrome.pdf" "$T/out/kinsoku/禁則試験.typst.pdf"

echo '== 6. 頁より高い行と枝番の表'
mkdir -p "$T/out/table"
node make_table_doc.js "$T/out/table/表の試験.md"
node md2typ.js "$T/out/table/表の試験.md" "$T/out/table/表の試験.typ"
"$TYPST" compile --ignore-system-fonts --font-path "$T/fonts/win-msmincho" "$T/out/table/表の試験.typ" "$T/out/table/表の試験.typst.pdf"

echo '== 7. baseline の全38文書で、行末まで詰まった行の一致を数える'
mkdir -p "$T/out/all"
for f in "$B"/*.md; do b=$(basename "$f" .md)
  node md2typ.js "$f" "$T/out/all/$b.typ" && "$TYPST" compile --ignore-system-fonts --font-path "$T/fonts/win-msmincho" "$T/out/all/$b.typ" "$T/out/all/$b.pdf"
done
names=$(ls "$B"/*.md | xargs -n1 basename | sed 's/\.md$//')
PYTHONIOENCODING=utf-8 python fullline_stats.py "$B" "$T/out/all" $names | tail -1
PYTHONIOENCODING=utf-8 python classify.py "$B" "$T/out/all" $names | tail -1

echo '== 8. Chrome エンジンの時間（dist を読むだけ）'
mkdir -p "$T/out/chrome-bench"
node bench_chrome.js "$T/out/chrome-bench" 3
