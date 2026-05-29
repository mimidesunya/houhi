/**
 * PDF変換ツール。
 *
 * HTML または Markdown を、裁判文書向けレイアウトの PDF に変換します。
 * HTML 内に `<pre>` がある場合は、事前に Markdown レンダリングを行ってから PDF 化します。
 *
 * 入力:
 * - `.html`
 * - `.md`
 * - 引数なしの場合はクリップボード内容
 *
 * 出力:
 * - 入力ファイルがある場合は、原則として入力ファイルと同じ場所に `.pdf` を作成します。
 * - テンプレートやクリップボード入力時は `output/` を使用します。
 * - Markdown から変換する際は一時的に `.html` を生成し、変換後に削除します。
 *
 * 補足:
 * - 変換後は生成した PDF を既定アプリまたはブラウザで開こうとします。
 * - CSS やテンプレートは `src/base/` を基準に参照します。
 * - PDF 生成エンジンは Copper PDF または Chrome を選択できます（既定は Chrome）。
 *
 * 使い方:
 *   node src/convert_to_pdf.js [--pdf-engine=copper|chrome] <入力ファイルパス(.html または .md)>
 *   node src/convert_to_pdf.js --chrome <入力ファイルパス>
 *   node src/convert_to_pdf.js --copper <入力ファイルパス>
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const clipboardy = require('clipboardy');
const { PDF_ENGINE_CHROME, convertHtmlToPdf, resolvePdfEngine } = require('./lib/pdf_converter');
const { renderPreTags } = require('./lib/markdown_renderer');

// 設定
const BASE_DIR = __dirname;
const PROJECT_ROOT = path.dirname(BASE_DIR);

// デフォルト値
const DEFAULT_TEMPLATE_DIR = path.join(BASE_DIR, 'base');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
const DEFAULT_MAIN_HTML = 'base.html';

const CHROME_PAGE_NUMBER_STYLE = `<style data-houhi-page-number-style="chrome">
html[data-houhi-pdf-engine="chrome"],
html[data-houhi-pdf-engine="chrome"] body,
html[data-houhi-pdf-engine="chrome"] body * {
    font-family: "NotoSerifJP-Regular", "MS Mincho", "Hiragino Mincho ProN", serif;
    font-size: 12pt;
}

body::before {
    content: none !important;
    display: none !important;
}

@media print {
    html[data-houhi-pdf-engine="chrome"] body::before {
        content: none !important;
        display: none !important;
    }
}

@page {
    counter-increment: page 1;
}
</style>`;

function getPdfEngineHeadMarkup(engine) {
    if (engine === PDF_ENGINE_CHROME) {
        return `\n    ${CHROME_PAGE_NUMBER_STYLE.replace(/\n/g, '\n    ')}`;
    }
    return '';
}

function applyPdfEngineHtml(htmlContent, engine) {
    const attrs = `data-houhi-pdf-engine="${engine}"`;
    let nextContent = htmlContent;

    if (/<html\b[^>]*>/i.test(nextContent)) {
        nextContent = nextContent.replace(/<html\b([^>]*)>/i, (match, attrText) => {
            if (/\bdata-houhi-pdf-engine\s*=/.test(attrText)) {
                return match.replace(/\bdata-houhi-pdf-engine\s*=\s*(["']).*?\1/i, attrs);
            }
            return `<html${attrText} ${attrs}>`;
        });
    } else {
        nextContent = `<html lang="ja" ${attrs}>${nextContent}</html>`;
    }

    if (engine !== PDF_ENGINE_CHROME || nextContent.includes('data-houhi-page-number-style="chrome"')) {
        return nextContent;
    }

    if (/<\/head>/i.test(nextContent)) {
        return nextContent.replace(/<\/head>/i, `${getPdfEngineHeadMarkup(engine)}\n</head>`);
    }

    return nextContent.replace(/<html\b[^>]*>/i, match => `${match}\n<head>${getPdfEngineHeadMarkup(engine)}\n</head>`);
}

function writeEngineHtmlCopy(htmlPath, engine, outputDir) {
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const engineHtml = applyPdfEngineHtml(htmlContent, engine);
    if (engineHtml === htmlContent) {
        return null;
    }

    const tempPath = path.join(outputDir, `temp_${engine}_${Date.now()}_${path.basename(htmlPath)}`);
    fs.writeFileSync(tempPath, engineHtml, 'utf-8');
    return tempPath;
}

function wrapMarkdownInHtml(markdownContent, title = "裁判文書", engine = "copper") {
    return `<!DOCTYPE html>
<html lang="ja" data-houhi-pdf-engine="${engine}">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <link rel="stylesheet" href="style.css">
    ${getPdfEngineHeadMarkup(engine)}
    <script src="court_markdown.js"></script>
</head>
<body>

<pre>
${markdownContent}
</pre>

</body>
</html>`;
}

function printUsage() {
    console.log('使い方: node src/convert_to_pdf.js [--pdf-engine=copper|chrome] <入力ファイルパス(.html または .md)>');
    console.log('       node src/convert_to_pdf.js --chrome <入力ファイルパス>');
    console.log('       node src/convert_to_pdf.js --copper <入力ファイルパス>');
}

function parseArgs(args) {
    const files = [];
    const pdfOptions: Record<string, string> = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            return { files, pdfOptions, help: true };
        }
        if (arg === '--chrome') {
            pdfOptions.engine = 'chrome';
            continue;
        }
        if (arg === '--copper') {
            pdfOptions.engine = 'copper';
            continue;
        }
        if (arg === '--pdf-engine' || arg === '--engine') {
            const value = args[++i];
            if (!value) {
                throw new Error(`${arg} には copper または chrome を指定してください。`);
            }
            pdfOptions.engine = value;
            continue;
        }
        if (arg.startsWith('--pdf-engine=')) {
            pdfOptions.engine = arg.slice('--pdf-engine='.length);
            continue;
        }
        if (arg.startsWith('--engine=')) {
            pdfOptions.engine = arg.slice('--engine='.length);
            continue;
        }
        if (arg.startsWith('--chrome-path=')) {
            pdfOptions.chromePath = arg.slice('--chrome-path='.length);
            continue;
        }
        if (arg === '--chrome-path') {
            const value = args[++i];
            if (!value) {
                throw new Error('--chrome-path には Chrome/Chromium の実行ファイルパスを指定してください。');
            }
            pdfOptions.chromePath = value;
            continue;
        }
        files.push(arg);
    }

    return { files, pdfOptions, help: false };
}

async function processFile(inputPath, inputText, isHtmlInput, isMarkdownInput, pdfOptions = {}) {
    // 出力ディレクトリの準備
    if (!fs.existsSync(DEFAULT_OUTPUT_DIR)) {
        fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
    }

    let htmlToConvert = "";
    let resourceDir = DEFAULT_TEMPLATE_DIR;
    let outputPdfPath = "";
    let filesToDelete = [];
    const pdfEngine = resolvePdfEngine(pdfOptions);

    if (isHtmlInput) {
        try {
            let htmlContent = fs.readFileSync(inputPath, 'utf-8');
            if (htmlContent.includes('<pre')) {
                const newContent = renderPreTags(htmlContent, path.dirname(inputPath));
                if (newContent !== htmlContent) {
                    const tempRenderedPath = path.join(DEFAULT_OUTPUT_DIR, `temp_rendered_${Date.now()}.html`);
                    fs.writeFileSync(tempRenderedPath, newContent, 'utf-8');
                    inputPath = tempRenderedPath;
                    filesToDelete.push(tempRenderedPath);
                    console.log("Markdown (pre) を検出したため、事前レンダリングを行いました。");
                }
            }
        } catch (err) {
            console.error(`HTML読み込み/レンダリングエラー: ${err}`);
        }

        htmlToConvert = inputPath;
        resourceDir = path.dirname(inputPath);
        const baseName = path.basename(inputPath, path.extname(inputPath));
        const outputDir = (path.dirname(inputPath) === DEFAULT_TEMPLATE_DIR) ? DEFAULT_OUTPUT_DIR : path.dirname(inputPath);
        outputPdfPath = path.join(outputDir, `${baseName}.pdf`);

        const engineHtmlPath = writeEngineHtmlCopy(htmlToConvert, pdfEngine, DEFAULT_OUTPUT_DIR);
        if (engineHtmlPath) {
            htmlToConvert = engineHtmlPath;
            filesToDelete.push(engineHtmlPath);
            console.log(`PDFエンジン用HTMLを生成しました (${pdfEngine}): ${engineHtmlPath}`);
        }
    } else if (isMarkdownInput) {
        const titleMatch = inputText.match(/^#\s+(.*)$/m);
        const title = titleMatch ? titleMatch[1].trim() : "裁判文書";
        let htmlContent = wrapMarkdownInHtml(inputText, title, pdfEngine);

        const safeTitle = title.replace(/[\\/*?:"<>|]/g, "");
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const baseFilename = inputPath ? path.basename(inputPath, '.md') : `${dateStr}-${safeTitle}`;
        const outputDir = inputPath ? path.dirname(inputPath) : DEFAULT_OUTPUT_DIR;

        htmlToConvert = path.join(outputDir, `${baseFilename}.html`);
        const baseDirForResources = inputPath ? path.dirname(inputPath) : DEFAULT_TEMPLATE_DIR;
        htmlContent = renderPreTags(htmlContent, baseDirForResources);

        fs.writeFileSync(htmlToConvert, htmlContent, 'utf-8');
        filesToDelete.push(htmlToConvert);
        console.log(`HTMLを生成しました: ${htmlToConvert}`);
        outputPdfPath = path.join(outputDir, `${baseFilename}.pdf`);
        resourceDir = outputDir;
    }

    // PDF変換
    await convertHtmlToPdf(htmlToConvert, outputPdfPath, resourceDir, DEFAULT_TEMPLATE_DIR, pdfOptions);

    // 一時ファイルの削除
    for (const file of filesToDelete) {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                console.log(`一時ファイルを削除しました: ${file}`);
            }
        } catch (err) {
            console.error(`一時ファイル削除エラー: ${err}`);
        }
    }

    // PDFを開く
    if (fs.existsSync(outputPdfPath)) {
        console.log(`PDFを作成しました: ${outputPdfPath}`);
        const platform = process.platform;
        let command = platform === 'win32' ? `start msedge "${outputPdfPath}"` : (platform === 'darwin' ? `open "${outputPdfPath}"` : `xdg-open "${outputPdfPath}"`);
        exec(command, (err) => {
            if (err) console.error(`PDFを開けませんでした: ${err}`);
        });
    }
}

async function main() {
    let parsed;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`エラー: ${err instanceof Error ? err.message : err}`);
        printUsage();
        process.exitCode = 1;
        return;
    }

    if (parsed.help) {
        printUsage();
        return;
    }

    const args = parsed.files;
    const pdfOptions = parsed.pdfOptions;

    if (args.length > 0) {
        for (const arg of args) {
            const inputPath = path.resolve(arg);
            if (!fs.existsSync(inputPath)) {
                console.error(`エラー: 入力ファイル ${inputPath} が見つかりません。`);
                continue;
            }

            if (fs.statSync(inputPath).isDirectory()) {
                console.error(`エラー: ディレクトリが指定されています。ファイルを指定してください: ${inputPath}`);
                continue;
            }
            
            const ext = path.extname(inputPath).toLowerCase();
            if (ext === '.html') {
                await processFile(inputPath, "", true, false, pdfOptions);
            } else if (ext === '.md') {
                const inputText = fs.readFileSync(inputPath, 'utf-8');
                await processFile(inputPath, inputText, false, true, pdfOptions);
            } else {
                console.error(`エラー: .html または .md ファイルを指定してください: ${inputPath}`);
            }
        }
    } else {
        // 引数がない場合、クリップボードからHTMLまたはMarkdownを試行
        console.log("-------------------------------------------------------");
        console.log(" ファイルが指定されていません。");
        console.log(" クリップボードからHTMLまたはMarkdownを取得します。");
        console.log("-------------------------------------------------------");
        
        try {
            const clipboardContent = clipboardy.readSync();
            if (clipboardContent) {
                const trimmed = clipboardContent.trim().toLowerCase();
                if (trimmed.startsWith("<!doctype html") || trimmed.includes("<html")) {
                    console.log("クリップボードからHTMLを検出しました。");
                    if (!fs.existsSync(DEFAULT_OUTPUT_DIR)) {
                        fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
                    }
                    const tempHtmlPath = path.join(DEFAULT_OUTPUT_DIR, "temp_clipboard_input.html");
                    fs.writeFileSync(tempHtmlPath, clipboardContent, 'utf-8');
                    await processFile(tempHtmlPath, "", true, false, pdfOptions);
                } else {
                    console.log("クリップボードの内容をMarkdownとして処理します。");
                    await processFile("", clipboardContent, false, true, pdfOptions);
                }
            } else {
                const defaultHtmlPath = path.join(DEFAULT_TEMPLATE_DIR, DEFAULT_MAIN_HTML);
                console.log("クリップボードが空です。デフォルトテンプレートを使用します。");
                await processFile(defaultHtmlPath, "", true, false, pdfOptions);
            }
        } catch (err) {
            console.error(`クリップボード取得エラー: ${err}`);
            const defaultHtmlPath = path.join(DEFAULT_TEMPLATE_DIR, DEFAULT_MAIN_HTML);
            await processFile(defaultHtmlPath, "", true, false, pdfOptions);
        }
    }
    console.log("\nすべての処理が完了しました。");
}

if (require.main === module) {
    main();
}

module.exports = {
    parseArgs,
    processFile,
    wrapMarkdownInHtml
};
