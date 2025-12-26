/**
 * 裁判文書の基本テンプレート（src/base/base.html）をプレビュー用のPDFに変換するプログラム。
 * 
 * 使い方:
 *   node src/preview_template.js
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { convertHtmlToPdf } = require('./lib/pdf_converter.js');
const { renderPreTags } = require('./lib/markdown_renderer.js');

async function main() {
    const baseDir = __dirname;
    
    // 基本テンプレートは src/base に配置
    const templateDir = path.join(baseDir, 'base');
    const inputHtml = path.join(templateDir, 'base.html');
    const outputPdf = path.join(templateDir, 'preview.pdf');
    const tempHtml = path.join(templateDir, 'preview.html');

    if (!fs.existsSync(templateDir)) {
        console.error(`Error: Template directory not found at ${templateDir}`);
        return;
    }

    if (!fs.existsSync(inputHtml)) {
        console.error(`Error: Template file not found at ${inputHtml}`);
        return;
    }

    console.log(`Rendering Markdown and converting ${inputHtml} to PDF...`);
    
    // Markdownの事前レンダリング
    try {
        const htmlContent = fs.readFileSync(inputHtml, 'utf-8');
        const renderedContent = renderPreTags(htmlContent, templateDir);
        
        // 一時ファイルに保存
        fs.writeFileSync(tempHtml, renderedContent, 'utf-8');
        
        // Convert
        // resourceDir is set to templateDir so it can find style.css
        await convertHtmlToPdf(tempHtml, outputPdf, templateDir);

        // 一時ファイルの削除
        if (fs.existsSync(tempHtml)) {
            fs.unlinkSync(tempHtml);
            console.log(`一時ファイルを削除しました: ${tempHtml}`);
        }
    } catch (err) {
        console.error(`Error during rendering/conversion: ${err}`);
        return;
    }

    // Open with default viewer
    if (fs.existsSync(outputPdf)) {
        console.log(`Opening ${outputPdf} with default viewer...`);
        const platform = process.platform;
        let command;
        
        if (platform === 'win32') {
            command = `start "" "${outputPdf}"`;
        } else if (platform === 'darwin') {
            command = `open "${outputPdf}"`;
        } else {
            command = `xdg-open "${outputPdf}"`;
        }

        exec(command, (err) => {
            if (err) {
                console.error(`Failed to open PDF: ${err}`);
                console.log("Please open it manually.");
            }
        });
    }
}

main();
