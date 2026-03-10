/**
 * FAX送信用PDF変換ツール
 *
 * 入力PDFの各ページを画像としてレンダリングし、二値化したうえで
 * 画像だけを配置した新しいPDFを作成します。
 * これにより、出力PDFに元PDFのテキスト/フォント情報を含めません。
 *
 * 入力:
 * - `.pdf` を 1 件以上指定できます。
 *
 * 出力:
 * - 入力ファイルと同じ場所に `<元ファイル名>_fax.pdf` を作成します。
 *
 * オプション:
 * - `--dpi <72-400>`: 画像化解像度を指定します。
 * - `--threshold <0-255>`: 二値化しきい値を指定します。
 *
 * 補足:
 * - PDF 以外はエラーとしてスキップします。
 * - 日本語フォントを探索して登録し、変換ログを表示します。
 *
 * 使い方:
 *   node src/fax_prepare_pdf.js <PDFファイルパス...> [--dpi 200] [--threshold 170]
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, registerFont } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const DEFAULT_DPI = 200;
const DEFAULT_THRESHOLD = 170;

const JAPANESE_FONT_CANDIDATES = [
    { path: 'C:/Windows/Fonts/msgothic.ttc', family: 'MS Gothic' },
    { path: 'C:/Windows/Fonts/msmincho.ttc', family: 'MS Mincho' },
    { path: 'C:/Windows/Fonts/meiryo.ttc', family: 'Meiryo' },
    { path: 'C:/Windows/Fonts/YuGothM.ttc', family: 'Yu Gothic' },
    { path: 'C:/Windows/Fonts/YuMincho.ttc', family: 'Yu Mincho' },
    { path: 'C:/Windows/Fonts/BIZ-UDGothicR.ttc', family: 'BIZ UDGothic' },
    { path: 'C:/Windows/Fonts/BIZ-UDMinchoM.ttc', family: 'BIZ UDMincho' },
    { path: 'C:/Windows/Fonts/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK JP' },
    { path: 'C:/Windows/Fonts/NotoSerifCJK-Regular.ttc', family: 'Noto Serif CJK JP' }
];

function registerJapaneseFonts() {
    let loaded = 0;

    for (const candidate of JAPANESE_FONT_CANDIDATES) {
        try {
            if (!fs.existsSync(candidate.path)) {
                continue;
            }
            registerFont(candidate.path, { family: candidate.family });
            loaded++;
        } catch (error) {
            // フォント読み込み失敗時は処理継続
        }
    }

    return loaded;
}

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

function parseArgs(args) {
    const options = {
        dpi: DEFAULT_DPI,
        threshold: DEFAULT_THRESHOLD,
        inputFiles: []
    };

    for (let index = 0; index < args.length; index++) {
        const token = args[index];

        if (token === '--dpi') {
            const value = Number(args[index + 1]);
            if (!Number.isFinite(value) || value < 72 || value > 400) {
                throw new Error('--dpi は 72〜400 の数値で指定してください。');
            }
            options.dpi = Math.round(value);
            index++;
            continue;
        }

        if (token === '--threshold') {
            const value = Number(args[index + 1]);
            if (!Number.isFinite(value) || value < 0 || value > 255) {
                throw new Error('--threshold は 0〜255 の数値で指定してください。');
            }
            options.threshold = Math.round(value);
            index++;
            continue;
        }

        if (token.startsWith('--')) {
            throw new Error(`不明なオプションです: ${token}`);
        }

        options.inputFiles.push(token);
    }

    return options;
}

function toFaxBinary(imageData, threshold) {
    const pixels = imageData.data;
    for (let position = 0; position < pixels.length; position += 4) {
        const red = pixels[position];
        const green = pixels[position + 1];
        const blue = pixels[position + 2];

        const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
        const binary = luminance >= threshold ? 255 : 0;

        pixels[position] = binary;
        pixels[position + 1] = binary;
        pixels[position + 2] = binary;
        pixels[position + 3] = 255;
    }
}

async function convertPdfForFax(inputPath, options) {
    const pdfjsPackageDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const standardFontDataUrl = path.join(pdfjsPackageDir, 'standard_fonts') + path.sep;
    const cMapUrl = path.join(pdfjsPackageDir, 'cmaps') + path.sep;
    const renderCanvasFactory = new SafeCanvasFactory();
    const pdfBytes = fs.readFileSync(inputPath);
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
    const outputPdf = await PDFDocument.create();
    const scale = options.dpi / 72;

    console.log(`  ページ数: ${sourcePdf.numPages}`);

    for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber++) {
        const page = await sourcePdf.getPage(pageNumber);
        const originalViewport = page.getViewport({ scale: 1 });
        const renderViewport = page.getViewport({ scale });

        const canvas = createCanvas(Math.ceil(renderViewport.width), Math.ceil(renderViewport.height));
        const context = canvas.getContext('2d');

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
            canvasContext: context,
            viewport: renderViewport,
            canvasFactory: renderCanvasFactory,
            background: 'rgb(255, 255, 255)'
        }).promise;

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        toFaxBinary(imageData, options.threshold);
        context.putImageData(imageData, 0, 0);

        const pngBuffer = canvas.toBuffer('image/png');
        const embeddedImage = await outputPdf.embedPng(pngBuffer);

        const outPage = outputPdf.addPage([originalViewport.width, originalViewport.height]);
        outPage.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: originalViewport.width,
            height: originalViewport.height
        });

        console.log(`  変換: ${pageNumber}/${sourcePdf.numPages}`);

        if (typeof page.cleanup === 'function') {
            page.cleanup();
        }
    }

    const outputDir = path.dirname(inputPath);
    const outputPath = path.join(
        outputDir,
        `${path.basename(inputPath, path.extname(inputPath))}_fax.pdf`
    );

    const outBytes = await outputPdf.save({
        useObjectStreams: false
    });

    fs.writeFileSync(outputPath, outBytes);

    if (typeof sourcePdf.cleanup === 'function') {
        sourcePdf.cleanup();
    }

    return outputPath;
}

async function main() {
    let options;
    try {
        options = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`引数エラー: ${error.message}`);
        console.error('使い方: node src/fax_prepare_pdf.js <PDFファイル...> [--dpi 200] [--threshold 170]');
        process.exit(1);
    }

    if (options.inputFiles.length === 0) {
        console.error('使い方: node src/fax_prepare_pdf.js <PDFファイル...> [--dpi 200] [--threshold 170]');
        process.exit(1);
    }

    const loadedFonts = registerJapaneseFonts();
    console.log(`FAX変換を開始します (dpi=${options.dpi}, threshold=${options.threshold})`);
    console.log(`Canvas backend: ${require.resolve('canvas')}`);
    console.log(`Japanese fonts registered: ${loadedFonts}`);
    console.log('─'.repeat(50));

    let successCount = 0;
    let errorCount = 0;

    for (const fileArg of options.inputFiles) {
        const inputPath = path.resolve(fileArg);
        const ext = path.extname(inputPath).toLowerCase();
        const name = path.basename(inputPath);

        if (!fs.existsSync(inputPath)) {
            console.error(`エラー: ファイルが見つかりません: ${inputPath}`);
            errorCount++;
            continue;
        }

        if (ext !== '.pdf') {
            console.error(`エラー: PDFのみ対応しています: ${name}`);
            errorCount++;
            continue;
        }

        try {
            console.log(`処理中: ${name}`);
            const outputPath = await convertPdfForFax(inputPath, options);
            console.log(`完了: ${outputPath}`);
            successCount++;
        } catch (error) {
            console.error(`エラー: ${name} の変換に失敗しました: ${error.message}`);
            errorCount++;
        }

        console.log('─'.repeat(50));
    }

    console.log(`処理完了: ${successCount} 成功 / ${errorCount} 失敗`);
    if (errorCount > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(`致命的エラー: ${error.message}`);
    process.exit(1);
});
