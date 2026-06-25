/**
 * 証拠番号スタンプツール
 * PDF／画像ファイル名から証拠番号（例: 甲1_契約書.pdf、乙A1_写真.pdf）を抽出し、各ページの右上に赤文字でスタンプする。
 * 出力先: 入力ディレクトリ内の stamped/ フォルダ
 *
 * 入力:
 * - PDF または画像ファイル（JPG, PNG）を 1 件以上指定できます。
 * - 画像ファイルは自動的にA4サイズのPDFに変換してから処理します。
 * - ファイル名先頭の `甲1_契約書.pdf`, `乙2_メール.pdf`, `甲3-1_領収書.pdf`, `乙A1の2_写真.pdf` などから証拠番号を抽出します。
 *
 * 出力:
 * - 最初の入力ファイルの親フォルダに `stamped/` を作成し、その中へ個別PDFを出力します。
 * - 成功ファイルが 2 件以上ある場合は `_結合_号証一式.pdf` も作成します。
 *
 * オプション:
 * - `--all-pages`: 全ページにスタンプします（既定は1ページ目のみ）。
 * - `--font-size N`: A4印刷換算のフォントサイズを指定します。
 *
 * 補足:
 * - ファイルは証拠番号順に自然ソートして処理します。
 * - 証拠番号を抽出できないファイルは SKIP します。
 * - 複数PDF結合時は、両面印刷向けに必要な空白ページを補います。
 *
 * 使い方:
 *   node src/stamp_evidence_number.js <PDF/画像ファイルパス...>
 *
 * オプション:
 *   --all-pages   全ページにスタンプ（デフォルトは1ページ目のみ）
 *   --font-size N A4印刷換算のフォントサイズ指定（デフォルト: 20）
 *   --no-blank-pages 結合時に空白ページを挿入しない（FAX向け）
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

// ── 設定 ──────────────────────────────────────
const DEFAULT_FONT_SIZE = 20;
const MARGIN_RIGHT = 15;   // 右余白 (pt)
const MARGIN_TOP = 12;     // 上余白 (pt)
const STAMP_OUTLINE = 1.5; // 白縁取り幅 (pt)
const STAMP_SUFFIX = '号証';
const A4_WIDTH = 595.28;   // A4 幅 (pt)
const A4_HEIGHT = 841.89;  // A4 高さ (pt)
const PAGE_SIZE_TOLERANCE = 0.5;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const IMAGE_MARGIN = 36;   // 画像PDF変換時の余白 (pt)

// 日本語フォント候補（TTFを優先、TTC は pdf-lib で扱えないため避ける）
const FONT_CANDIDATES = [
    'C:\\Windows\\Fonts\\yumin.ttf',      // 游明朝 Regular (Windows, TTF)
    'C:\\Windows\\Fonts\\yumindb.ttf',    // 游明朝 Demibold (Windows, TTF)
    'C:\\Windows\\Fonts\\HGRSMP.TTF',     // HGR創英角ｺﾞｼｯｸ (Windows, TTF)
    'C:\\Windows\\Fonts\\NotoSansJP-VF.ttf', // Noto Sans JP Variable (Windows, TTF)
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', // macOS
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', // Linux
];

/**
 * 利用可能な日本語フォントを探す
 */
function findJapaneseFont() {
    for (const fontPath of FONT_CANDIDATES) {
        if (fs.existsSync(fontPath)) {
            return fontPath;
        }
    }
    return null;
}

/**
 * TTC (TrueType Collection) から最初のフォントを取り出す
 */
function loadFontBytes(fontPath) {
    const buffer = fs.readFileSync(fontPath);
    // TTC ファイルの場合、fontkit で collection として読み込む
    if (fontPath.endsWith('.ttc')) {
        const collection = fontkit.openSync(fontPath);
        // collection.fonts が配列の場合、最初のフォントを使う
        if (collection.fonts && collection.fonts.length > 0) {
            // TTC から個別フォントのバイト列を取得するため、
            // fontkit の内部データを使う
            // pdf-lib は TTC を直接扱えないので、フォールバック処理
            return buffer;
        }
    }
    return buffer;
}

/**
 * ページをA4へフィット印刷するときの倍率を返す
 */
function getA4PrintScaleForPage(width, height) {
    const isLandscape = width > height;
    const [a4W, a4H] = isLandscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
    return Math.min(a4W / width, a4H / height);
}

function getA4PageSizeForPage(width, height) {
    return width > height ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
}

function isA4PageSize(width, height) {
    const [a4W, a4H] = getA4PageSizeForPage(width, height);
    return Math.abs(width - a4W) <= PAGE_SIZE_TOLERANCE
        && Math.abs(height - a4H) <= PAGE_SIZE_TOLERANCE;
}

function getA4Placement(width, height) {
    const [pageW, pageH] = getA4PageSizeForPage(width, height);
    const scale = Math.min(pageW / width, pageH / height, 1);
    const drawW = width * scale;
    const drawH = height * scale;
    return {
        pageW,
        pageH,
        x: (pageW - drawW) / 2,
        y: (pageH - drawH) / 2,
        width: drawW,
        height: drawH,
    };
}

function pageHasContents(page) {
    return Boolean(page?.node && typeof page.node.Contents === 'function' && page.node.Contents());
}

/**
 * A4印刷時の見かけが一定になるよう、スタンプの描画寸法を補正する
 */
function getStampMetricsForA4Print(pageWidth, pageHeight, fontSize = DEFAULT_FONT_SIZE) {
    const printScale = getA4PrintScaleForPage(pageWidth, pageHeight);
    const metricScale = printScale > 0 ? 1 / printScale : 1;
    return {
        printScale,
        fontSize: fontSize * metricScale,
        marginRight: MARGIN_RIGHT * metricScale,
        marginTop: MARGIN_TOP * metricScale,
        outline: STAMP_OUTLINE * metricScale,
    };
}

/**
 * 非A4ページをA4サイズに中央配置する
 */
async function ensureA4Pages(pdfBytes) {
    const srcDoc = await PDFDocument.load(pdfBytes);
    const srcPages = srcDoc.getPages();

    const needsResize = srcPages.some(page => {
        const { width, height } = page.getSize();
        return !isA4PageSize(width, height);
    });
    if (!needsResize) return pdfBytes;

    const newDoc = await PDFDocument.create();

    for (let i = 0; i < srcPages.length; i++) {
        const srcPage = srcPages[i];
        const { width, height } = srcPage.getSize();
        if (!isA4PageSize(width, height)) {
            const placement = getA4Placement(width, height);
            const newPage = newDoc.addPage([placement.pageW, placement.pageH]);
            if (pageHasContents(srcPage)) {
                const embedded = await newDoc.embedPage(srcPage);
                newPage.drawPage(embedded, placement);
            }
        } else {
            const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
            newDoc.addPage(copiedPage);
        }
    }

    return await newDoc.save();
}

/**
 * 画像ファイルかどうか判定
 */
function isImageFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * 画像ファイルをA4サイズのPDFに変換する
 * 画像はアスペクト比を維持しつつA4に収まるようにリサイズし中央配置する
 */
async function convertImageToPdf(imagePath) {
    const imageBytes = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();

    const pdfDoc = await PDFDocument.create();
    let image;
    if (ext === '.png') {
        image = await pdfDoc.embedPng(imageBytes);
    } else {
        image = await pdfDoc.embedJpg(imageBytes);
    }

    const { width: imgW, height: imgH } = image;

    // 画像の向きに応じてA4の縦横を決定
    const [pageW, pageH] = getA4PageSizeForPage(imgW, imgH);

    const page = pdfDoc.addPage([pageW, pageH]);

    // 余白を除いた描画領域にフィットさせる
    const maxW = pageW - IMAGE_MARGIN * 2;
    const maxH = pageH - IMAGE_MARGIN * 2;
    const scale = Math.min(maxW / imgW, maxH / imgH, 1); // 拡大はしない
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;

    page.drawImage(image, { x, y, width: drawW, height: drawH });

    return await pdfDoc.save();
}

/**
 * ファイル名から証拠番号を抽出（枝番・英字分類対応: 甲4-1, 乙A1の2 など）
 */
function extractEvidenceNumber(filename) {
    const normalizedName = path.basename(filename)
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[Ａ-Ｚａ-ｚ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[a-z]/g, char => char.toUpperCase());
    const match = normalizedName.match(/^([甲乙丙丁戊証疎][A-Z]?\d+(?:[\-ー－の]\d+)?)/);
    return match ? match[1].replace(/[ー－]/g, '-') : null;
}

/**
 * 自然順ソート用キー（枝番・英字分類対応）
 * @returns {[number, number, number]} [英字分類, 主番号, 枝番号]
 */
function naturalSortKey(filepath) {
    const evidenceNumber = extractEvidenceNumber(filepath);
    const match = evidenceNumber && evidenceNumber.match(/[甲乙丙丁戊証疎]([A-Z]?)(\d+)(?:[\-の](\d+))?/);
    if (!match) return [0, 0, 0];
    const letterRank = match[1] ? match[1].charCodeAt(0) - 64 : 0;
    return [letterRank, parseInt(match[2], 10), match[3] ? parseInt(match[3], 10) : 0];
}

/**
 * PDFに証拠番号スタンプを追加し、スタンプ済みPDFDocumentを返す
 */
type StampOptions = {
    allPages?: boolean;
    fontSize?: number;
};

async function stampPdf(inputPath, outputPath, evidenceNumber, font, options: StampOptions = {}) {
    const { allPages = false, fontSize = DEFAULT_FONT_SIZE } = options;
    const stampText = `${evidenceNumber}${STAMP_SUFFIX}`;

    const rawPdfBytes = fs.readFileSync(inputPath);
    const normalizedPdfBytes = await ensureA4Pages(rawPdfBytes);
    const pdfDoc = await PDFDocument.load(normalizedPdfBytes);

    // フォント登録
    pdfDoc.registerFontkit(fontkit);
    const embeddedFont = await pdfDoc.embedFont(font, { subset: false });

    const pages = pdfDoc.getPages();
    const pagesToStamp = allPages ? pages : [pages[0]];

    for (const page of pagesToStamp) {
        const { width, height } = page.getSize();
        const stampMetrics = getStampMetricsForA4Print(width, height, fontSize);
        const textWidth = embeddedFont.widthOfTextAtSize(stampText, stampMetrics.fontSize);

        const x = width - textWidth - stampMetrics.marginRight;
        const y = height - stampMetrics.marginTop - stampMetrics.fontSize;

        // 白縁取り（上下左右・斜めの8方向にオフセット描画）
        const outline = stampMetrics.outline;
        const offsets = [
            [-outline, 0], [outline, 0], [0, -outline], [0, outline],
            [-outline, -outline], [outline, -outline], [-outline, outline], [outline, outline],
        ];
        for (const [dx, dy] of offsets) {
            page.drawText(stampText, {
                x: x + dx,
                y: y + dy,
                size: stampMetrics.fontSize,
                font: embeddedFont,
                color: rgb(1, 1, 1),
            });
        }

        // 赤文字本体
        page.drawText(stampText, {
            x,
            y,
            size: stampMetrics.fontSize,
            font: embeddedFont,
            color: rgb(1, 0, 0),
        });
    }

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    return pdfBytes;
}

/**
 * 複数のスタンプ済みPDFを結合（両面印刷対応：奇数ページの文書の後に空白ページ挿入）
 */
async function mergeStampedPdfs(stampedPdfBytesList, outputPath, { insertBlankPages = true } = {}) {
    const mergedDoc = await PDFDocument.create();
    let totalPages = 0;
    let blankPages = 0;

    for (let i = 0; i < stampedPdfBytesList.length; i++) {
        const { bytes, evidenceNum } = stampedPdfBytesList[i];
        const srcDoc = await PDFDocument.load(bytes);
        const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());

        for (const page of copiedPages) {
            mergedDoc.addPage(page);
            totalPages++;
        }

        // 両面印刷対応: 奇数ページの場合、次の文書のために空白ページを挿入
        // （最後の文書には不要）
        if (insertBlankPages && copiedPages.length % 2 !== 0 && i < stampedPdfBytesList.length - 1) {
            // 最後のページと同じサイズの空白ページを追加
            const lastPage = copiedPages[copiedPages.length - 1];
            const { width, height } = lastPage.getSize();
            mergedDoc.addPage([width, height]);
            totalPages++;
            blankPages++;
        }
    }

    const mergedBytes = await mergedDoc.save();
    fs.writeFileSync(outputPath, mergedBytes);
    return { totalPages, blankPages };
}

/**
 * メイン処理
 */
async function main() {
    const args = process.argv.slice(2);

    // オプション解析
    const allPages = args.includes('--all-pages');
    const noBlankPages = args.includes('--no-blank-pages');
    let fontSize = DEFAULT_FONT_SIZE;
    const fontSizeIdx = args.indexOf('--font-size');
    if (fontSizeIdx !== -1 && args[fontSizeIdx + 1]) {
        fontSize = parseInt(args[fontSizeIdx + 1], 10);
    }

    // ファイルパスのみ抽出
    const filePaths = args.filter(a => !a.startsWith('--') && !(args[args.indexOf(a) - 1] === '--font-size'));

    if (filePaths.length === 0) {
        console.error('使い方: node stamp_evidence_number.js <PDF/画像ファイル...>');
        process.exit(1);
    }

    // フォント準備
    console.log('フォントを探しています...');
    const fontPath = findJapaneseFont();
    if (!fontPath) {
        console.error('エラー: 日本語フォントが見つかりません。');
        console.error('確認: ' + FONT_CANDIDATES.join(', '));
        process.exit(1);
    }
    console.log(`フォント: ${path.basename(fontPath)}`);

    const fontBytes = fs.readFileSync(fontPath);

    // 出力ディレクトリ（最初のファイルの親ディレクトリ基準）
    const firstDir = path.dirname(filePaths[0]);
    const outputDir = path.join(firstDir, 'stamped');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // ソート
    // 甲*.pdf に限定せず、乙・丙等も対象
    const sortedPaths = [...filePaths].sort((a, b) => {
        const [aLetter, aMain, aBranch] = naturalSortKey(a);
        const [bLetter, bMain, bBranch] = naturalSortKey(b);
        return aLetter - bLetter || aMain - bMain || aBranch - bBranch;
    });

    const stampMode = allPages ? '全ページ' : '1ページ目のみ';
    const blankMode = noBlankPages ? '空白ページなし' : '両面印刷対応';
    console.log(`対象: ${sortedPaths.length} ファイル`);
    console.log(`出力: ${outputDir}`);
    console.log(`モード: ${stampMode} / フォントサイズ: ${fontSize}pt / ${blankMode}`);
    console.log('─'.repeat(50));

    let okCount = 0;
    let errCount = 0;
    const stampedList = []; // 結合用にスタンプ済みPDFバイト列を保持

    // 並列処理に変更
    const tasks = sortedPaths.map(async (filePath) => {
        const filename = path.basename(filePath);
        const evidenceNum = extractEvidenceNumber(filename);

        if (!evidenceNum) {
            console.log(`  SKIP  ${filename} （証拠番号なし）`);
            return null;
        }

        // 画像ファイルの場合、PDFに変換してから処理
        let inputForStamp = filePath;
        let tempPdfPath: string | null = null;
        if (isImageFile(filePath)) {
            console.log(`  変換  ${filename} → PDF`);
            try {
                const pdfBytes = await convertImageToPdf(filePath);
                tempPdfPath = path.join(outputDir, path.basename(filename, path.extname(filename)) + '.pdf');
                fs.writeFileSync(tempPdfPath, pdfBytes);
                inputForStamp = tempPdfPath;
            } catch (err) {
                console.error(`  変換エラー ${filename}: ${err.message}`);
                return { success: false };
            }
        }

        const outputFilename = path.basename(filename, path.extname(filename)) + '.pdf';
        const outputPath = path.join(outputDir, outputFilename);
        try {
            const pdfBytes = await stampPdf(inputForStamp, outputPath, evidenceNum, fontBytes, { allPages, fontSize });
            // 画像→PDF変換の中間ファイルが出力先と異なる場合は削除
            if (tempPdfPath && tempPdfPath !== outputPath) {
                try { fs.unlinkSync(tempPdfPath); } catch (_) {}
            }
            console.log(`  完了  ${evidenceNum}${STAMP_SUFFIX} ← ${filename}`);
            return { success: true, bytes: pdfBytes, evidenceNum };
        } catch (err) {
            console.error(`  エラー ${filename}: ${err.message}`);
            return { success: false };
        }
    });

    // 全ての処理が終わるのを待つ
    const results = await Promise.all(tasks);

    // 結果を集計（Promise.allは順序を保持するのでソート順は維持される）
    for (const res of results) {
        if (!res) continue; // SKIP
        if (res.success) {
            stampedList.push({ bytes: res.bytes, evidenceNum: res.evidenceNum });
            okCount++;
        } else {
            errCount++;
        }
    }

    console.log('─'.repeat(50));
    console.log(`処理完了: ${okCount} 成功 / ${errCount} エラー`);

    // 結合PDF生成（2ファイル以上の場合）
    if (stampedList.length >= 2) {
        console.log('─'.repeat(50));
        const mergeMode = noBlankPages ? '結合PDF作成中（空白ページなし）...' : '結合PDF作成中（両面印刷対応）...';
        console.log(mergeMode);
        try {
            const mergedPath = path.join(outputDir, '_結合_号証一式.pdf');
            const { totalPages, blankPages } = await mergeStampedPdfs(stampedList, mergedPath, { insertBlankPages: !noBlankPages });
            console.log(`  完了  ${stampedList.length} 文書 → ${totalPages} ページ（空白ページ: ${blankPages}）`);
            console.log(`  出力: ${mergedPath}`);
        } catch (err) {
            console.error(`  結合エラー: ${err.message}`);
        }
    }

    if (okCount > 0) {
        console.log(`\n出力先: ${outputDir}`);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(`致命的エラー: ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    extractEvidenceNumber,
    naturalSortKey,
    isImageFile,
    findJapaneseFont,
    getA4PrintScaleForPage,
    getStampMetricsForA4Print,
    ensureA4Pages,
    stampPdf,
    mergeStampedPdfs,
};
