/**
 * Gemini APIを使用して一般文書PDFのOCRを行い、Markdownを出力するプログラム。
 * 
 * 使い方:
 *   node src/ocr_general_doc.js <PDFファイルパス または ディレクトリパス> [--batch_size <枚数>] [--start_page <開始ページ>] [--end_page <終了ページ>]
 */
const fs = require('fs');
const path = require('path');
const { pdfToText, docToText, docxToText, odtToText, pptxToText, getOcrPrompt } = require('./lib/gemini_ocr.js');

const GENERAL_DOC_STYLE = `
# CONTEXT: General Document
- **Format**: Standard Japanese document.
- **Line Breaks**: Merge lines within paragraphs.
- **Headings**: Use standard Markdown headings (#, ##, ###) based on the document structure.
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
        console.log("\n--- Gemini OCR プロンプトテンプレート ---");
        console.log(getOcrPrompt(batchSize, GENERAL_DOC_STYLE));
        console.log("----------------------------------\n");
        return;
    }

    if (inputPaths.length === 0) {
        console.log("-------------------------------------------------------");
        console.log(" PDFファイルまたはフォルダをドロップしてください。");
        console.log(" 使い方: node ocr_general_doc.js <input_path...> [--batch_size <n>]");
        console.log("-------------------------------------------------------");
        return;
    }

    for (const inputPath of inputPaths) {
        const absPath = path.resolve(inputPath);
        if (!fs.existsSync(absPath)) {
            console.error(`[エラー] パスが見つかりません: ${absPath}`);
            continue;
        }

        const processFile = async (filePath) => {
            const ext = path.extname(filePath).toLowerCase();
            if (ext === ".pdf") {
                console.log(`\n[PDF 処理] 開始: ${path.basename(filePath)}`);
                await pdfToText(filePath, batchSize, startPage, endPage, GENERAL_DOC_STYLE);
            } else if (ext === ".docx") {
                console.log(`\n[Word 処理] 開始: ${path.basename(filePath)}`);
                await docxToText(filePath, GENERAL_DOC_STYLE);
            } else if (ext === ".doc") {
                console.log(`\n[Word(doc) 処理] 開始: ${path.basename(filePath)}`);
                await docToText(filePath, GENERAL_DOC_STYLE);
            } else if (ext === ".odt") {
                console.log(`\n[ODT 処理] 開始: ${path.basename(filePath)}`);
                await odtToText(filePath, GENERAL_DOC_STYLE);
            } else if (ext === ".pptx") {
                console.log(`\n[PowerPoint 処理] 開始: ${path.basename(filePath)}`);
                await pptxToText(filePath, GENERAL_DOC_STYLE);
            } else {
                console.warn(`[警告] 未対応のファイル形式です: ${path.basename(filePath)}`);
            }
        };

        if (fs.statSync(absPath).isDirectory()) {
            const files = fs.readdirSync(absPath)
                .filter(f => {
                    const ext = f.toLowerCase();
                    return ext.endsWith(".pdf") || ext.endsWith(".docx") || ext.endsWith(".doc") || ext.endsWith(".odt") || ext.endsWith(".pptx");
                })
                .sort();
                
            if (files.length === 0) {
                console.warn(`[警告] ディレクトリ内に PDF または Word ファイルが見つかりませんでした: ${absPath}`);
                continue;
            }
            
            console.log(`[情報] ${absPath} 内に ${files.length} 個のファイルが見つかりました`);
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = path.join(absPath, file);
                console.log(`\n[進捗] (${i + 1}/${files.length})`);
                await processFile(filePath);
            }
        } else {
            await processFile(absPath);
        }
    }
    console.log("\nすべての処理が完了しました。");
}

main();
