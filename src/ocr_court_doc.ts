/**
 * 裁判文書の PDF / Word ファイルをOCR・テキスト抽出し、Markdown化するプログラム。
 * AIプロバイダーとして Gemini / Claude / OpenAI を利用できます。
 * `src/base/sample.md` を読み込み、裁判文書向けの出力スタイルを強く誘導します。
 *
 * 入力:
 * - `.pdf`
 * - `.docx`
 * - `.doc`
 * - 上記ファイルを含むディレクトリ
 *
 * 出力:
 * - PDF は主に `<元ファイル名>_paged.md` を作成します。
 * - 途中失敗時は `<元ファイル名>_ERROR_paged.md` を使って再開します。
 * - Word は対応する Markdown を同じ場所に出力します。
 *
 * オプション:
 * - `--batch_size <n>`: PDF を何ページ単位で処理するか指定します。
 * - `--start_page <n>` / `--end_page <n>`: 対象ページ範囲を制限します。
 * - `--show_prompt`: 実際に使うOCRプロンプトを表示して終了します。
 * - `--ai gemini|claude|openai`: AI プロバイダーを指定します。
 * - `--mode batch|sync`: バッチ処理または同期処理を指定します。
 * - `--ndlocr`: ndlocr を前処理として使います。
 * - `--ndlocr_only`: ndlocr のみで処理します（現状 PDF のみ対応）。
 * - `--prefer_pdf_text`: 埋め込みテキストがある PDF では OCR よりテキスト抽出を優先します。
 *
 * 補足:
 * - ディレクトリ指定時は `.pdf` / `.docx` / `.doc` のみを走査します。
 * 
 * 使い方:
 *   node src/ocr_court_doc.js <入力ファイルパス または ディレクトリパス> [--batch_size <枚数>] [--start_page <開始ページ>] [--end_page <終了ページ>]
 */
const fs = require('fs');
const path = require('path');
const { pdfToText, docToText, docxToText, getOcrPrompt } = require('./lib/ai_ocr');

const samplePath = path.join(__dirname, 'base', 'sample.md');
let sampleContent = "";
try {
    sampleContent = fs.readFileSync(samplePath, 'utf-8');
} catch (e) {
    console.warn(`[警告] ${samplePath} の sample.md を読み込めませんでした: ${e.message}`);
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
    let aiProvider = 'gemini';
    let processMode = 'sync';
    let useNdlocr = false;
    let ndlocrOnly = false;
    let preferPdfText = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--batch_size") batchSize = parseInt(args[++i]);
        else if (args[i] === "--start_page") startPage = parseInt(args[++i]);
        else if (args[i] === "--end_page") endPage = parseInt(args[++i]);
        else if (args[i] === "--show_prompt") showPrompt = true;
        else if (args[i] === "--ai") aiProvider = args[++i];
        else if (args[i] === "--mode") processMode = args[++i];
        else if (args[i] === "--ndlocr") useNdlocr = true;
        else if (args[i] === "--ndlocr_only") ndlocrOnly = true;
        else if (args[i] === "--prefer_pdf_text") preferPdfText = true;
        else inputPaths.push(args[i]);
    }

    if (showPrompt) {
        console.log("\n--- Gemini OCR プロンプトテンプレート ---");
        console.log(getOcrPrompt(batchSize, COURT_DOC_STYLE));
        console.log("----------------------------------\n");
        return;
    }

    if (inputPaths.length === 0) {
        console.log("-------------------------------------------------------");
        console.log(" PDF/Wordファイルまたはフォルダをドロップしてください。");
        console.log(" 使い方: node ocr_court_doc.js <input_path...> [--batch_size <n>] [--ai gemini|claude|openai] [--mode batch|sync] [--ndlocr] [--ndlocr_only] [--prefer_pdf_text]");
        console.log("-------------------------------------------------------");
        return;
    }

    // ファイル/ディレクトリを分類
    const fileJobs = [];   // 直接指定されたファイル
    const dirJobs = [];    // ディレクトリ

    for (const inputPath of inputPaths) {
        const absPath = path.resolve(inputPath);
        if (!fs.existsSync(absPath)) {
            console.error(`[エラー] パスが見つかりません: ${absPath}`);
            continue;
        }
        if (fs.statSync(absPath).isDirectory()) {
            dirJobs.push(absPath);
        } else {
            fileJobs.push(absPath);
        }
    }

    const processFile = async (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === ".pdf") {
            console.log(`\n[PDF 処理] 開始: ${path.basename(filePath)} (AI: ${aiProvider}, モード: ${processMode}, Pre-OCR: ${useNdlocr})`);
            await pdfToText(filePath, batchSize, startPage, endPage, COURT_DOC_STYLE, aiProvider, processMode, useNdlocr, ndlocrOnly, preferPdfText);
        } else if (ext === ".docx") {
            if (ndlocrOnly) {
                throw new Error("ndlocr-only モードは現在 PDF のみ対応です");
            }
            console.log(`\n[Word 処理] 開始: ${path.basename(filePath)} (AI: ${aiProvider}, モード: ${processMode})`);
            await docxToText(filePath, COURT_DOC_STYLE, aiProvider, processMode);
        } else if (ext === ".doc") {
            if (ndlocrOnly) {
                throw new Error("ndlocr-only モードは現在 PDF のみ対応です");
            }
            console.log(`\n[Word(doc) 処理] 開始: ${path.basename(filePath)} (AI: ${aiProvider}, モード: ${processMode})`);
            await docToText(filePath, COURT_DOC_STYLE, aiProvider, processMode);
        } else {
            console.warn(`[警告] 未対応のファイル形式です: ${path.basename(filePath)}`);
        }
    };

    // 同期モードならファイルを1つずつ順次処理、バッチモードなら並列処理
    const runFiles = async (files) => {
        if (processMode === 'sync') {
            console.log(`[情報] ${files.length} 個のファイルを順次処理します`);
            for (const fp of files) {
                try {
                    await processFile(fp);
                } catch (err) {
                    console.error(`[エラー] ${path.basename(fp)}: ${err.message}`);
                }
            }
        } else {
            console.log(`[情報] ${files.length} 個のファイルを並列処理します`);
            await Promise.all(files.map(fp => processFile(fp).catch(err => {
                console.error(`[エラー] ${path.basename(fp)}: ${err.message}`);
            })));
        }
    };

    if (fileJobs.length > 0) {
        await runFiles(fileJobs);
    }

    for (const absPath of dirJobs) {
        const files = fs.readdirSync(absPath)
            .filter(f => {
                const ext = f.toLowerCase();
                return ext.endsWith(".pdf") || ext.endsWith(".docx") || ext.endsWith(".doc");
            })
            .sort();

        if (files.length === 0) {
            console.warn(`[警告] ディレクトリ内に PDF または Word ファイルが見つかりませんでした: ${absPath}`);
            continue;
        }

        await runFiles(files.map(f => path.join(absPath, f)));
    }
    console.log("\nすべての処理が完了しました。");
}

main();
