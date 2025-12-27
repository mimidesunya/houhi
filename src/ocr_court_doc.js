/**
 * Gemini APIを使用して裁判文書PDFのOCRを行い、Markdownを出力するプログラム。
 * 
 * 使い方:
 *   node src/ocr_court_doc.js <PDFファイルパス または ディレクトリパス> [--batch_size <枚数>] [--start_page <開始ページ>] [--end_page <終了ページ>]
 */
const fs = require('fs');
const path = require('path');
const { pdfToText, getOcrPrompt } = require('./lib/gemini_ocr.js');

const samplePath = path.join(__dirname, 'base', 'sample.md');
let sampleContent = "";
try {
    sampleContent = fs.readFileSync(samplePath, 'utf-8');
} catch (e) {
    console.warn(`[WARN] Could not read sample.md at ${samplePath}: ${e.message}`);
}

const COURT_DOC_STYLE = `
# TARGET OUTPUT STYLE
Follow the structure and formatting of this example:

${sampleContent}
`;

async function main() {
    const args = process.argv.slice(2);
    const inputPaths = [];
    let batchSize = 4;
    let startPage = 1;
    let endPage = null;
    let showPrompt = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--batch_size") batchSize = parseInt(args[++i]);
        else if (args[i] === "--start_page") startPage = parseInt(args[++i]);
        else if (args[i] === "--end_page") endPage = parseInt(args[++i]);
        else if (args[i] === "--show_prompt") showPrompt = true;
        else inputPaths.push(args[i]);
    }

    if (showPrompt) {
        console.log("\n--- Gemini OCR Prompt Template ---");
        console.log(getOcrPrompt(batchSize, COURT_DOC_STYLE));
        console.log("----------------------------------\n");
        return;
    }

    if (inputPaths.length === 0) {
        console.log("-------------------------------------------------------");
        console.log(" PDFファイルまたはフォルダをドロップしてください。");
        console.log(" Usage: node ocr_court_doc.js <input_path...> [--batch_size <n>]");
        console.log("-------------------------------------------------------");
        return;
    }

    for (const inputPath of inputPaths) {
        const absPath = path.resolve(inputPath);
        if (!fs.existsSync(absPath)) {
            console.error(`[ERROR] Path not found: ${absPath}`);
            continue;
        }

        if (fs.statSync(absPath).isDirectory()) {
            const files = fs.readdirSync(absPath)
                .filter(f => f.toLowerCase().endsWith(".pdf"))
                .sort();
                
            if (files.length === 0) {
                console.warn(`[WARN] No PDF files found in directory: ${absPath}`);
                continue;
            }
            
            console.log(`[INFO] Found ${files.length} PDF files in ${absPath}`);
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = path.join(absPath, file);
                console.log(`\n[PROCESS] (${i + 1}/${files.length}) Starting: ${file}`);
                await pdfToText(filePath, batchSize, startPage, endPage, COURT_DOC_STYLE);
            }
        } else {
            console.log(`\n[PROCESS] Starting: ${path.basename(absPath)}`);
            await pdfToText(absPath, batchSize, startPage, endPage, COURT_DOC_STYLE);
        }
    }
}

main();
