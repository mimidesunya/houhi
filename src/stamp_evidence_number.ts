/**
 * 証拠番号スタンプツール
 * PDF／画像ファイル名から証拠番号・資料番号（例: 甲1_契約書.pdf、乙A1_写真.pdf、資料1_ウェブサイト.pdf、参考資料1_通知書.pdf）を抽出し、各ページの右上に赤文字でスタンプする。
 * 出力先: 入力ディレクトリ内の stamped/ フォルダ
 *
 * 入力:
 * - PDF または画像ファイル（JPG, PNG）を 1 件以上指定できます。
 * - 画像ファイルは自動的にA4サイズのPDFに変換してから処理します。
 * - ファイル名先頭の `甲1_契約書.pdf`, `乙2_メール.pdf`, `甲3-1_領収書.pdf`, `乙A1の2_写真.pdf` などから証拠番号を抽出します。
 * - 苦情申出の意見書などに付ける資料は `資料1_〇〇.pdf`, `資料2-1_〇〇.pdf` の形式に対応します。
 *   資料には「号証」を付けず、`資料1` とだけスタンプします。
 * - 行政不服審査の審査会（情報公開・個人情報保護審査会など）へ意見書と出す参考資料は
 *   `参考資料1_〇〇.pdf`, `参考資料2-1_〇〇.pdf` の形式に対応します。資料と同じく「号証」を付けず、`参考資料1` とスタンプします。
 *
 * 出力:
 * - 最初の入力ファイルの親フォルダに `stamped/` を作成し、その中へ個別PDFを出力します。
 * - 成功ファイルが 2 件以上ある場合は `_結合_号証一式.pdf`（資料のみなら `_結合_資料一式.pdf`、参考資料のみなら
 *   `_結合_参考資料一式.pdf`、種別が混ざれば `_結合_一式.pdf`）も作成します。名前は `--combined-name` で変えられます。
 *
 * オプション:
 * - `--all-pages`: 全ページにスタンプします（既定は1ページ目のみ）。
 * - `--font-size N`: A4印刷換算のフォントサイズを指定します。
 * - `--mints`: 民事裁判書類電子提出システム（mints）向け。表記を「甲001」「甲002-1」の形式（「号証」なし、主番号3桁）にし、
 *   出力先を `mints/`、ファイル名の先頭を同じ形式に改め、結合PDFは作らない（mints は1証拠1ファイル、A4/A3のみ）。黒帯も付けない。
 * - `--no-tab`: 境目の黒帯を付けない。
 * - `--tab-steps N`: 黒帯を上下にずらす段数（既定は4）。
 * - `--prefix 文字列`: 番号のすぐ左に、番号の半分の大きさの字で前置きを続けて刷ります（下端をそろえて1行に）。
 *   審査会は参考資料に「令和○年(○○) 諮問第○号に対する参考資料」などと明記するよう求めているので、
 *   `--prefix "令和8年（行情）諮問第1373号に対する"` とすると、頁の右上に
 *   「令和8年（行情）諮問第1373号に対する参考資料1」と1行で入ります（前置きだけ小さい字）。
 *   番号の位置は変わらず、前置きの分だけ左へ延びます（既定の大きさで A4 の幅の右半分ほど）。
 *   前置きと番号を合わせて頁の幅の6割を超えるときは、前置きの字を小さくして収めます。
 *   付けなければ今までと同じく番号だけを刷ります。
 * - `--combined-name 名前`: 結合PDFのファイル名（`stamped/` の中）。`.pdf` がなければ付けます。
 *   例: `--combined-name "令和8年（行情）諮問第1373号に対する参考資料.pdf"`。
 *
 * 境目の黒帯:
 * - 番号の右から用紙の右端まで、黒の斜めの縞の帯を付けます。まとめて印刷して重ねたとき、右端を見れば号証の境目が分かります。
 *   縞にしてあるのは、スキャンの黒い縁や墨消しと見分けやすくするためです。
 * - 番号と帯は、号証番号の順に帯の高さ1つ分ずつ下へずらし、4段（`--tab-steps`）で上に戻ります。隣り合う号証は必ず別の高さになります。
 * - 段は、そのとき一緒に処理した号証の中での順番で決まります。一部の号証だけを処理し直すと段が変わるので、全部をまとめて処理し直してください。
 * - 用紙の右端の数mmは、プリンタの印刷できない余白で白く残ります。
 * - 横長の頁は、頁の上が左（綴じ側）に来るよう回して縦の頁にします（文書の全頁をそろえる）。番号と帯は縦長の頁と同じ場所に刷られます。
 *   画面では横長の頁が横倒しに見えます。`--no-tab` のときは回しません。
 * - 元の頁の回転（/Rotate）は保ち、番号は表示したときの右上に正立で刷ります。
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
 *   --mints       mints 提出用（「甲001」形式・mints/ へ出力・結合なし・黒帯なし）
 *   --no-tab      境目の黒帯を付けない
 *   --tab-steps N 黒帯を上下にずらす段数（デフォルト: 4）
 *   --prefix 文字列        番号の左に小さい字で前置きを続けて刷る
 *   --combined-name 名前   結合PDFのファイル名
 *
 * 審査会へ出す参考資料の例:
 *   node dist/src/stamp_evidence_number.js --no-tab --no-blank-pages \
 *     --prefix "令和8年（行情）諮問第1373号に対する" \
 *     --combined-name "令和8年（行情）諮問第1373号に対する参考資料.pdf" \
 *     参考資料1_〇〇.pdf 参考資料2_〇〇.pdf 参考資料3_〇〇.pdf
 */
const fs = require('fs');
const path = require('path');
const {
    PDFDocument, rgb, degrees,
    pushGraphicsState, popGraphicsState, rectangle, clip, endPath, moveTo, lineTo, closePath, fill, setFillingRgbColor,
} = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

// ── 設定 ──────────────────────────────────────
const DEFAULT_FONT_SIZE = 20;
const MARGIN_RIGHT = 15;   // 右余白 (pt)
const MARGIN_TOP = 12;     // 上余白 (pt)
const STAMP_OUTLINE = 1.5; // 白縁取り幅 (pt)
const STAMP_SUFFIX = '号証';
const TAB_LENGTH = 42;     // 境目の黒帯: 用紙の右端から帯の左端まで (pt)
const TAB_GAP = 4;         // 番号と黒帯の間 (pt)
const DEFAULT_TAB_STEPS = 4; // 黒帯を上下にずらす段数
const TAB_DESCENT = 0.12;  // 黒帯の下端を番号の文字の下端に合わせる (フォントサイズ比)
const TAB_STRIPE_PERIOD = 0.4; // 黒帯の斜めの縞の周期 (フォントサイズ比。黒はその半分)
const LANDSCAPE_TURN = 270; // 横長の頁を縦にするときの回転（/Rotate に足す。頁の上が左＝綴じ側に来る）
const PREFIX_SIZE_RATIO = 0.5; // 前置き（--prefix）の字の大きさ (番号のフォントサイズ比)
const PREFIX_MAX_WIDTH_RATIO = 0.6; // 前置きと番号を合わせた幅の上限 (頁の幅比。超えるときは前置きの字を小さくする)
const PREFIX_MIN_WIDTH_RATIO = 0.2; // 番号が長くても前置きに残す幅 (頁の幅比)
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

/**
 * 頁の /Rotate（時計回り）を 0・90・180・270 のどれかで返す
 */
function getPageRotation(page) {
    const angle = page.getRotation().angle || 0;
    return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

/**
 * /Rotate を反映した、表示したときの幅と高さ
 */
function getDisplaySize(page) {
    const { width, height } = page.getSize();
    return getPageRotation(page) % 180 === 0 ? { width, height } : { width: height, height: width };
}

/**
 * 表示したときの座標（左下が原点）を、/Rotate を持つ頁の描画座標に移す。
 * width・height は /Rotate を反映する前の頁の大きさ。
 */
function toPageSpace(rotation, width, height, u, v) {
    switch (rotation) {
        case 90: return { x: width - v, y: u };
        case 180: return { x: width - u, y: height - v };
        case 270: return { x: v, y: height - u };
        default: return { x: u, y: v };
    }
}

/**
 * 横長に表示される頁を、上が左に来るよう回して縦に表示させる。番号と黒帯を縦長の頁と同じ場所に刷るため。
 */
function turnLandscapePagesToPortrait(pages) {
    let turned = 0;
    for (const page of pages) {
        const { width, height } = getDisplaySize(page);
        if (width > height) {
            page.setRotation(degrees((getPageRotation(page) + LANDSCAPE_TURN) % 360));
            turned++;
        }
    }
    return turned;
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
        tabLength: TAB_LENGTH * metricScale,
        tabGap: TAB_GAP * metricScale,
        prefixFontSize: fontSize * PREFIX_SIZE_RATIO * metricScale,
    };
}

type TabOptions = {
    tab?: boolean;
    tabIndex?: number;
    tabSteps?: number;
};

type LayoutOptions = TabOptions & {
    /** 前置きの幅（metrics.prefixFontSize で測った値）。0 なら前置きなし */
    prefixWidth?: number;
};

/**
 * 番号の位置と境目の黒帯の矩形を返す。
 * 黒帯は番号の右から用紙の右端まで、高さはフォントサイズと同じ。tabIndex を tabSteps で割った余りの段だけ、番号ごと帯の高さ分ずつ下げる。
 * 前置き（prefixWidth > 0）があれば、番号のすぐ左に、下端（ベースライン）をそろえて1行に置く。番号と帯の位置は変えない。
 * 前置きと番号を合わせた幅が頁の幅の PREFIX_MAX_WIDTH_RATIO を超えるときは、収まるまで前置きの字を小さくする。
 */
function getStampLayout(pageWidth, pageHeight, textWidth, metrics, options: LayoutOptions = {}) {
    const { tab = false, tabIndex = 0, tabSteps = DEFAULT_TAB_STEPS, prefixWidth = 0 } = options;
    const withPrefix = (layout) => {
        if (!(prefixWidth > 0)) return { ...layout, prefix: null };
        const maxWidth = Math.max(pageWidth * PREFIX_MAX_WIDTH_RATIO - textWidth, pageWidth * PREFIX_MIN_WIDTH_RATIO);
        const shrink = prefixWidth > maxWidth ? maxWidth / prefixWidth : 1;
        const width = prefixWidth * shrink;
        return {
            ...layout,
            prefix: {
                x: layout.textX - width,
                y: layout.textY,
                fontSize: metrics.prefixFontSize * shrink,
                width,
            },
        };
    };
    if (!tab) {
        return withPrefix({
            textX: pageWidth - textWidth - metrics.marginRight,
            textY: pageHeight - metrics.marginTop - metrics.fontSize,
            tabRect: null,
        });
    }
    const steps = Math.max(1, Math.floor(tabSteps));
    const step = ((Math.floor(tabIndex) % steps) + steps) % steps;
    const textY = pageHeight - metrics.marginTop - metrics.fontSize - step * metrics.fontSize;
    const tabX = pageWidth - metrics.tabLength;
    return withPrefix({
        textX: tabX - metrics.tabGap - textWidth,
        textY,
        tabRect: {
            x: tabX,
            y: textY - metrics.fontSize * TAB_DESCENT,
            width: pageWidth - tabX,
            height: metrics.fontSize,
        },
    });
}

/**
 * 帯を塗る斜めの縞（右上がり）を、表示したときの座標の四角形の並びで返す。
 * 縞は帯からはみ出すので、帯の矩形で切り抜いて塗る。period は縞の周期で、黒はその半分。
 */
function getTabStripes(rect, period) {
    const black = period / 2;
    const { x, y, width, height } = rect;
    const stripes = [];
    for (let left = x - height - period; left < x + width + period; left += period) {
        stripes.push([
            [left, y],
            [left + black, y],
            [left + black + height, y + height],
            [left + height, y + height],
        ]);
    }
    return stripes;
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
            // embedPage は /Rotate を持ち込まないので、元の頁の表示の向きを付け直す
            newPage.setRotation(degrees(getPageRotation(srcPage)));
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
 * ファイル名から証拠番号・資料番号を抽出
 * （枝番・英字分類対応: 甲4-1, 乙A1の2, 資料1, 資料2-1, 参考資料1, 参考資料2-1 など）
 */
function extractEvidenceNumber(filename) {
    const normalizedName = path.basename(filename)
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[Ａ-Ｚａ-ｚ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[a-z]/g, char => char.toUpperCase());
    const shiryoMatch = normalizedName.match(/^((?:参考)?資料\d+(?:[\-ー－の]\d+)?)/);
    if (shiryoMatch) return shiryoMatch[1].replace(/[ー－]/g, '-');
    const match = normalizedName.match(/^([甲乙丙丁戊証疎][A-Z]?\d+(?:[\-ー－の]\d+)?)/);
    return match ? match[1].replace(/[ー－]/g, '-') : null;
}

/**
 * 番号の種別を返す。「参考資料1」は '参考資料'、「資料1」は '資料'、それ以外（甲1 など）は '号証'。
 * 結合PDFの名前（`_結合_参考資料一式.pdf` など）と並べ替えの順（号証・資料・参考資料）に使う。
 */
function getMaterialKind(evidenceNumber) {
    const text = String(evidenceNumber || '');
    if (/^参考資料/.test(text)) return '参考資料';
    if (/^資料/.test(text)) return '資料';
    return '号証';
}

/**
 * 号証か資料（参考資料を含む）かを判定する
 */
function isShiryo(evidenceNumber) {
    return getMaterialKind(evidenceNumber) !== '号証';
}

/**
 * スタンプに刷る文字列。号証には「号証」を付け、資料・参考資料はそのまま用いる。
 */
function buildStampText(evidenceNumber, mints = false) {
    if (mints) return toMintsNumber(evidenceNumber);
    return isShiryo(evidenceNumber) ? evidenceNumber : `${evidenceNumber}${STAMP_SUFFIX}`;
}

/**
 * mints の号証表記に変換する。「甲1」→「甲001」、「甲2-1」→「甲002-1」、「乙A12」→「乙A012」。
 * 枝番と資料はそのまま。裁判所「証拠説明書の記載要領・記載例」（令和8年3月27日）の記載例に合わせる。
 */
function toMintsNumber(evidenceNumber) {
    const m = String(evidenceNumber).match(/^([甲乙丙丁戊証疎][A-Z]?)(\d+)((?:-\d+)?)$/);
    if (!m) return String(evidenceNumber);
    return `${m[1]}${m[2].padStart(3, '0')}${m[3]}`;
}

/**
 * 自然順ソート用キー（枝番・英字分類・資料・参考資料対応）
 * @returns {[number, number, number, number]} [種別（号証0・資料1・参考資料2）, 英字分類, 主番号, 枝番号]
 */
function naturalSortKey(filepath) {
    const evidenceNumber = extractEvidenceNumber(filepath);
    const kind = getMaterialKind(evidenceNumber);
    if (kind !== '号証') {
        const kindRank = kind === '資料' ? 1 : 2;
        const shiryo = evidenceNumber.match(/資料(\d+)(?:[\-の](\d+))?/);
        if (!shiryo) return [kindRank, 0, 0, 0];
        return [kindRank, 0, parseInt(shiryo[1], 10), shiryo[2] ? parseInt(shiryo[2], 10) : 0];
    }
    const match = evidenceNumber && evidenceNumber.match(/[甲乙丙丁戊証疎]([A-Z]?)(\d+)(?:[\-の](\d+))?/);
    if (!match) return [0, 0, 0, 0];
    const letterRank = match[1] ? match[1].charCodeAt(0) - 64 : 0;
    return [0, letterRank, parseInt(match[2], 10), match[3] ? parseInt(match[3], 10) : 0];
}

/**
 * 個別に出力するPDFのファイル名。拡張子を .pdf にし、mints ではファイル名の先頭の号証を mints 表記に置き換える。
 */
function buildOutputFilename(filename, evidenceNumber, mints = false) {
    const baseName = path.basename(filename, path.extname(filename)) + '.pdf';
    if (!mints) return baseName;
    // ファイル名の先頭の号証を mints 表記に置き換える（「甲01_…」「甲1_…」→「甲001_…」）
    return baseName.replace(/^[甲乙丙丁戊証疎][A-Za-zＡ-Ｚａ-ｚ]?[0-9０-９]+(?:[\-ー－の][0-9０-９]+)?/, toMintsNumber(evidenceNumber));
}

/**
 * `--combined-name` の値を、出力フォルダの中のファイル名として整える。空なら null。
 * フォルダを含む名前や Windows で使えない文字はエラーにする。`.pdf` がなければ付ける。
 */
function normalizeCombinedName(name) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return null;
    if (/[\\/]/.test(trimmed)) {
        throw new Error(`--combined-name にはフォルダを含めず、ファイル名だけを指定してください: ${trimmed}`);
    }
    if (/[<>:"|?*\u0000-\u001f]/.test(trimmed) || /^\.+$/.test(trimmed)) {
        throw new Error(`--combined-name に使えない文字があります: ${trimmed}`);
    }
    return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
}

/**
 * 結合PDFのファイル名。指定（--combined-name）があればそれを、なければ番号の種別から決める
 * （号証だけなら `_結合_号証一式.pdf`、資料だけなら `_結合_資料一式.pdf`、参考資料だけなら `_結合_参考資料一式.pdf`、混在は `_結合_一式.pdf`）。
 */
function buildCombinedName(evidenceNumbers, combinedName = null) {
    const specified = normalizeCombinedName(combinedName);
    if (specified) return specified;
    const kinds = new Set(evidenceNumbers.map(getMaterialKind));
    return kinds.size === 1 ? `_結合_${[...kinds][0]}一式.pdf` : '_結合_一式.pdf';
}

/**
 * 白で縁取った赤い文字を刷る（上下左右・斜めの8方向に白をずらして描いてから、赤を重ねる）
 */
function drawOutlinedText(page, text, { x, y, size, outline, font, rotate }) {
    const offsets = [
        [-outline, 0], [outline, 0], [0, -outline], [0, outline],
        [-outline, -outline], [outline, -outline], [-outline, outline], [outline, outline],
    ];
    for (const [dx, dy] of offsets) {
        page.drawText(text, { x: x + dx, y: y + dy, size, font, color: rgb(1, 1, 1), rotate });
    }
    page.drawText(text, { x, y, size, font, color: rgb(1, 0, 0), rotate });
}

/**
 * PDFに証拠番号スタンプを追加し、スタンプ済みPDFDocumentを返す
 */
type StampOptions = TabOptions & {
    allPages?: boolean;
    fontSize?: number;
    mints?: boolean;
    /** 番号の左に小さい字で続けて刷る前置き（例: 「令和8年（行情）諮問第1373号に対する」）。空なら刷らない */
    prefix?: string;
};

async function stampPdf(inputPath, outputPath, evidenceNumber, font, options: StampOptions = {}) {
    const { allPages = false, fontSize = DEFAULT_FONT_SIZE, mints = false, tab = false, tabIndex = 0, tabSteps = DEFAULT_TAB_STEPS } = options;
    const prefixText = String(options.prefix ?? '').trim();
    const stampText = buildStampText(evidenceNumber, mints);

    const rawPdfBytes = fs.readFileSync(inputPath);
    const normalizedPdfBytes = await ensureA4Pages(rawPdfBytes);
    const pdfDoc = await PDFDocument.load(normalizedPdfBytes);

    // フォント登録
    pdfDoc.registerFontkit(fontkit);
    // subset: false だとフォント全体（数MB）が各ファイルに埋め込まれ、証拠1点あたり数MB増える。
    // スタンプ文字は号証番号だけなので、サブセット埋め込みで足りる。
    const embeddedFont = await pdfDoc.embedFont(font, { subset: true });

    const pages = pdfDoc.getPages();
    const pagesToStamp = allPages ? pages : [pages[0]];
    const withTab = tab && !mints;
    if (withTab) {
        // 横長の頁は文書の全頁をそろえて縦にする（1頁目だけ回すと、2頁目以降をプリンタが逆向きに回すことがある）
        turnLandscapePagesToPortrait(pages);
    }

    for (const page of pagesToStamp) {
        // 位置は表示したときの向きで決め、/Rotate に合わせて頁の座標へ移す
        const rotation = getPageRotation(page);
        const { width: pageW, height: pageH } = page.getSize();
        const { width, height } = getDisplaySize(page);
        const stampMetrics = getStampMetricsForA4Print(width, height, fontSize);
        const textWidth = embeddedFont.widthOfTextAtSize(stampText, stampMetrics.fontSize);
        const prefixWidth = prefixText ? embeddedFont.widthOfTextAtSize(prefixText, stampMetrics.prefixFontSize) : 0;

        const { textX, textY, tabRect, prefix } = getStampLayout(width, height, textWidth, stampMetrics, { tab: withTab, tabIndex, tabSteps, prefixWidth });
        if (tabRect) {
            // 帯の矩形で切り抜き、白で下塗りして（灰色のスキャンの上でも縞が見えるように）、斜めの黒い縞を塗る
            const a = toPageSpace(rotation, pageW, pageH, tabRect.x, tabRect.y);
            const b = toPageSpace(rotation, pageW, pageH, tabRect.x + tabRect.width, tabRect.y + tabRect.height);
            const box = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)];
            const ops = [
                pushGraphicsState(),
                rectangle(box[0], box[1], box[2], box[3]),
                clip(),
                endPath(),
                setFillingRgbColor(1, 1, 1),
                rectangle(box[0], box[1], box[2], box[3]),
                fill(),
                setFillingRgbColor(0, 0, 0),
            ];
            for (const stripe of getTabStripes(tabRect, stampMetrics.fontSize * TAB_STRIPE_PERIOD)) {
                const [first, ...rest] = stripe.map(([u, v]) => toPageSpace(rotation, pageW, pageH, u, v));
                ops.push(moveTo(first.x, first.y), ...rest.map(point => lineTo(point.x, point.y)), closePath(), fill());
            }
            ops.push(popGraphicsState());
            page.pushOperators(...ops);
        }
        const { x, y } = toPageSpace(rotation, pageW, pageH, textX, textY);
        const rotate = degrees(rotation);

        if (prefix) {
            // 前置きは番号の左に、字の大きさに比例した細い縁取りで刷る
            const at = toPageSpace(rotation, pageW, pageH, prefix.x, prefix.y);
            drawOutlinedText(page, prefixText, {
                x: at.x,
                y: at.y,
                size: prefix.fontSize,
                outline: stampMetrics.outline * prefix.fontSize / stampMetrics.fontSize,
                font: embeddedFont,
                rotate,
            });
        }

        // 白縁取りの赤文字
        drawOutlinedText(page, stampText, {
            x,
            y,
            size: stampMetrics.fontSize,
            outline: stampMetrics.outline,
            font: embeddedFont,
            rotate,
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
            mergedDoc.addPage([width, height]).setRotation(degrees(getPageRotation(lastPage)));
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
    const mints = args.includes('--mints');
    const tab = !mints && !args.includes('--no-tab');
    let fontSize = DEFAULT_FONT_SIZE;
    const fontSizeIdx = args.indexOf('--font-size');
    if (fontSizeIdx !== -1 && args[fontSizeIdx + 1]) {
        fontSize = parseInt(args[fontSizeIdx + 1], 10);
    }
    let tabSteps = DEFAULT_TAB_STEPS;
    const tabStepsIdx = args.indexOf('--tab-steps');
    if (tabStepsIdx !== -1 && args[tabStepsIdx + 1]) {
        tabSteps = Math.max(1, parseInt(args[tabStepsIdx + 1], 10) || DEFAULT_TAB_STEPS);
    }
    const optionValue = (name) => {
        const idx = args.indexOf(name);
        return idx !== -1 ? (args[idx + 1] ?? '') : '';
    };
    const prefix = optionValue('--prefix').trim();
    let combinedName = null;
    try {
        combinedName = normalizeCombinedName(optionValue('--combined-name'));
    } catch (err) {
        console.error(`エラー: ${err.message}`);
        process.exit(1);
    }

    // ファイルパスのみ抽出（値を取るオプションの次の引数は除く）
    const valueOptions = ['--font-size', '--tab-steps', '--prefix', '--combined-name'];
    const filePaths = args.filter((a, i) => !a.startsWith('--') && !valueOptions.includes(args[i - 1]));

    if (filePaths.length === 0) {
        console.error('使い方: node stamp_evidence_number.js <PDF/画像ファイル...>');
        process.exit(1);
    }

    // 結合PDFの名前が個別のPDFの名前と同じだと、個別のPDFを上書きしてしまう
    if (combinedName && !mints) {
        const clash = filePaths.find(filePath => {
            const evidenceNum = extractEvidenceNumber(path.basename(filePath));
            return evidenceNum && buildOutputFilename(path.basename(filePath), evidenceNum).toLowerCase() === combinedName.toLowerCase();
        });
        if (clash) {
            console.error(`エラー: --combined-name の「${combinedName}」が、個別に出力するPDFの名前と同じです（${path.basename(clash)}）。`);
            process.exit(1);
        }
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
    const outputDir = path.join(firstDir, mints ? 'mints' : 'stamped');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // ソート
    // 甲*.pdf に限定せず、乙・丙等も対象
    const sortedPaths = [...filePaths].sort((a, b) => {
        const [aKind, aLetter, aMain, aBranch] = naturalSortKey(a);
        const [bKind, bLetter, bMain, bBranch] = naturalSortKey(b);
        return aKind - bKind || aLetter - bLetter || aMain - bMain || aBranch - bBranch;
    });

    const stampMode = allPages ? '全ページ' : '1ページ目のみ';
    const blankMode = mints ? 'mints提出用（結合なし）' : (noBlankPages ? '空白ページなし' : '両面印刷対応');
    const tabMode = tab ? `境目の黒帯 ${tabSteps}段` : '黒帯なし';
    console.log(`対象: ${sortedPaths.length} ファイル`);
    console.log(`出力: ${outputDir}`);
    console.log(`モード: ${stampMode} / フォントサイズ: ${fontSize}pt / ${blankMode} / ${tabMode}`);
    if (prefix) {
        console.log(`前置き: 「${prefix}」（番号の左に小さい字で）`);
    }
    if (combinedName) {
        console.log(mints ? '注意: --mints では結合PDFを作らないので、--combined-name は使いません。' : `結合PDFの名前: ${combinedName}`);
    }

    // 黒帯の段は、番号のあるファイルの中での順番で決める（隣り合う号証は必ず別の段になる）
    const tabIndexOf = new Map<string, number>();
    sortedPaths
        .filter(filePath => extractEvidenceNumber(path.basename(filePath)))
        .forEach((filePath, index) => tabIndexOf.set(filePath, index));
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

        const outputFilename = buildOutputFilename(filename, evidenceNum, mints);
        const outputPath = path.join(outputDir, outputFilename);
        try {
            const pdfBytes = await stampPdf(inputForStamp, outputPath, evidenceNum, fontBytes, {
                allPages, fontSize, mints, tab, tabIndex: tabIndexOf.get(filePath) ?? 0, tabSteps, prefix,
            });
            // 画像→PDF変換の中間ファイルが出力先と異なる場合は削除
            if (tempPdfPath && tempPdfPath !== outputPath) {
                try { fs.unlinkSync(tempPdfPath); } catch (_) {}
            }
            console.log(`  完了  ${prefix}${buildStampText(evidenceNum, mints)} ← ${filename}`);
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
    if (!mints && combinedName && stampedList.length < 2) {
        console.log(`注意: 結合PDFは2件以上のときだけ作るので、「${combinedName}」は作りませんでした。`);
    }
    if (!mints && stampedList.length >= 2) {
        console.log('─'.repeat(50));
        const mergeMode = noBlankPages ? '結合PDF作成中（空白ページなし）...' : '結合PDF作成中（両面印刷対応）...';
        console.log(mergeMode);
        try {
            const mergedName = buildCombinedName(stampedList.map(item => item.evidenceNum), combinedName);
            const mergedPath = path.join(outputDir, mergedName);
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
    getMaterialKind,
    isShiryo,
    buildStampText,
    naturalSortKey,
    buildOutputFilename,
    normalizeCombinedName,
    buildCombinedName,
    isImageFile,
    findJapaneseFont,
    getA4PrintScaleForPage,
    getStampMetricsForA4Print,
    getStampLayout,
    getTabStripes,
    getPageRotation,
    getDisplaySize,
    toPageSpace,
    turnLandscapePagesToPortrait,
    ensureA4Pages,
    stampPdf,
    mergeStampedPdfs,
};
