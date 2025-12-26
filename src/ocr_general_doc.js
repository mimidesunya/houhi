/**
 * Gemini APIを使用して一般文書PDFのOCRを行い、Markdownを出力するプログラム。
 * 
 * 使い方:
 *   node src/ocr_general_doc.js <PDFファイルパス または ディレクトリパス> [--batch_size <枚数>] [--start_page <開始ページ>] [--end_page <終了ページ>]
 */
const fs = require('fs');
const path = require('path');
const { pdfToText, getOcrPrompt } = require('./lib/pdf_to_markdown.js');

const GENERAL_DOC_STYLE = `
# CONTEXT: General Document
- **Format**: Standard Japanese document.
- **Line Breaks**: Merge lines within paragraphs.
- **Headings**: Use standard Markdown headings (#, ##, ###) based on the document structure.
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
        console.log(getOcrPrompt(batchSize, GENERAL_DOC_STYLE));
        console.log("----------------------------------\n");
        return;
    }

    if (!inputPath) {
        console.error("Usage: node ocr_general_doc.js <input_path> [--batch_size <n>] [--start_page <n>] [--end_page <n>]");
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
            await pdfToText(filePath, batchSize, startPage, endPage, GENERAL_DOC_STYLE);
        }
    } else {
        await pdfToText(absPath, batchSize, startPage, endPage, GENERAL_DOC_STYLE);
    }
}

main();
