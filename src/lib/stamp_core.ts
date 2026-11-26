/**
 * 号証スタンプの共通部分（デスクトップの src/stamp_evidence_number.ts と Web の src/web/stamp.ts で使う）。
 *
 * fs・path を使わず、pdf-lib だけに頼るので、ブラウザでも Node でも動く。
 * Web 版では scripts/build_web.js が `pdf-lib` を `window.PDFLib` に差し替える。
 *
 * 文字の刷り方だけは環境で違うので、`stampPdfBytes` に「文字を刷る道具」（StampTextPainter）を渡す。
 * デスクトップは日本語フォントを埋め込んで文字で刷り、Web はブラウザのフォントで描いた PNG を貼る。
 */
import {
    PDFDocument, rgb, degrees,
    pushGraphicsState, popGraphicsState, rectangle, clip, endPath, moveTo, lineTo, closePath, fill, setFillingRgbColor,
} from 'pdf-lib';

// ── 設定 ──────────────────────────────────────
export const DEFAULT_FONT_SIZE = 20;
export const MARGIN_RIGHT = 15;   // 右余白 (pt)
export const MARGIN_TOP = 12;     // 上余白 (pt)
export const STAMP_OUTLINE = 1.5; // 白縁取り幅 (pt)
export const STAMP_SUFFIX = '号証';
export const TAB_LENGTH = 42;     // 境目の黒帯: 用紙の右端から帯の左端まで (pt)
export const TAB_GAP = 4;         // 番号と黒帯の間 (pt)
export const DEFAULT_TAB_STEPS = 4; // 黒帯を上下にずらす段数
export const TAB_DESCENT = 0.12;  // 黒帯の下端を番号の文字の下端に合わせる (フォントサイズ比)
export const TAB_STRIPE_PERIOD = 0.4; // 黒帯の斜めの縞の周期 (フォントサイズ比。黒はその半分)
export const LANDSCAPE_TURN = 270; // 横長の頁を縦にするときの回転（/Rotate に足す。頁の上が左＝綴じ側に来る）
export const A4_WIDTH = 595.28;   // A4 幅 (pt)
export const A4_HEIGHT = 841.89;  // A4 高さ (pt)
export const PAGE_SIZE_TOLERANCE = 0.5;
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
export const IMAGE_MARGIN = 36;   // 画像PDF変換時の余白 (pt)

const EVIDENCE_PREFIX_PATTERN = /^([甲乙丙丁戊証疎][A-Z]?\d+(?:[\-ー－の]\d+)?)/;
const SHIRYO_PREFIX_PATTERN = /^((?:参考)?資料\d+(?:[\-ー－の]\d+)?)/;

// ── ファイル名 ─────────────────────────────────

/**
 * パスの最後の部分（ファイル名）。Windows の `\` と `/` のどちらで区切ってあってもよい。
 */
export function getBasename(filePath: string) {
    const parts = String(filePath || '').split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || '';
}

/**
 * 拡張子（`.pdf` など、小文字）。拡張子がなければ空文字。
 */
export function getExtname(filePath: string) {
    const basename = getBasename(filePath);
    const dotIndex = basename.lastIndexOf('.');
    return dotIndex <= 0 ? '' : basename.slice(dotIndex).toLowerCase();
}

/**
 * 拡張子を除いたファイル名
 */
export function stripExtname(filePath: string) {
    const basename = getBasename(filePath);
    const dotIndex = basename.lastIndexOf('.');
    return dotIndex <= 0 ? basename : basename.slice(0, dotIndex);
}

/**
 * 画像ファイル（JPG・PNG）かどうか
 */
export function isImageFileName(filePath: string) {
    return IMAGE_EXTENSIONS.includes(getExtname(filePath));
}

/**
 * ファイル名から証拠番号・資料番号を抽出
 * （枝番・英字分類対応: 甲4-1, 乙A1の2, 資料1, 資料2-1, 参考資料1, 参考資料2-1 など）
 */
export function extractEvidenceNumber(filename: string) {
    const normalizedName = getBasename(filename)
        .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[Ａ-Ｚａ-ｚ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
        .replace(/[a-z]/g, char => char.toUpperCase());
    const shiryoMatch = normalizedName.match(SHIRYO_PREFIX_PATTERN);
    if (shiryoMatch) return shiryoMatch[1].replace(/[ー－]/g, '-');
    const match = normalizedName.match(EVIDENCE_PREFIX_PATTERN);
    return match ? match[1].replace(/[ー－]/g, '-') : null;
}

/**
 * 番号の種別を返す。「参考資料1」は '参考資料'、「資料1」は '資料'、それ以外（甲1 など）は '号証'。
 * 結合PDFの名前（`_結合_参考資料一式.pdf` など）と並べ替えの順（号証・資料・参考資料）に使う。
 */
export function getMaterialKind(evidenceNumber: string | null) {
    const text = String(evidenceNumber || '');
    if (/^参考資料/.test(text)) return '参考資料';
    if (/^資料/.test(text)) return '資料';
    return '号証';
}

/**
 * 号証か資料（参考資料を含む）かを判定する
 */
export function isShiryo(evidenceNumber: string | null) {
    return getMaterialKind(evidenceNumber) !== '号証';
}

/**
 * mints の号証表記に変換する。「甲1」→「甲001」、「甲2-1」→「甲002-1」、「乙A12」→「乙A012」。
 * 枝番と資料はそのまま。裁判所「証拠説明書の記載要領・記載例」（令和8年3月27日）の記載例に合わせる。
 */
export function toMintsNumber(evidenceNumber: string) {
    const m = String(evidenceNumber).match(/^([甲乙丙丁戊証疎][A-Z]?)(\d+)((?:-\d+)?)$/);
    if (!m) return String(evidenceNumber);
    return `${m[1]}${m[2].padStart(3, '0')}${m[3]}`;
}

/**
 * スタンプに刷る文字列。号証には「号証」を付け、資料・参考資料はそのまま用いる。
 */
export function buildStampText(evidenceNumber: string, mints = false) {
    if (mints) return toMintsNumber(evidenceNumber);
    return isShiryo(evidenceNumber) ? evidenceNumber : `${evidenceNumber}${STAMP_SUFFIX}`;
}

export type SortKey = [number, number, number, number];

/**
 * 自然順ソート用キー（枝番・英字分類・資料・参考資料対応）
 * @returns [種別（号証0・資料1・参考資料2）, 英字分類, 主番号, 枝番号]
 */
export function naturalSortKey(filePath: string): SortKey {
    const evidenceNumber = extractEvidenceNumber(filePath);
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
 * naturalSortKey の比較（号証・資料・参考資料の順、その中は英字分類・主番号・枝番の順）
 */
export function compareSortKeys(a: SortKey, b: SortKey) {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
}

/**
 * 個別に出力するPDFのファイル名。拡張子を .pdf にし、mints ではファイル名の先頭の号証を mints 表記に置き換える。
 */
export function buildOutputFilename(filename: string, evidenceNumber: string, mints = false) {
    const baseName = `${stripExtname(filename)}.pdf`;
    if (!mints) return baseName;
    // ファイル名の先頭の号証を mints 表記に置き換える（「甲01_…」「甲1_…」→「甲001_…」）
    return baseName.replace(/^[甲乙丙丁戊証疎][A-Za-zＡ-Ｚａ-ｚ]?[0-9０-９]+(?:[\-ー－の][0-9０-９]+)?/, toMintsNumber(evidenceNumber));
}

/**
 * 結合PDFの名前の指定（`--combined-name`、Web の入力欄）を、出力フォルダの中のファイル名として整える。空なら null。
 * フォルダを含む名前や Windows で使えない文字はエラーにする。`.pdf` がなければ付ける。
 */
export function normalizeCombinedName(name: string | null | undefined) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return null;
    if (/[\\/]/.test(trimmed)) {
        throw new Error(`結合PDFの名前にはフォルダを含めず、ファイル名だけを指定してください: ${trimmed}`);
    }
    if (/[<>:"|?*\u0000-\u001f]/.test(trimmed) || /^\.+$/.test(trimmed)) {
        throw new Error(`結合PDFの名前に使えない文字があります: ${trimmed}`);
    }
    return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
}

/**
 * 結合PDFのファイル名。指定があればそれを、なければ番号の種別から決める
 * （号証だけなら `_結合_号証一式.pdf`、資料だけなら `_結合_資料一式.pdf`、参考資料だけなら `_結合_参考資料一式.pdf`、混在は `_結合_一式.pdf`）。
 */
export function buildCombinedName(evidenceNumbers: string[], combinedName: string | null = null) {
    const specified = normalizeCombinedName(combinedName);
    if (specified) return specified;
    const kinds = new Set(evidenceNumbers.map(getMaterialKind));
    return kinds.size === 1 ? `_結合_${[...kinds][0]}一式.pdf` : '_結合_一式.pdf';
}

// ── 頁の大きさと向き ───────────────────────────

/**
 * ページをA4へフィット印刷するときの倍率を返す
 */
export function getA4PrintScaleForPage(width: number, height: number) {
    const isLandscape = width > height;
    const [a4W, a4H] = isLandscape ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
    return Math.min(a4W / width, a4H / height);
}

export function getA4PageSizeForPage(width: number, height: number): [number, number] {
    return width > height ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
}

export function isA4PageSize(width: number, height: number) {
    const [a4W, a4H] = getA4PageSizeForPage(width, height);
    return Math.abs(width - a4W) <= PAGE_SIZE_TOLERANCE
        && Math.abs(height - a4H) <= PAGE_SIZE_TOLERANCE;
}

export function getA4Placement(width: number, height: number) {
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
export function getPageRotation(page: any) {
    const angle = page.getRotation().angle || 0;
    return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

/**
 * /Rotate を反映した、表示したときの幅と高さ
 */
export function getDisplaySize(page: any) {
    const { width, height } = page.getSize();
    return getPageRotation(page) % 180 === 0 ? { width, height } : { width: height, height: width };
}

/**
 * 表示したときの座標（左下が原点）を、/Rotate を持つ頁の描画座標に移す。
 * width・height は /Rotate を反映する前の頁の大きさ。
 */
export function toPageSpace(rotation: number, width: number, height: number, u: number, v: number) {
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
export function turnLandscapePagesToPortrait(pages: any[]) {
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

export function pageHasContents(page: any) {
    return Boolean(page?.node && typeof page.node.Contents === 'function' && page.node.Contents());
}

/**
 * 非A4ページをA4サイズに中央配置する。元の頁の表示の向き（/Rotate）は保つ。
 */
export async function ensureA4Pages(pdfBytes: Uint8Array) {
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
 * 画像（JPG・PNG）をA4サイズのPDFにする。
 * 画像はアスペクト比を維持しつつA4に収まるようにリサイズし中央配置する（拡大はしない）。
 */
export async function convertImageBytesToPdf(imageBytes: Uint8Array, isPng: boolean) {
    const pdfDoc = await PDFDocument.create();
    const image = isPng ? await pdfDoc.embedPng(imageBytes) : await pdfDoc.embedJpg(imageBytes);
    const { width: imgW, height: imgH } = image;

    // 画像の向きに応じてA4の縦横を決定
    const [pageW, pageH] = getA4PageSizeForPage(imgW, imgH);
    const page = pdfDoc.addPage([pageW, pageH]);

    // 余白を除いた描画領域にフィットさせる
    const maxW = pageW - IMAGE_MARGIN * 2;
    const maxH = pageH - IMAGE_MARGIN * 2;
    const scale = Math.min(maxW / imgW, maxH / imgH, 1);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    page.drawImage(image, { x: (pageW - drawW) / 2, y: (pageH - drawH) / 2, width: drawW, height: drawH });

    return await pdfDoc.save();
}

// ── スタンプの寸法と帯 ─────────────────────────

export type StampMetrics = {
    printScale: number;
    fontSize: number;
    marginRight: number;
    marginTop: number;
    outline: number;
    tabLength: number;
    tabGap: number;
};

/**
 * A4印刷時の見かけが一定になるよう、スタンプの描画寸法を補正する
 */
export function getStampMetricsForA4Print(pageWidth: number, pageHeight: number, fontSize = DEFAULT_FONT_SIZE): StampMetrics {
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
    };
}

export type TabOptions = {
    tab?: boolean;
    tabIndex?: number;
    tabSteps?: number;
};

export type TabRect = { x: number; y: number; width: number; height: number };

/**
 * 番号の位置と境目の黒帯の矩形を返す（表示したときの座標。textY は文字の基準線）。
 * 黒帯は番号の右から用紙の右端まで、高さはフォントサイズと同じ。tabIndex を tabSteps で割った余りの段だけ、番号ごと帯の高さ分ずつ下げる。
 */
export function getStampLayout(pageWidth: number, pageHeight: number, textWidth: number, metrics: StampMetrics, options: TabOptions = {}) {
    const { tab = false, tabIndex = 0, tabSteps = DEFAULT_TAB_STEPS } = options;
    if (!tab) {
        return {
            textX: pageWidth - textWidth - metrics.marginRight,
            textY: pageHeight - metrics.marginTop - metrics.fontSize,
            tabRect: null as TabRect | null,
        };
    }
    const steps = Math.max(1, Math.floor(tabSteps));
    const step = ((Math.floor(tabIndex) % steps) + steps) % steps;
    const textY = pageHeight - metrics.marginTop - metrics.fontSize - step * metrics.fontSize;
    const tabX = pageWidth - metrics.tabLength;
    return {
        textX: tabX - metrics.tabGap - textWidth,
        textY,
        tabRect: {
            x: tabX,
            y: textY - metrics.fontSize * TAB_DESCENT,
            width: pageWidth - tabX,
            height: metrics.fontSize,
        } as TabRect | null,
    };
}

/**
 * 帯を塗る斜めの縞（右上がり）を、表示したときの座標の四角形の並びで返す。
 * 縞は帯からはみ出すので、帯の矩形で切り抜いて塗る。period は縞の周期で、黒はその半分。
 */
export function getTabStripes(rect: TabRect, period: number) {
    const black = period / 2;
    const { x, y, width, height } = rect;
    const stripes: Array<Array<[number, number]>> = [];
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
 * 境目の帯を頁に塗る。帯の矩形で切り抜き、白で下塗りして（灰色のスキャンの上でも縞が見えるように）、斜めの黒い縞を塗る。
 * tabRect と period は表示したときの座標・寸法で、/Rotate に合わせて頁の座標へ移す。
 */
export function drawTabBand(page: any, tabRect: TabRect, period: number) {
    const rotation = getPageRotation(page);
    const { width: pageW, height: pageH } = page.getSize();
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
    for (const stripe of getTabStripes(tabRect, period)) {
        const [first, ...rest] = stripe.map(([u, v]) => toPageSpace(rotation, pageW, pageH, u, v));
        ops.push(moveTo(first.x, first.y), ...rest.map(point => lineTo(point.x, point.y)), closePath(), fill());
    }
    ops.push(popGraphicsState());
    page.pushOperators(...ops);
}

/**
 * 白で縁取った赤い文字を刷る（上下左右・斜めの8方向に白をずらして描いてから、赤を重ねる）
 */
export function drawOutlinedText(page: any, text: string, { x, y, size, outline, font, rotate }: { x: number; y: number; size: number; outline: number; font: any; rotate?: any }) {
    const offsets = [
        [-outline, 0], [outline, 0], [0, -outline], [0, outline],
        [-outline, -outline], [outline, -outline], [-outline, outline], [outline, outline],
    ];
    for (const [dx, dy] of offsets) {
        page.drawText(text, { x: x + dx, y: y + dy, size, font, color: rgb(1, 1, 1), rotate });
    }
    page.drawText(text, { x, y, size, font, color: rgb(1, 0, 0), rotate });
}

// ── スタンプ ──────────────────────────────────

/**
 * 番号の文字を刷る道具。デスクトップは埋め込みフォントの文字、Web はブラウザで描いた PNG。
 * widthAt は文字の大きさ size（pt）での文字列の幅。draw は、表示したときの座標で基準線の左端 (x, y) に、
 * 頁の /Rotate（rotation）に合わせて正立に見えるよう刷る。
 */
export type StampTextPainter = {
    widthAt(size: number): number;
    draw(page: any, args: { x: number; y: number; size: number; outline: number; rotation: number }): void | Promise<void>;
};

export type StampOptions = TabOptions & {
    allPages?: boolean;
    fontSize?: number;
    mints?: boolean;
};

/**
 * PDF に証拠番号をスタンプして、PDF のバイト列と頁数を返す。
 * 非A4の頁はA4に載せ直し、帯を付けるときは横長の頁を縦に回す（mints では帯を付けない）。
 */
export async function stampPdfBytes(
    inputBytes: Uint8Array,
    evidenceNumber: string,
    makePainter: (pdfDoc: any, stampText: string) => Promise<StampTextPainter>,
    options: StampOptions = {},
) {
    const { allPages = false, fontSize = DEFAULT_FONT_SIZE, mints = false, tab = false, tabIndex = 0, tabSteps = DEFAULT_TAB_STEPS } = options;
    const stampText = buildStampText(evidenceNumber, mints);

    const normalizedPdfBytes = await ensureA4Pages(inputBytes);
    const pdfDoc = await PDFDocument.load(normalizedPdfBytes);
    const painter = await makePainter(pdfDoc, stampText);

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
        const { width, height } = getDisplaySize(page);
        const stampMetrics = getStampMetricsForA4Print(width, height, fontSize);
        const textWidth = painter.widthAt(stampMetrics.fontSize);

        const { textX, textY, tabRect } = getStampLayout(width, height, textWidth, stampMetrics, { tab: withTab, tabIndex, tabSteps });
        if (tabRect) {
            drawTabBand(page, tabRect, stampMetrics.fontSize * TAB_STRIPE_PERIOD);
        }
        await painter.draw(page, { x: textX, y: textY, size: stampMetrics.fontSize, outline: stampMetrics.outline, rotation });
    }

    return { bytes: await pdfDoc.save(), pageCount: pages.length, stampText };
}

/**
 * 埋め込みフォントで文字を刷る道具（デスクトップ用）。fontBytes は TTF のバイト列。
 */
export async function makeFontPainter(pdfDoc: any, stampText: string, fontBytes: Uint8Array, fontkit: any): Promise<StampTextPainter> {
    pdfDoc.registerFontkit(fontkit);
    // subset: false だとフォント全体（数MB）が各ファイルに埋め込まれ、証拠1点あたり数MB増える。
    // スタンプ文字は号証番号だけなので、サブセット埋め込みで足りる。
    const embeddedFont = await pdfDoc.embedFont(fontBytes, { subset: true });
    return {
        widthAt: size => embeddedFont.widthOfTextAtSize(stampText, size),
        draw(page, { x, y, size, outline, rotation }) {
            const { width: pageW, height: pageH } = page.getSize();
            const point = toPageSpace(rotation, pageW, pageH, x, y);
            drawOutlinedText(page, stampText, { x: point.x, y: point.y, size, outline, font: embeddedFont, rotate: degrees(rotation) });
        },
    };
}

/**
 * 複数のスタンプ済みPDFを結合する（両面印刷対応：奇数頁の文書の後に空白頁を挿入。最後の文書の後には入れない）
 */
export async function mergeStampedPdfBytes(pdfBytesList: Uint8Array[], { insertBlankPages = true } = {}) {
    const mergedDoc = await PDFDocument.create();
    let totalPages = 0;
    let blankPages = 0;

    for (let i = 0; i < pdfBytesList.length; i++) {
        const srcDoc = await PDFDocument.load(pdfBytesList[i]);
        const copiedPages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());

        for (const page of copiedPages) {
            mergedDoc.addPage(page);
            totalPages++;
        }

        if (insertBlankPages && copiedPages.length % 2 !== 0 && i < pdfBytesList.length - 1) {
            // 最後の頁と同じ大きさ・向きの空白頁を足す
            const lastPage = copiedPages[copiedPages.length - 1];
            const { width, height } = lastPage.getSize();
            mergedDoc.addPage([width, height]).setRotation(degrees(getPageRotation(lastPage)));
            totalPages++;
            blankPages++;
        }
    }

    return { bytes: await mergedDoc.save(), totalPages, blankPages };
}
