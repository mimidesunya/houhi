/**
 * Gemini APIを使用して裁判文書PDFのOCRを行い、Markdownを出力するプログラム。
 * 
 * 使い方:
 *   node src/ocr_court_doc.js <PDFファイルパス または ディレクトリパス> [--batch_size <枚数>] [--start_page <開始ページ>] [--end_page <終了ページ>]
 */
const fs = require('fs');
const path = require('path');
const { pdfToText, getOcrPrompt } = require('./lib/gemini_ocr.js');

const COURT_DOC_STYLE = `
# CONTEXT: Japanese Court Document
- **Format**: Horizontal text. Ignore line numbers, punch holes, stamps, and page numbers in margins.
- **Spaced Text**: Remove wide spacing in titles (e.g., "陳　述　書" -> "**陳述書**").
- **Line Breaks**: CRITICAL. Merge lines within paragraphs. Only break lines at clear paragraph ends or headings.

# STRUCTURE & HEADINGS
1. **Decision: Heading or Paragraph?** (Apply this FIRST)
   - **Paragraph**: If the text following the number/marker is a long sentence (often ends with "。") or spans multiple lines, it is a **Paragraph**. Do NOT use #.
   - **Paragraph**: If you see consecutive items of the same level (e.g., "1 ...", "2 ...", "ア ...", "イ ...", "a ...", "b ..."), they are **Paragraphs**. Do NOT use #.
   - **Heading**: Only if the text is short (a title), usually has no punctuation at the end, and is followed by body text on the next line.

2. **Heading Hierarchy** (Apply ONLY if it is a Heading)
   - "第1", "第2" ... -> H1 (#)
   - "1", "2" ... -> H2 (##)
   - "(1)", "(2)" ... -> H3 (###)
   - "ア", "イ" ... -> H4 (####)
   - "(ア)", "(イ)" ... -> H5 (#####)
   - "a", "b" ... -> H6 (######)
   - "(a)", "(b)" ... -> Bold (**text**)

3. **Formatting Rules**
   - **No Numbering = No Heading**: Text like "事実及び理由" or "主文" must be **Bold** (**text**).
   - **Numbering Style**: Use standard paragraphs starting with the number (e.g., "1 被告は..."). Do NOT use Markdown lists (1. ...).
`;

async function main() {
    const args = process.argv.slice(2);
    let inputPath = "";
    let batchSize = 4;
    let startPage = 1;
    let endPage = null;
    let showPrompt = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--batch_size") batchSize = parseInt(args[++i]);
        else if (args[i] === "--start_page") startPage = parseInt(args[++i]);
        else if (args[i] === "--end_page") endPage = parseInt(args[++i]);
        else if (args[i] === "--show_prompt") showPrompt = true;
        else if (!inputPath) inputPath = args[i];
    }

    if (showPrompt) {
        console.log("\n--- Gemini OCR Prompt Template ---");
        console.log(getOcrPrompt(batchSize, COURT_DOC_STYLE));
        console.log("----------------------------------\n");
        return;
    }

    if (!inputPath) {
        console.error("Usage: node ocr_court_doc.js <input_path> [--batch_size <n>] [--start_page <n>] [--end_page <n>]");
        return;
    }

    const absPath = path.resolve(inputPath);
    if (!fs.existsSync(absPath)) {
        console.error(`[ERROR] Path not found: ${absPath}`);
        return;
    }

    if (fs.statSync(absPath).isDirectory()) {
        const files = fs.readdirSync(absPath)
            .filter(f => f.toLowerCase().endsWith(".pdf"))
            .sort();
            
        if (files.length === 0) {
            console.warn(`[WARN] No PDF files found in directory: ${absPath}`);
            return;
        }
        
        console.log(`[INFO] Found ${files.length} PDF files in ${absPath}`);
        for (const file of files) {
            const filePath = path.join(absPath, file);
            console.log(`\n[PROCESS] Starting: ${file}`);
            await pdfToText(filePath, batchSize, startPage, endPage, COURT_DOC_STYLE);
        }
    } else {
        await pdfToText(absPath, batchSize, startPage, endPage, COURT_DOC_STYLE);
    }
}

main();
