/**
 * HTMLまたはMarkdownファイルを裁判文書形式のPDFに変換するプログラム。
 * 
 * 使い方:
 *   node src/convert_to_pdf.js <入力ファイルパス(.html または .md)>
 * 
 * 引数がない場合は、クリップボードの内容を読み取ります。
 * - クリップボードがHTML形式ならそのまま変換。
 * - それ以外ならMarkdownとして扱い、テンプレートで包んで変換。
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const clipboardy = require('clipboardy');
const { convertHtmlToPdf } = require('./lib/pdf_converter.js');
const { renderPreTags } = require('./lib/markdown_renderer.js');

// 設定
const BASE_DIR = __dirname;
const PROJECT_ROOT = path.dirname(BASE_DIR);

// デフォルト値
const DEFAULT_TEMPLATE_DIR = path.join(BASE_DIR, 'base');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
const DEFAULT_MAIN_HTML = 'base.html';

function wrapMarkdownInHtml(markdownContent, title = "裁判文書") {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <link rel="stylesheet" href="style.css">
    <script src="script.js"></script>
</head>
<body>

<pre>
${markdownContent}
</pre>

</body>
</html>`;
}

async function processFile(inputPath, inputText, isHtmlInput, isMarkdownInput) {
    // 出力ディレクトリの準備
    if (!fs.existsSync(DEFAULT_OUTPUT_DIR)) {
        fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
    }

    let htmlToConvert = "";
    let resourceDir = DEFAULT_TEMPLATE_DIR;
    let outputPdfPath = "";
    let filesToDelete = [];

    if (isHtmlInput) {
        try {
            let htmlContent = fs.readFileSync(inputPath, 'utf-8');
            if (htmlContent.includes('<pre')) {
                const newContent = renderPreTags(htmlContent);
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
    } else if (isMarkdownInput) {
        const titleMatch = inputText.match(/^#\s+(.*)$/m);
        const title = titleMatch ? titleMatch[1].trim() : "裁判文書";
        let htmlContent = wrapMarkdownInHtml(inputText, title);

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
        resourceDir = DEFAULT_TEMPLATE_DIR;
    }

    // PDF変換
    await convertHtmlToPdf(htmlToConvert, outputPdfPath, resourceDir, DEFAULT_TEMPLATE_DIR);

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
        let command = platform === 'win32' ? `start "" "${outputPdfPath}"` : (platform === 'darwin' ? `open "${outputPdfPath}"` : `xdg-open "${outputPdfPath}"`);
        exec(command, (err) => {
            if (err) console.error(`PDFを開けませんでした: ${err}`);
        });
    }
}

async function main() {
    const args = process.argv.slice(2);

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
                await processFile(inputPath, "", true, false);
            } else if (ext === '.md') {
                const inputText = fs.readFileSync(inputPath, 'utf-8');
                await processFile(inputPath, inputText, false, true);
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
                    await processFile(tempHtmlPath, "", true, false);
                } else {
                    console.log("クリップボードの内容をMarkdownとして処理します。");
                    await processFile("", clipboardContent, false, true);
                }
            } else {
                const defaultHtmlPath = path.join(DEFAULT_TEMPLATE_DIR, DEFAULT_MAIN_HTML);
                await processFile(defaultHtmlPath, "", true, false);
                console.log("クリップボードが空です。デフォルトテンプレートを使用します。");
            }
        } catch (err) {
            console.error(`クリップボード取得エラー: ${err}`);
            const defaultHtmlPath = path.join(DEFAULT_TEMPLATE_DIR, DEFAULT_MAIN_HTML);
            await processFile(defaultHtmlPath, "", true, false);
        }
    }
}

main();
