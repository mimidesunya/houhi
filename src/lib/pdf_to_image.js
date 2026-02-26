const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

class SafeCanvasFactory {
    create(width, height) {
        if (width <= 0 || height <= 0) {
            throw new Error(`無効なキャンバスサイズです: ${width}x${height}`);
        }
        const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
        const context = canvas.getContext('2d');
        return { canvas, context };
    }
    reset(canvasAndContext, width, height) {
        if (!canvasAndContext || !canvasAndContext.canvas) {
            return;
        }
        canvasAndContext.canvas.width = Math.ceil(width);
        canvasAndContext.canvas.height = Math.ceil(height);
    }
    destroy(canvasAndContext) {
        if (!canvasAndContext) {
            return;
        }
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}

/**
 * PDFの各ページをPNG画像として出力し、出力された画像パスのリストを返します。
 */
async function extractPdfToImages(pdfPath, outputDir, dpi = 200, startPage = 1, endPage = null) {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const pdfjsPackageDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const standardFontDataUrl = path.join(pdfjsPackageDir, 'standard_fonts') + path.sep;
    const cMapUrl = path.join(pdfjsPackageDir, 'cmaps') + path.sep;
    
    // 注意: パスに全角文字が含まれるのを防ぐため、出力先パスを確認するか呼び出し側で担保する
    const renderCanvasFactory = new SafeCanvasFactory();
    const pdfBytes = fs.readFileSync(pdfPath);
    
    const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes),
        standardFontDataUrl,
        cMapUrl,
        cMapPacked: true,
        CanvasFactory: SafeCanvasFactory,
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        isEvalSupported: false
    });

    const sourcePdf = await loadingTask.promise;
    const numPages = sourcePdf.numPages;
    const actualEndPage = endPage === null ? numPages : Math.min(endPage, numPages);
    
    const scale = dpi / 72;
    const outputFiles = [];

    for (let pageNumber = startPage; pageNumber <= actualEndPage; pageNumber++) {
        const page = await sourcePdf.getPage(pageNumber);
        const renderViewport = page.getViewport({ scale });

        const canvas = createCanvas(Math.ceil(renderViewport.width), Math.ceil(renderViewport.height));
        const context = canvas.getContext('2d');

        // 背景を白にする
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
            canvasContext: context,
            viewport: renderViewport,
            canvasFactory: renderCanvasFactory,
            background: 'rgb(255, 255, 255)'
        }).promise;

        const pngBuffer = canvas.toBuffer('image/png');
        // ndlocrは名前順で処理するため、ゼロパディングでページ番号を入れる
        const fileName = `page_${String(pageNumber).padStart(4, '0')}.png`;
        const outputPath = path.join(outputDir, fileName);
        
        fs.writeFileSync(outputPath, pngBuffer);
        outputFiles.push(outputPath);

        if (typeof page.cleanup === 'function') {
            page.cleanup();
        }
    }

    if (typeof sourcePdf.cleanup === 'function') {
        sourcePdf.cleanup();
    }

    return outputFiles;
}

module.exports = { extractPdfToImages };
