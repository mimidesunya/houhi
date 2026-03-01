/**
 * 証拠番号スタンプツール
 * PDFファイル名から証拠番号（甲XX）を抽出し、各ページの右上に赤文字でスタンプする。
 * 出力先: 入力ディレクトリ内の stamped/ フォルダ
 *
 * 使い方:
 *   node src/stamp_evidence_number.js <PDFファイルパス...>
 *
 * オプション:
 *   --all-pages   全ページにスタンプ（デフォルトは1ページ目のみ）
 *   --font-size N フォントサイズ指定（デフォルト: 20）
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

// ── 設定 ──────────────────────────────────────
const DEFAULT_FONT_SIZE = 20;
const MARGIN_RIGHT = 15;   // 右余白 (pt)
const MARGIN_TOP = 12;     // 上余白 (pt)
const STAMP_SUFFIX = '号証';
const A4_WIDTH = 595.28;   // A4 幅 (pt)
const A4_HEIGHT = 841.89;  // A4 高さ (pt)

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
 * A4未満のページをA4サイズに中央配置する
 * A4以上のページはそのまま保持
 */
async function ensureA4Pages(pdfBytes) {
    const srcDoc = await PDFDocument.load(pdfBytes);
    const srcPages = srcDoc.getPages();

    // リサイズが必要なページがあるか確認
    const needsResize = srcPages.some(page => {
        const { width, height } = page.getSize();
        const isLandscape = width > height;
        const [a4W, a4H] = isLandscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
        return width < a4W && height < a4H;
    });
    if (!needsResize) return pdfBytes;

    const newDoc = await PDFDocument.create();

    for (let i = 0; i < srcPages.length; i++) {
        const srcPage = srcPages[i];
        const { width, height } = srcPage.getSize();
        const isLandscape = width > height;
        const [a4W, a4H] = isLandscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];

        if (width < a4W && height < a4H) {
            // A4ページを作成し、元のページを中央に配置
            const newPage = newDoc.addPage([a4W, a4H]);
            const embedded = await newDoc.embedPage(srcPage);
            const x = (a4W - width) / 2;
            const y = (a4H - height) / 2;
            newPage.drawPage(embedded, { x, y });
        } else {
            // そのままコピー
            const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
            newDoc.addPage(copiedPage);
        }
    }

    return await newDoc.save();
}

/**
 * ファイル名から証拠番号を抽出（枝番対応: 甲4-1 など）
 */
function extractEvidenceNumber(filename) {
    const match = filename.match(/^([甲乙丙丁戊証疎]\d+(?:-\d+)?)/);
    return match ? match[1] : null;
}

/**
 * 自然順ソート用キー（枝番対応）
 * @returns {[number, number]} [主番号, 枝番号]
 */
function naturalSortKey(filepath) {
    const name = path.basename(filepath);
    const match = name.match(/[甲乙丙丁戊証疎](\d+)(?:-(\d+))?/);
    if (!match) return [0, 0];
    return [parseInt(match[1], 10), match[2] ? parseInt(match[2], 10) : 0];
}

/**
 * PDFに証拠番号スタンプを追加し、スタンプ済みPDFDocumentを返す
 */
async function stampPdf(inputPath, outputPath, evidenceNumber, font, options = {}) {
    const { allPages = false, fontSize = DEFAULT_FONT_SIZE } = options;
    const stampText = `${evidenceNumber}${STAMP_SUFFIX}`;

    const rawPdfBytes = fs.readFileSync(inputPath);
    // A4未満のページをA4に中央配置
    const existingPdfBytes = await ensureA4Pages(rawPdfBytes);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // フォント登録
    pdfDoc.registerFontkit(fontkit);
    const embeddedFont = await pdfDoc.embedFont(font, { subset: false });

    const pages = pdfDoc.getPages();
    const pagesToStamp = allPages ? pages : [pages[0]];

    for (const page of pagesToStamp) {
        const { width, height } = page.getSize();
        const textWidth = embeddedFont.widthOfTextAtSize(stampText, fontSize);

        const x = width - textWidth - MARGIN_RIGHT;
        const y = height - MARGIN_TOP - fontSize;

        // 白縁取り（上下左右・斜めの8方向にオフセット描画）
        const outline = 1.5;
        const offsets = [
            [-outline, 0], [outline, 0], [0, -outline], [0, outline],
            [-outline, -outline], [outline, -outline], [-outline, outline], [outline, outline],
        ];
        for (const [dx, dy] of offsets) {
            page.drawText(stampText, {
                x: x + dx,
                y: y + dy,
                size: fontSize,
                font: embeddedFont,
                color: rgb(1, 1, 1),
            });
        }

        // 赤文字本体
        page.drawText(stampText, {
            x,
            y,
            size: fontSize,
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
async function mergeStampedPdfs(stampedPdfBytesList, outputPath) {
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
        if (copiedPages.length % 2 !== 0 && i < stampedPdfBytesList.length - 1) {
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
    let fontSize = DEFAULT_FONT_SIZE;
    const fontSizeIdx = args.indexOf('--font-size');
    if (fontSizeIdx !== -1 && args[fontSizeIdx + 1]) {
        fontSize = parseInt(args[fontSizeIdx + 1], 10);
    }

    // ファイルパスのみ抽出
    const filePaths = args.filter(a => !a.startsWith('--') && !(args[args.indexOf(a) - 1] === '--font-size'));

    if (filePaths.length === 0) {
        console.error('使い方: node stamp_evidence_number.js <PDFファイル...>');
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
        const [aMain, aBranch] = naturalSortKey(a);
        const [bMain, bBranch] = naturalSortKey(b);
        return aMain !== bMain ? aMain - bMain : aBranch - bBranch;
    });

    const stampMode = allPages ? '全ページ' : '1ページ目のみ';
    console.log(`対象: ${sortedPaths.length} ファイル`);
    console.log(`出力: ${outputDir}`);
    console.log(`モード: ${stampMode} / フォントサイズ: ${fontSize}pt`);
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

        const outputPath = path.join(outputDir, filename);
        try {
            const pdfBytes = await stampPdf(filePath, outputPath, evidenceNum, fontBytes, { allPages, fontSize });
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
        console.log('結合PDF作成中（両面印刷対応）...');
        try {
            const mergedPath = path.join(outputDir, '_結合_号証一式.pdf');
            const { totalPages, blankPages } = await mergeStampedPdfs(stampedList, mergedPath);
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

main().catch(err => {
    console.error(`致命的エラー: ${err.message}`);
    process.exit(1);
});
