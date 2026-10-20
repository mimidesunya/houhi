/**
 * vCardから宛名ラベルPDFを作成するツール。
 *
 * ラベルはレターパックの宛名欄の大きさ（実測125×156mm）で作ります。お届け先・ご依頼主は外枠の左端から
 * 100mm 以内（幅 92mm）に収め、100mm の所に切り取り用の破線を入れます。破線と品名の区切り線で切れば、
 * 定形郵便の封筒にも同じラベルを貼れます（普通郵便用の配置は廃止しました）。
 *
 * 入力:
 * - 宛先の .vcf / .vcard ファイル
 * - 宛先ファイルと同じディレクトリの 差出人.vcf
 *
 * 出力:
 * - 宛先ファイルと同じディレクトリに PDF（`<宛先>_宛名ラベル_レターパック.pdf`、A4 縦1頁）を作成します。
 * - 宛先を複数指定すると、全員のラベルを1つの PDF（`宛名ラベル_レターパック_<件数>件.pdf`）にまとめ、
 *   最初の宛先と同じディレクトリに作成します。差出人は宛先ごとに、その宛先と同じディレクトリの 差出人.vcf です。
 *   A4 横向き1頁に2枚ずつ並べます（ラベルは 125×156mm なので正立のまま2枚入る）。
 *   `--separate` を付けると、従来どおり宛先ごとに別の PDF を作ります。
 *
 * PDF は既定で Copper で組みます（`--copper` を付けても同じ）。文字の大きさの見積もりは Copper の実測に
 * 合わせています。`--chrome` で Chrome でも組めますが、2枚並べるとき（A4 横）は Chrome の変換が用紙を
 * A4 縦に固定するので、Copper で組みます。
 *
 * 宛先 vCard の拡張項目:
 * - X-HOUHI-NAME-NOTE: 宛名の後ろに赤字で添える文言（「上告状在中（令和8年（ネ）第920号）」など）
 * - X-HOUHI-ITEM: レターパックの品名。ご依頼主の区画の下（外枠の下端まで）に品名を入れ、
 *   区画の下端に「☑リチウム電池なし」「☑高圧ガスなし」「☑引火性液体なし」をチェックした状態で横一列に並べる
 *   （2025年版のレターパックの品名欄にあるチェック欄。ラベルで隠れるため）。貼るとレターパックの品名欄に
 *   かかる。「品名」の語は封筒に印字されているので書かない。省略時の品名は「書類」
 *
 * 使い方:
 *   node src/address_label.js [--pdf-engine=copper|chrome] [--separate] <宛先.vcf...>
 *   node src/address_label.js --chrome <宛先.vcf>
 *
 * 以前の `--label-layout=letterpack` はそのまま受け付けます（付けなくても同じ）。`--label-layout=ordinary`
 * （普通郵便）を指定すると、廃止した旨を標準エラーに出し、レターパックの配置で作ります。
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { convertHtmlToPdf } = require('./lib/pdf_converter');

const SENDER_VCARD_FILE_NAME = '差出人.vcf';
// 宛名ラベルの配置はレターパックだけ。普通郵便の配置は 2026-10-20 に廃止した（TECH-20261020-005）。
// レターパックのラベルは破線で切れば定形郵便の封筒にも貼れるので、普通郵便にも同じものを使う
const LABEL_LAYOUT = 'letterpack';
const LABEL_LAYOUT_NAME = 'レターパック';
// 廃止した配置。記録や手順書に指定が残っていても止めず、案内を出してレターパックの配置で作る
const RETIRED_LABEL_LAYOUTS = new Set(['ordinary']);
const RETIRED_LABEL_LAYOUT_NOTICE = '普通郵便の配置は廃止しました。レターパックの配置で作ります（破線で切れば定形封筒にも貼れます）。';
// レターパックの品名の既定。裁判所・相手方への書面の送付が主な用途のため
const DEFAULT_LETTERPACK_ITEM = '書類';
// 2025年版のレターパックは、品名欄の中に「□リチウム電池なし」「□高圧ガスなし」「□引火性液体なし」の
// チェック欄が縦に並ぶ。ラベルを貼るとこの欄が隠れるので、チェックした状態でラベルに書く。
// 「品名」の語は封筒に印字されているので書かない
const LETTERPACK_ITEM_CHECKS = ['リチウム電池なし', '高圧ガスなし', '引火性液体なし'];
const PDF_ENGINES = new Set(['chrome', 'copper']);
// ラベルは Copper で組む。文字の大きさの見積もり（和欧間の空き・行の広がり）を Copper の実測に合わせている。
// 設定ファイルの pdf.engine には従わない（--copper を付けても付けなくても同じ PDF になるように）
const DEFAULT_PDF_ENGINE = 'copper';

type VCardAddress = {
    postalCode: string;
    region: string;
    locality: string;
    street: string;
    extended: string;
    country: string;
    label: string;
};

type VCardContact = {
    name: string;
    organization: string;
    address: VCardAddress;
    phone: string;
    nameNote: string;
    // レターパックの品名（宛先 vCard の X-HOUHI-ITEM）。空なら既定の「書類」
    item: string;
};

type ParsedLine = {
    key: string;
    params: string[];
    value: string;
};

type LabelBlockMetrics = {
    widthMm: number;
    heightMm: number;
    maxFontPt: number;
    minFontPt: number;
    addressLineHeight: number;
    postalGapMm: number;
    addressGapMm: number;
    phoneGapMm: number;
};

const MM_TO_PT = 72 / 25.4;
// お届け先・ご依頼主の区画は、外枠の左端から 100mm 以内に収める（幅 92mm）。
// 100mm の点線で切れば、定形郵便の封筒にも同じラベルを貼れる
const LABEL_BLOCK_METRICS: Record<'to' | 'from', LabelBlockMetrics> = {
    to: {
        widthMm: 92,
        heightMm: 58,
        maxFontPt: 22,
        minFontPt: 11,
        addressLineHeight: 1.04,
        postalGapMm: 3,
        addressGapMm: 3,
        phoneGapMm: 2
    },
    from: {
        widthMm: 92,
        // 箱（.letterpack .sender）の高さと同じ。以前は 43mm で見積もり、行の広がりの見落としを
        // 箱の余り（2.8mm）で吸収していた。いまは行の広がりを見積もりに入れている
        heightMm: 45.8,
        maxFontPt: 22,
        minFontPt: 11,
        addressLineHeight: 1.04,
        postalGapMm: 3,
        addressGapMm: 3,
        phoneGapMm: 2
    }
};

function printUsage() {
    console.log('使い方: node src/address_label.js [--pdf-engine=copper|chrome] [--separate] <宛先.vcf...>');
    console.log('       node src/address_label.js --chrome <宛先.vcf>');
    console.log('ラベルはレターパックの配置で作ります。破線で切れば定形郵便の封筒にも貼れます。');
    console.log('PDF は既定で Copper で組みます（--copper を付けても同じ）。');
    console.log(`差出人は宛先ファイルと同じディレクトリの ${SENDER_VCARD_FILE_NAME} を読み込みます。`);
    console.log('宛先を複数指定すると、A4 横1頁に2枚ずつ並べた1つのPDFを作ります（--separate で1件ずつ）。');
}

function parseArgs(args) {
    const files: string[] = [];
    const pdfOptions: Record<string, string> = {};
    // 標準エラーに出す案内（廃止した配置を指定されたときなど）
    const notices: string[] = [];
    let separate = false;

    const setPdfEngine = (value: string, optionName: string) => {
        if (!PDF_ENGINES.has(value)) {
            throw new Error(`${optionName} には copper または chrome を指定してください。`);
        }
        pdfOptions.engine = value;
    };

    // 配置はレターパックだけ。以前の --label-layout=letterpack はそのまま通し、
    // 廃止した ordinary（普通郵便）は案内を出してレターパックで作る
    const checkLayout = (value: string | undefined, optionName: string) => {
        if (value === LABEL_LAYOUT) return;
        if (value && RETIRED_LABEL_LAYOUTS.has(value)) {
            if (!notices.includes(RETIRED_LABEL_LAYOUT_NOTICE)) notices.push(RETIRED_LABEL_LAYOUT_NOTICE);
            return;
        }
        throw new Error(`${optionName} には letterpack を指定してください（省略してもレターパックの配置で作ります）。`);
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            return { files, pdfOptions, separate, notices, help: true };
        }
        if (arg === '--separate') {
            separate = true;
            continue;
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
            setPdfEngine(value, arg);
            continue;
        }
        if (arg.startsWith('--pdf-engine=')) {
            setPdfEngine(arg.slice('--pdf-engine='.length), '--pdf-engine');
            continue;
        }
        if (arg.startsWith('--engine=')) {
            setPdfEngine(arg.slice('--engine='.length), '--engine');
            continue;
        }
        if (arg === '--label-layout' || arg === '--layout') {
            checkLayout(args[++i], arg);
            continue;
        }
        if (arg.startsWith('--label-layout=')) {
            checkLayout(arg.slice('--label-layout='.length), '--label-layout');
            continue;
        }
        if (arg.startsWith('--layout=')) {
            checkLayout(arg.slice('--layout='.length), '--layout');
            continue;
        }
        files.push(arg);
    }

    return { files, pdfOptions, separate, notices, help: false };
}

function unfoldVCardLines(text: string) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .reduce((lines: string[], line) => {
            if (/^[ \t]/.test(line) && lines.length > 0) {
                lines[lines.length - 1] += line.slice(1);
            } else {
                lines.push(line);
            }
            return lines;
        }, []);
}

function unescapeVCardValue(value: string) {
    return String(value || '')
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\')
        .trim();
}

function splitEscaped(value: string, delimiter: string) {
    const parts: string[] = [];
    let current = '';
    let escaped = false;

    for (const char of String(value || '')) {
        if (escaped) {
            current += `\\${char}`;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === delimiter) {
            parts.push(unescapeVCardValue(current));
            current = '';
            continue;
        }
        current += char;
    }

    if (escaped) {
        current += '\\';
    }
    parts.push(unescapeVCardValue(current));
    return parts;
}

function parseVCardLine(line: string): ParsedLine | null {
    const index = line.indexOf(':');
    if (index < 0) return null;

    const head = line.slice(0, index);
    const value = unescapeVCardValue(line.slice(index + 1));
    const [rawKey, ...params] = head.split(';');
    const key = rawKey.split('.').pop().toUpperCase();
    return { key, params, value };
}

function parseVCard(text: string): VCardContact {
    const parsedLines = unfoldVCardLines(text)
        .map(parseVCardLine)
        .filter(Boolean) as ParsedLine[];

    const first = (key: string) => parsedLines.find(line => line.key === key)?.value || '';
    const adrLine = parsedLines.find(line => line.key === 'ADR');
    const labelLine = parsedLines.find(line => line.key === 'LABEL');
    const adrParts = adrLine ? splitEscaped(adrLine.value, ';') : [];
    const nParts = splitEscaped(first('N'), ';');
    const name = first('FN') || [nParts[1], nParts[0]].filter(Boolean).join(' ') || first('ORG');

    return {
        name,
        organization: first('ORG'),
        phone: first('TEL'),
        // 氏名の後ろに付ける添え書き（「親展」など）。赤字で表示する。
        nameNote: first('X-HOUHI-NAME-NOTE'),
        item: first('X-HOUHI-ITEM'),
        address: {
            postalCode: adrParts[5] || '',
            region: adrParts[4] || '',
            locality: adrParts[3] || '',
            street: adrParts[2] || '',
            extended: adrParts[1] || '',
            country: adrParts[6] || '',
            label: labelLine ? labelLine.value : ''
        }
    };
}

function compactSpaces(value: string) {
    return String(value || '').replace(/[ \t]+/g, ' ').trim();
}

function cleanPostalCode(value: string) {
    const raw = String(value || '').replace(/[^\d]/g, '');
    if (raw.length === 7) {
        return `${raw.slice(0, 3)}-${raw.slice(3)}`;
    }
    return String(value || '').trim();
}

function postalCodeDigits(value: string) {
    return String(value || '').replace(/[^\d]/g, '');
}

function removeDuplicatePostalLine(lines: string[], postalCode: string) {
    const expectedDigits = postalCodeDigits(postalCode);
    if (expectedDigits.length !== 7 || lines.length === 0) {
        return lines;
    }

    const [firstLine, ...rest] = lines;
    return postalCodeDigits(firstLine) === expectedDigits ? rest : lines;
}

function normalizeComparableLabel(value: string) {
    return compactSpaces(value)
        .replace(/[ \t　]+/g, '')
        .replace(/(?:御中|様|殿)$/u, '');
}

function removeDuplicateNameLine(lines: string[], contact: VCardContact) {
    if (lines.length === 0) {
        return lines;
    }

    const expectedName = normalizeComparableLabel(displayName(contact));
    if (!expectedName) {
        return lines;
    }

    const lastLine = lines[lines.length - 1];
    if (normalizeComparableLabel(lastLine) !== expectedName) {
        return lines;
    }

    return lines.slice(0, -1);
}

function formatAddressLines(contact: VCardContact) {
    const labelLines = contact.address.label
        .split(/\r?\n/)
        .map(compactSpaces)
        .filter(Boolean);

    if (labelLines.length > 0) {
        return removeDuplicateNameLine(
            removeDuplicatePostalLine(labelLines, contact.address.postalCode),
            contact
        );
    }

    const firstLine = compactSpaces([contact.address.region, contact.address.locality, contact.address.street].filter(Boolean).join(' '));
    const secondLine = compactSpaces(contact.address.extended);
    const country = compactSpaces(contact.address.country);
    return [firstLine, secondLine, country && country !== '日本' ? country : ''].filter(Boolean);
}

function displayName(contact: VCardContact) {
    return compactSpaces(contact.name || contact.organization || '氏名未設定');
}

// 宛名（FN）に敬称が既に含まれている場合は「御中」を重ねて付けない
function hasHonorificSuffix(value: string) {
    return /(?:御中|様|先生|殿)$/u.test(String(value || '').trim());
}

function htmlEscape(value: string) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderLines(lines: string[]) {
    return lines.map(line => `<div>${htmlEscape(line)}</div>`).join('\n');
}

// 以下の値は 2026-10-09 に Copper（cti.li）で合成データを組んで実測した（TECH-20260928-001）。
// Copper は漢字・かなと半角英数字のあいだに 1/4em の空き（和欧間）を入れる。
// 見積もりにこれがないと、宛先住所「…三丁目1番41号」が「41／号」で折り返した
const WAOU_SPACE_EM = 0.25;
// 半角数字は Helvetica で 0.556em。少し多めに見積もる
const HALF_WIDTH_DIGIT_EM = 0.56;
// 和文と半角の字が混じる行は、字の高さの基準がずれるぶん行が高くなる（実測 0.104em）。少し多めに見積もる
const MIXED_LINE_EXTRA_EM = 0.11;
// 和欧間の空きが入る和文（漢字・かな・長音）
const IDEOGRAPHIC_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const HALF_WIDTH_ALNUM_CHAR = /[A-Za-z0-9]/;

function lineWidthUnits(value: string) {
    let units = 0;
    let previous: 'ideographic' | 'alnum' | 'other' = 'other';
    for (const char of String(value || '')) {
        let current: 'ideographic' | 'alnum' | 'other' = 'other';
        if (char === '　') {
            // 全角の空白は 1em（以前は半角の空白と同じ 0.35 で見積もっていた）
            units += 1;
        } else if (/[ \t]/.test(char)) {
            units += 0.35;
        } else if (/[0-9]/.test(char)) {
            units += HALF_WIDTH_DIGIT_EM;
            current = 'alnum';
        } else if (/[\x00-\x7f]/.test(char)) {
            units += 0.55;
            if (HALF_WIDTH_ALNUM_CHAR.test(char)) current = 'alnum';
        } else {
            units += 1;
            if (IDEOGRAPHIC_CHAR.test(char)) current = 'ideographic';
        }
        // 和欧間の空き
        if ((previous === 'ideographic' && current === 'alnum') || (previous === 'alnum' && current === 'ideographic')) {
            units += WAOU_SPACE_EM;
        }
        previous = current;
    }
    return Math.max(units, 1);
}

// 和文と半角の字（空白を含む）が混じる行か。Copper ではこの行が高くなる
function isMixedWidthLine(value: string) {
    const text = String(value || '');
    return /[\x20-\x7e]/.test(text) && /[^\x00-\x7f]/.test(text);
}

function mixedLineExtra(value: string) {
    return isMixedWidthLine(value) ? MIXED_LINE_EXTRA_EM : 0;
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function roundFontSize(value: number) {
    return Math.floor(value * 10) / 10;
}

function calculateAutoFontSize(contact: VCardContact, role: 'to' | 'from') {
    const metrics = LABEL_BLOCK_METRICS[role];
    const postalCode = cleanPostalCode(contact.address.postalCode);
    const addressLines = formatAddressLines(contact);
    const nameSuffix = role === 'to' && !hasHonorificSuffix(displayName(contact)) ? ' 御中' : '';
    const phone = compactSpaces(contact.phone);
    const nameNote = role === 'to' ? compactSpaces(contact.nameNote) : '';
    const name = `${displayName(contact)}${nameSuffix}${nameNote ? `　${nameNote}` : ''}`;
    // 描画する字のとおりに見積もる（電話は「℡ 」を付けて描く）
    const postalLine = postalCode ? `〒${postalCode}` : '';
    const phoneLine = phone ? `℡ ${phone}` : '';
    const visibleLines = [
        postalLine,
        ...addressLines,
        name,
        phoneLine
    ].filter(Boolean);

    const longestLineUnits = Math.max(...visibleLines.map(lineWidthUnits), 1);
    const widthPt = metrics.widthMm * MM_TO_PT;
    const widthLimitedFont = widthPt / longestLineUnits;

    const lineHeightUnits =
        (postalLine ? 1.2 + mixedLineExtra(postalLine) : 0) +
        addressLines.reduce((sum, line) => sum + metrics.addressLineHeight + mixedLineExtra(line), 0) +
        1.25 + mixedLineExtra(name) +
        (phoneLine ? 1.2 + mixedLineExtra(phoneLine) : 0);
    const gapMm =
        (postalCode && addressLines.length > 0 ? metrics.postalGapMm : 0) +
        (addressLines.length > 0 ? metrics.addressGapMm : 0) +
        (phone ? metrics.phoneGapMm : 0);
    const heightPt = metrics.heightMm * MM_TO_PT;
    const gapPt = gapMm * MM_TO_PT;
    const heightLimitedFont = (heightPt - gapPt) / Math.max(lineHeightUnits, 1);
    return roundFontSize(clampNumber(
        Math.min(widthLimitedFont, heightLimitedFont, metrics.maxFontPt),
        metrics.minFontPt,
        metrics.maxFontPt
    ));
}

function renderAutoFontStyle(fontSizePt: number) {
    return [
        `--postal-size:${fontSizePt}pt`,
        `--address-size:${fontSizePt}pt`,
        `--name-size:${fontSizePt}pt`,
        `--phone-size:${fontSizePt}pt`
    ].join(';');
}

function renderContactBlock(contact: VCardContact, role: 'to' | 'from') {
    const postalCode = cleanPostalCode(contact.address.postalCode);
    const addressLines = formatAddressLines(contact);
    const nameSuffix = role === 'to' && !hasHonorificSuffix(displayName(contact)) ? ' 御中' : '';
    const phone = compactSpaces(contact.phone);
    const nameNote = role === 'to' ? compactSpaces(contact.nameNote) : '';
    const nameNoteHtml = nameNote ? `　<span class="name-note">${htmlEscape(nameNote)}</span>` : '';
    const fontSizePt = calculateAutoFontSize(contact, role);
    const style = renderAutoFontStyle(fontSizePt);

    return [
        postalCode ? `<div class="postal">〒${htmlEscape(postalCode)}</div>` : '',
        `<div class="address-lines">${renderLines(addressLines)}</div>`,
        `<div class="name">${htmlEscape(displayName(contact))}${nameSuffix}${nameNoteHtml}</div>`,
        phone ? `<div class="phone">℡ ${htmlEscape(phone)}</div>` : ''
    ].filter(Boolean).join('\n')
        .replace(/^/, `<div class="contact-fit" style="${style}">\n`)
        .replace(/$/, '\n</div>');
}

type LabelEntry = {
    recipient: VCardContact;
    sender: VCardContact;
};

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

function buildLabelHtml(recipient: VCardContact, sender: VCardContact) {
    return buildLabelsHtml([{ recipient, sender }]);
}

/**
 * レターパックのラベルを並べた HTML を作る。
 * 宛先が1件なら A4 縦 1頁。複数なら A4 横 1頁に2枚ずつ並べる
 * （ラベルは 125×156mm なので、横向きの A4（297×210mm）に正立のまま2枚入る）。
 */
function buildLabelsHtml(entries: LabelEntry[], options: { twoUp?: boolean } = {}) {
    const twoUp = options.twoUp ?? entries.length > 1;
    const pages = twoUp
        ? chunk(entries, 2).map(pair => `<div class="sheet">\n${pair.map(entry => buildLabelPage(entry.recipient, entry.sender)).join('\n')}\n</div>`)
        : entries.map(entry => buildLabelPage(entry.recipient, entry.sender));

    return `<!doctype html>
<html lang="ja" data-houhi-address-label="${LABEL_LAYOUT}">
<head>
<meta charset="utf-8">
<title>${LABEL_LAYOUT_NAME}宛名ラベル</title>
<!-- 用紙はラベル側で決める。data-houhi-a4-page-size があると、PDF 変換（Chrome・Copper とも）が
     「@page { size: A4; }」を差し込まないので、2枚並べるときの A4 横が通る -->
<style data-houhi-a4-page-size>
@page {
  size: ${twoUp ? 'A4 landscape' : 'A4'};
  margin: 0;
}
</style>
<style>
html,
body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #000;
}
body {
  width: 210mm;
  min-height: 297mm;
  font-family: Meiryo, "Yu Gothic", sans-serif;
}
.label-page {
  position: relative;
  width: 210mm;
  height: 297mm;
  break-after: avoid;
}
/* 2枚並べずに宛先ごとの頁にするときは、宛先ごとに改頁する */
body > .label-page + .label-page {
  break-before: page;
}
/* 2枚ずつ並べるとき: A4 横を左右に分け、各半分（148.5×210mm）の中央にラベルを置く */
body.two-up {
  width: 297mm;
  min-height: 210mm;
}
.sheet {
  display: flex;
  width: 297mm;
  height: 210mm;
  break-after: avoid;
}
.sheet + .sheet {
  break-before: page;
}
.sheet .label-page {
  flex: 0 0 148.5mm;
  width: 148.5mm;
  height: 210mm;
}
.label-frame {
  box-sizing: border-box;
  position: absolute;
  overflow: hidden;
  background: #fff;
}
.label-frame * {
  box-sizing: border-box;
}
.guide {
  position: absolute;
  inset: 0;
  border: 0.2mm dotted #000;
  pointer-events: none;
}
.separator {
  position: absolute;
  left: 0;
  right: 0;
  height: 0.47mm;
  background: #000;
}
.cut-line {
  display: none;
  position: absolute;
  z-index: 20;
  box-sizing: border-box;
  background: transparent;
  pointer-events: none;
}
.block {
  position: absolute;
  overflow: hidden;
  color: #000;
}
.contact-fit {
  --postal-size: inherit;
  --address-size: inherit;
  --name-size: inherit;
  --phone-size: inherit;
}
.postal {
  font-size: var(--postal-size);
  line-height: 1.2;
  margin-bottom: var(--postal-gap);
}
.address-lines {
  font-size: var(--address-size);
  line-height: var(--address-line-height);
  margin-bottom: var(--address-gap);
}
.name {
  font-size: var(--name-size);
  line-height: 1.25;
  margin-bottom: var(--phone-gap);
  font-weight: 500;
}
.name-note {
  color: #d00000;
  font-weight: 700;
}
.phone {
  font-size: var(--phone-size);
  line-height: 1.2;
}
/* 外枠はレターパックの宛名欄（お届け先・ご依頼主・品名）全体の実測 125×156mm（2026-10-08）。
   お届け先・ご依頼主の区画は従来の位置（参照SVG）のままで、その下を品名の区画にする */
.letterpack .label-frame {
  left: 22.2395mm;
  top: 49.1537mm;
  width: 125mm;
  height: 156mm;
}
.letterpack .guide {
  display: none;
}
.letterpack .cut-line {
  display: block;
}
.letterpack .cut-top {
  left: 22.2395mm;
  top: 49.1537mm;
  width: 125mm;
  height: 0;
  opacity: 0.55;
  border-top: 0.16mm dotted #000;
}
.letterpack .cut-right {
  left: 147.2395mm;
  top: 49.1537mm;
  width: 0;
  height: 156mm;
  opacity: 0.55;
  border-right: 0.16mm dotted #000;
}
.letterpack .cut-bottom {
  left: 22.2395mm;
  top: 205.1537mm;
  width: 125mm;
  height: 0;
  opacity: 0.55;
  border-top: 0.16mm dotted #000;
}
.letterpack .cut-left {
  left: 22.2395mm;
  top: 49.1537mm;
  width: 0;
  height: 156mm;
  opacity: 0.55;
  border-left: 0.16mm dotted #000;
}
.letterpack .separator {
  top: 66.2454mm;
}
/* 定形郵便に使うときの切り取り線。外枠の左端から 100mm、上端から品名の区切り線（119.8mm）まで */
.letterpack .cut-teikei {
  left: 122.2395mm;
  top: 49.1537mm;
  width: 0;
  height: 119.7994mm;
  opacity: 0.4;
  border-left: 0.16mm dashed #000;
}
/* 2枚並べるときの位置。半分の頁（148.5×210mm）の中央: 左 (148.5−125)/2＝11.75mm、上 (210−156)/2＝27mm */
.sheet .letterpack .label-frame,
.sheet .letterpack .cut-top,
.sheet .letterpack .cut-left {
  left: 11.75mm;
  top: 27mm;
}
.sheet .letterpack .cut-right {
  left: 136.75mm;
  top: 27mm;
}
.sheet .letterpack .cut-bottom {
  left: 11.75mm;
  top: 183mm;
}
.sheet .letterpack .cut-teikei {
  left: 111.75mm;
  top: 27mm;
}
/* 品名。お届け先・ご依頼主の区画（縦119.8mm）の下、外枠の下端（156mm）までの区画に置き、
   ラベルを貼るとレターパックの品名欄にかかるようにする。「品名」の語は封筒に印字されているので書かない */
.letterpack .separator-item {
  top: 119.7994mm;
}
.letterpack .item {
  left: 7.6965mm;
  top: 125mm;
  width: 112mm;
  height: 28mm;
}
.letterpack .item-name {
  font-size: 20pt;
  line-height: 1.2;
  font-weight: 500;
}
/* チェック欄は品名の区画の下端にそろえる（下づけ） */
.letterpack .item-checks {
  position: absolute;
  left: 0;
  bottom: 2mm;
  font-size: 12pt;
  line-height: 1.3;
  white-space: nowrap;
}
.letterpack .item-check {
  display: inline;
  margin-right: 1.2em;
}
.letterpack .item-check::before {
  content: "☑";
}
/* お届け先・ご依頼主は外枠の左端から 100mm 以内に収める（LABEL_BLOCK_METRICS の幅 92mm と同じ）。
   100mm の点線（.cut-teikei）で切れば、定形郵便の封筒にも貼れる */
.letterpack .recipient {
  left: 7.6965mm;
  top: 5.2mm;
  width: 92mm;
  height: 58mm;
}
.letterpack .sender {
  left: 7.3503mm;
  top: 73.2mm;
  width: 92mm;
  /* 箱は区切り線（119.8mm）の手前まで取る。文字の大きさは LABEL_BLOCK_METRICS の同じ 45.8mm で決める。
     以前は 43mm で決めていて、Copper で行が広がるぶん最後の行（電話番号）の下端が切れることがあった */
  height: 45.8mm;
}
.letterpack {
  --postal-size: 18pt;
  --address-size: 18pt;
  --name-size: 18pt;
  --phone-size: 18pt;
  --address-line-height: 1.04;
  --postal-gap: 3mm;
  --address-gap: 3mm;
  --phone-gap: 2mm;
}
</style>
</head>
<body${twoUp ? ' class="two-up"' : ''}>
${pages.join('\n')}
</body>
</html>`;
}

function buildLabelPage(recipient: VCardContact, sender: VCardContact) {
    return `<main class="label-page ${LABEL_LAYOUT}">
  <section class="label-frame">
    <div class="guide"></div>
    <div class="separator"></div>
    <section class="block recipient">
      ${renderContactBlock(recipient, 'to')}
    </section>
    <section class="block sender">
      ${renderContactBlock(sender, 'from')}
    </section>
    <div class="separator separator-item"></div>
    <section class="block item">
      <div class="item-name">${htmlEscape(compactSpaces(recipient.item) || DEFAULT_LETTERPACK_ITEM)}</div>
      <div class="item-checks">${LETTERPACK_ITEM_CHECKS.map(c => `<span class="item-check">${htmlEscape(c)}</span>`).join('')}</div>
    </section>
  </section>
  <div class="cut-line cut-top"></div>
  <div class="cut-line cut-right"></div>
  <div class="cut-line cut-bottom"></div>
  <div class="cut-line cut-left"></div>
  <div class="cut-line cut-teikei"></div>
</main>`;
}

function readContact(vcardPath: string) {
    return parseVCard(fs.readFileSync(vcardPath, 'utf-8'));
}

/**
 * 宛先 vCard と、同じディレクトリの差出人 vCard を読む。
 */
function loadLabelEntry(recipientPath: string) {
    const inputPath = path.resolve(recipientPath);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`宛先vCardが見つかりません: ${inputPath}`);
    }
    if (!/\.(?:vcf|vcard)$/i.test(inputPath)) {
        throw new Error(`.vcf または .vcard ファイルを指定してください: ${inputPath}`);
    }

    const inputDir = path.dirname(inputPath);
    const senderPath = path.join(inputDir, SENDER_VCARD_FILE_NAME);
    if (!fs.existsSync(senderPath)) {
        throw new Error(`差出人vCardが見つかりません: ${senderPath}`);
    }

    const entry: LabelEntry = { recipient: readContact(inputPath), sender: readContact(senderPath) };
    return { inputPath, inputDir, senderPath, entry };
}

async function createAddressLabel(recipientPath: string, pdfOptions: Record<string, any> = {}) {
    const { inputPath, inputDir, senderPath, entry } = loadLabelEntry(recipientPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const htmlPath = path.join(inputDir, `${baseName}_宛名ラベル_${LABEL_LAYOUT_NAME}.html`);
    const outputPdfPath = path.join(inputDir, `${baseName}_宛名ラベル_${LABEL_LAYOUT_NAME}.pdf`);

    await writeLabelPdf(buildLabelsHtml([entry]), htmlPath, outputPdfPath, inputDir, labelPdfOptions(1, pdfOptions));
    return { htmlPath, outputPdfPath, senderPath };
}

/**
 * 複数の宛先のラベルを1つの PDF にする（A4 横1頁に2枚ずつ）。
 * 出力先は最初の宛先と同じディレクトリ。差出人は宛先ごとに、その宛先と同じディレクトリの 差出人.vcf を使う。
 */
async function createCombinedAddressLabel(recipientPaths: string[], pdfOptions: Record<string, any> = {}) {
    const loaded = recipientPaths.map(loadLabelEntry);
    const outputDir = loaded[0].inputDir;
    const baseName = `宛名ラベル_${LABEL_LAYOUT_NAME}_${loaded.length}件`;
    const htmlPath = path.join(outputDir, `${baseName}.html`);
    const outputPdfPath = path.join(outputDir, `${baseName}.pdf`);

    const options = labelPdfOptions(loaded.length, pdfOptions);
    await writeLabelPdf(buildLabelsHtml(loaded.map(item => item.entry)), htmlPath, outputPdfPath, outputDir, options);
    return { htmlPath, outputPdfPath, count: loaded.length };
}

/**
 * ラベルの PDF を組むエンジンを決める。既定は Copper（設定ファイルの pdf.engine には従わない）。
 * 2枚並べるとき（A4 横）は --chrome を指定されても Copper で組む。Chrome の変換は頁番号の処理と印刷設定で
 * 用紙を A4 縦に固定するので、横の頁が縦に縮めて出る（2026-10-09 確認）。
 */
function labelPdfOptions(count: number, pdfOptions: Record<string, any> = {}) {
    const engine = pdfOptions.engine || DEFAULT_PDF_ENGINE;
    if (engine === 'chrome' && count >= 2) {
        console.warn('Chrome の変換は用紙を A4 縦に固定するので、2枚並べるラベルは Copper で作ります。');
        return { ...pdfOptions, engine: 'copper' };
    }
    return { ...pdfOptions, engine };
}

async function writeLabelPdf(html: string, htmlPath: string, outputPdfPath: string, workDir: string, pdfOptions: Record<string, any> = {}) {
    const inputDir = workDir;
    fs.writeFileSync(htmlPath, html, 'utf-8');
    console.log(`一時HTMLを生成しました: ${htmlPath}`);
    try {
        await convertHtmlToPdf(htmlPath, outputPdfPath, inputDir, null, {
            ...pdfOptions,
            engine: pdfOptions.engine || DEFAULT_PDF_ENGINE
        });
    } finally {
        try {
            if (fs.existsSync(htmlPath)) {
                fs.unlinkSync(htmlPath);
                console.log(`一時HTMLを削除しました: ${htmlPath}`);
            }
        } catch (err) {
            console.error(`一時HTMLを削除できませんでした: ${err}`);
        }
    }
    console.log(`PDFを作成しました: ${outputPdfPath}`);

    if (fs.existsSync(outputPdfPath)) {
        const command = process.platform === 'win32'
            ? `start msedge "${outputPdfPath}"`
            : (process.platform === 'darwin' ? `open "${outputPdfPath}"` : `xdg-open "${outputPdfPath}"`);
        exec(command, err => {
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

    // 廃止した配置（--label-layout=ordinary）を指定されたときなどの案内
    for (const notice of parsed.notices) {
        console.error(notice);
    }

    if (parsed.help) {
        printUsage();
        return;
    }
    if (parsed.files.length === 0) {
        console.error('エラー: 宛先vCardファイルを指定してください。');
        printUsage();
        process.exitCode = 1;
        return;
    }

    // 宛先が複数なら、A4 横1頁に2枚ずつ並べた1つの PDF にする（--separate で従来どおり1件ずつ）
    if (parsed.files.length > 1 && !parsed.separate) {
        try {
            await createCombinedAddressLabel(parsed.files, parsed.pdfOptions);
        } catch (err) {
            console.error(`エラー: ${err instanceof Error ? err.message : err}`);
            process.exitCode = 1;
        }
        return;
    }

    for (const file of parsed.files) {
        try {
            await createAddressLabel(file, parsed.pdfOptions);
        } catch (err) {
            console.error(`エラー: ${err instanceof Error ? err.message : err}`);
            process.exitCode = 1;
        }
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    SENDER_VCARD_FILE_NAME,
    buildLabelHtml,
    buildLabelsHtml,
    DEFAULT_PDF_ENGINE,
    RETIRED_LABEL_LAYOUT_NOTICE,
    cleanPostalCode,
    labelPdfOptions,
    createAddressLabel,
    createCombinedAddressLabel,
    formatAddressLines,
    parseArgs,
    parseVCard,
    splitEscaped,
    unescapeVCardValue
};
