"""
Gemini APIを使用してPDFファイルのOCR（文字認識）を行い、Markdownデータを出力するプログラム。
PDFの各ページを抽出し、Geminiに送信してテキストを抽出します。
コマンドラインから実行し、ファイルまたはディレクトリを指定してまとめて処理できます。

Usage:
    python ocr_court_doc.py <PDF_PATH_OR_DIR> [--batch_size <NUMBER>] [--start_page <NUMBER>] [--end_page <NUMBER>]

出力は、各PDFと同じディレクトリに .md 拡張子で保存されます。
"""

import sys
import argparse
from pathlib import Path

try:
    from lib.pdf_to_markdown import pdf_to_text, get_ocr_prompt
except ImportError:
    # For when running from a different directory or as a module
    try:
        from .lib.pdf_to_markdown import pdf_to_text, get_ocr_prompt
    except ImportError:
        # Fallback if running directly from src
        import sys
        sys.path.append(str(Path(__file__).resolve().parent))
        from lib.pdf_to_markdown import pdf_to_text, get_ocr_prompt

# 日本の裁判文書のスタイル定義
COURT_DOC_STYLE = """
# CONTEXT: Japanese Court Document
- **Format**: Horizontal text. Ignore line numbers, punch holes, stamps, and page numbers in margins.
- **Spaced Text**: Remove wide spacing in titles (e.g., "陳　述　書" -> "**陳述書**").
- **Line Breaks**: CRITICAL. Merge lines within paragraphs. Only break lines at clear paragraph ends or headings.

# STRUCTURE & HEADINGS
1. **Decision: Heading or Paragraph?** (Apply this FIRST)
   - **Paragraph**: If the text following the number/marker is a long sentence (often ends with "。") or spans multiple lines, it is a **Paragraph**. Do NOT use `#`.
   - **Paragraph**: If you see consecutive items of the same level (e.g., "1 ...", "2 ...", "ア ...", "イ ...", "a ...", "b ..."), they are **Paragraphs**. Do NOT use `#`.
   - **Heading**: Only if the text is short (a title), usually has no punctuation at the end, and is followed by body text on the next line.

2. **Heading Hierarchy** (Apply ONLY if it is a Heading)
   - "第1", "第2" ... -> H1 (`#`)
   - "1", "2" ... -> H2 (`##`)
   - "(1)", "(2)" ... -> H3 (`###`)
   - "ア", "イ" ... -> H4 (`####`)
   - "(ア)", "(イ)" ... -> H5 (`#####`)
   - "a", "b" ... -> H6 (`######`)
   - "(a)", "(b)" ... -> Bold (`**text**`)

3. **Formatting Rules**
   - **No Numbering = No Heading**: Text like "事実及び理由" or "主文" must be **Bold** (`**text**`).
   - **Numbering Style**: Use standard paragraphs starting with the number (e.g., "1 被告は..."). Do NOT use Markdown lists (`1. ...`).
"""

if __name__ == "__main__":
    # コマンドライン引数の解析
    parser = argparse.ArgumentParser(description="Gemini Batch APIを使用して裁判文書のPDFのOCRを行い、Markdownを出力します。")
    parser.add_argument("input_path", type=str, nargs='?', help="処理対象のPDFファイルパスまたはディレクトリパス")
    parser.add_argument("--batch_size", type=int, default=4, help="一度に処理するページ数 (デフォルト: 4)")
    parser.add_argument("--start_page", type=int, default=1, help="開始ページ番号 (1開始, デフォルト: 1)")
    parser.add_argument("--end_page", type=int, default=None, help="終了ページ番号 (1開始, デフォルト: 最終ページ)")
    parser.add_argument("--show_prompt", action="store_true", help="実行せずにプロンプトのみを表示します。")
    
    args = parser.parse_args()

    if args.show_prompt:
        print("\n--- Gemini OCR Prompt Template ---")
        print(get_ocr_prompt(args.batch_size, COURT_DOC_STYLE))
        print("----------------------------------\n")
        sys.exit(0)

    if not args.input_path:
        parser.error("the following arguments are required: input_path (unless --show_prompt is used)")

    input_path = Path(args.input_path)
    
    if input_path.is_dir():
        # ディレクトリ内の全てのPDFファイルを対象にする（ファイル名順にソート）
        pdf_files = sorted(list(input_path.glob("*.pdf")), key=lambda x: x.name)
        if not pdf_files:
            print(f"[WARN] No PDF files found in directory: {input_path}")
            sys.exit(0)
        
        print(f"[INFO] Found {len(pdf_files)} PDF files in {input_path}")
        for pdf_file in pdf_files:
            print(f"\n[PROCESS] Starting: {pdf_file.name}")
            pdf_to_text(
                pdf_file, 
                batch_size=args.batch_size, 
                start_page=args.start_page, 
                end_page=args.end_page,
                context_instruction=COURT_DOC_STYLE
            )
    else:
        # 単一ファイルの処理
        pdf_to_text(
            input_path, 
            batch_size=args.batch_size, 
            start_page=args.start_page, 
            end_page=args.end_page,
            context_instruction=COURT_DOC_STYLE
        )
