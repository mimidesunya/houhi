/**
 * vCardから宛名ラベルPDFを作成するツール。
 *
 * 入力:
 * - 宛先の .vcf / .vcard ファイル
 * - 宛先ファイルと同じディレクトリの 差出人.vcf
 *
 * 出力:
 * - 宛先ファイルと同じディレクトリに PDF を作成します。
 *
 * 使い方:
 *   node src/address_label.js [--label-layout=ordinary|letterpack] [--pdf-engine=copper|chrome] <宛先.vcf>
 *   node src/address_label.js --chrome <宛先.vcf>
 *   node src/address_label.js --copper <宛先.vcf>
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { convertHtmlToPdf } = require('./lib/pdf_converter');

const SENDER_VCARD_FILE_NAME = '差出人.vcf';
const DEFAULT_LABEL_LAYOUT = 'ordinary';
const LABEL_LAYOUTS = new Set(['ordinary', 'letterpack']);
const PDF_ENGINES = new Set(['chrome', 'copper']);

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
const LABEL_BLOCK_METRICS: Record<string, Record<'to' | 'from', LabelBlockMetrics>> = {
    ordinary: {
        to: {
            widthMm: 88,
            heightMm: 46,
            maxFontPt: 16,
            minFontPt: 10,
            addressLineHeight: 1.2,
            postalGapMm: 2,
            addressGapMm: 2,
            phoneGapMm: 2
        },
        from: {
            widthMm: 88,
            heightMm: 27,
            maxFontPt: 16,
            minFontPt: 9,
            addressLineHeight: 1.2,
            postalGapMm: 2,
            addressGapMm: 2,
            phoneGapMm: 2
        }
    },
    letterpack: {
        to: {
            widthMm: 110,
            heightMm: 58,
            maxFontPt: 22,
            minFontPt: 11,
            addressLineHeight: 1.04,
            postalGapMm: 3,
            addressGapMm: 3,
            phoneGapMm: 2
        },
        from: {
            widthMm: 110,
            heightMm: 43,
            maxFontPt: 22,
            minFontPt: 11,
            addressLineHeight: 1.04,
            postalGapMm: 3,
            addressGapMm: 3,
            phoneGapMm: 2
        }
    }
};

function printUsage() {
    console.log('使い方: node src/address_label.js [--label-layout=ordinary|letterpack] [--pdf-engine=copper|chrome] <宛先.vcf>');
    console.log('       node src/address_label.js --chrome <宛先.vcf>');
    console.log('       node src/address_label.js --copper <宛先.vcf>');
    console.log(`差出人は宛先ファイルと同じディレクトリの ${SENDER_VCARD_FILE_NAME} を読み込みます。`);
}

function parseArgs(args) {
    const files: string[] = [];
    const pdfOptions: Record<string, string> = {};
    let layout = DEFAULT_LABEL_LAYOUT;

    const setPdfEngine = (value: string, optionName: string) => {
        if (!PDF_ENGINES.has(value)) {
            throw new Error(`${optionName} には copper または chrome を指定してください。`);
        }
        pdfOptions.engine = value;
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            return { files, layout, pdfOptions, help: true };
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
            const value = args[++i];
            if (!LABEL_LAYOUTS.has(value)) {
                throw new Error(`${arg} には ordinary または letterpack を指定してください。`);
            }
            layout = value;
            continue;
        }
        if (arg.startsWith('--label-layout=')) {
            const value = arg.slice('--label-layout='.length);
            if (!LABEL_LAYOUTS.has(value)) {
                throw new Error('--label-layout には ordinary または letterpack を指定してください。');
            }
            layout = value;
            continue;
        }
        if (arg.startsWith('--layout=')) {
            const value = arg.slice('--layout='.length);
            if (!LABEL_LAYOUTS.has(value)) {
                throw new Error('--layout には ordinary または letterpack を指定してください。');
            }
            layout = value;
            continue;
        }
        files.push(arg);
    }

    return { files, layout, pdfOptions, help: false };
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

function lineWidthUnits(value: string) {
    let units = 0;
    for (const char of String(value || '')) {
        if (/[ \t　]/.test(char)) {
            units += 0.35;
        } else if (/[\x00-\x7f]/.test(char)) {
            units += 0.55;
        } else {
            units += 1;
        }
    }
    return Math.max(units, 1);
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function roundFontSize(value: number) {
    return Math.floor(value * 10) / 10;
}

function calculateAutoFontSize(contact: VCardContact, role: 'to' | 'from', layout: string) {
    const metrics = (LABEL_BLOCK_METRICS[layout] || LABEL_BLOCK_METRICS.ordinary)[role];
    const postalCode = cleanPostalCode(contact.address.postalCode);
    const addressLines = formatAddressLines(contact);
    const nameSuffix = role === 'to' ? ' 御中' : '';
    const phone = compactSpaces(contact.phone);
    const name = `${displayName(contact)}${nameSuffix}`;
    const visibleLines = [
        postalCode ? `〒${postalCode}` : '',
        ...addressLines,
        name,
        phone ? `TEL ${phone}` : ''
    ].filter(Boolean);

    const longestLineUnits = Math.max(...visibleLines.map(lineWidthUnits), 1);
    const widthPt = metrics.widthMm * MM_TO_PT;
    const widthLimitedFont = widthPt / longestLineUnits;

    const lineHeightUnits =
        (postalCode ? 1.2 : 0) +
        (addressLines.length * metrics.addressLineHeight) +
        1.25 +
        (phone ? 1.2 : 0);
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

function renderContactBlock(contact: VCardContact, role: 'to' | 'from', layout: string) {
    const postalCode = cleanPostalCode(contact.address.postalCode);
    const addressLines = formatAddressLines(contact);
    const nameSuffix = role === 'to' ? ' 御中' : '';
    const phone = compactSpaces(contact.phone);
    const fontSizePt = calculateAutoFontSize(contact, role, layout);
    const style = renderAutoFontStyle(fontSizePt);

    return [
        postalCode ? `<div class="postal">〒${htmlEscape(postalCode)}</div>` : '',
        `<div class="address-lines">${renderLines(addressLines)}</div>`,
        `<div class="name">${htmlEscape(displayName(contact))}${nameSuffix}</div>`,
        phone ? `<div class="phone">℡ ${htmlEscape(phone)}</div>` : ''
    ].filter(Boolean).join('\n')
        .replace(/^/, `<div class="contact-fit" style="${style}">\n`)
        .replace(/$/, '\n</div>');
}

function buildLabelHtml(recipient: VCardContact, sender: VCardContact, layout = DEFAULT_LABEL_LAYOUT) {
    const isLetterpack = layout === 'letterpack';
    const title = isLetterpack ? 'レターパック宛名ラベル' : '普通郵便宛名ラベル';

    return `<!doctype html>
<html lang="ja" data-houhi-address-label="${htmlEscape(layout)}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
@page {
  size: A4;
  margin: 0;
}
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
.phone {
  font-size: var(--phone-size);
  line-height: 1.2;
}
.ordinary .label-frame {
  left: 24mm;
  top: 32mm;
  width: 100mm;
  height: 95mm;
  border: 0.2mm dotted #000;
}
.ordinary .separator {
  top: 58mm;
}
.ordinary .recipient {
  left: 6mm;
  top: 8mm;
  width: 88mm;
  height: 46mm;
}
.ordinary .sender {
  left: 6mm;
  top: 64mm;
  width: 88mm;
  height: 27mm;
}
.ordinary {
  --postal-size: 16pt;
  --address-size: 16pt;
  --name-size: 16pt;
  --phone-size: 16pt;
  --address-line-height: 1.2;
  --postal-gap: 2mm;
  --address-gap: 2mm;
  --phone-gap: 2mm;
}
.letterpack .label-frame {
  left: 22.2395mm;
  top: 49.1537mm;
  width: 124.7994mm;
  height: 119.7994mm;
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
  width: 124.7994mm;
  height: 0;
  opacity: 0.55;
  border-top: 0.16mm dotted #000;
}
.letterpack .cut-right {
  left: 147.0389mm;
  top: 49.1537mm;
  width: 0;
  height: 119.7994mm;
  opacity: 0.55;
  border-right: 0.16mm dotted #000;
}
.letterpack .cut-bottom {
  left: 22.2395mm;
  top: 168.9531mm;
  width: 124.7994mm;
  height: 0;
  opacity: 0.55;
  border-top: 0.16mm dotted #000;
}
.letterpack .cut-left {
  left: 22.2395mm;
  top: 49.1537mm;
  width: 0;
  height: 119.7994mm;
  opacity: 0.55;
  border-left: 0.16mm dotted #000;
}
.letterpack .separator {
  top: 66.2454mm;
}
.letterpack .recipient {
  left: 7.6965mm;
  top: 5.2mm;
  width: 110mm;
  height: 58mm;
}
.letterpack .sender {
  left: 7.3503mm;
  top: 73.2mm;
  width: 110mm;
  height: 43mm;
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
<body>
<main class="label-page ${isLetterpack ? 'letterpack' : 'ordinary'}">
  <section class="label-frame">
    <div class="guide"></div>
    <div class="separator"></div>
    <section class="block recipient">
      ${renderContactBlock(recipient, 'to', layout)}
    </section>
    <section class="block sender">
      ${renderContactBlock(sender, 'from', layout)}
    </section>
  </section>
  <div class="cut-line cut-top"></div>
  <div class="cut-line cut-right"></div>
  <div class="cut-line cut-bottom"></div>
  <div class="cut-line cut-left"></div>
</main>
</body>
</html>`;
}

function readContact(vcardPath: string) {
    return parseVCard(fs.readFileSync(vcardPath, 'utf-8'));
}

async function createAddressLabel(recipientPath: string, layout = DEFAULT_LABEL_LAYOUT, pdfOptions: Record<string, any> = {}) {
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

    const recipient = readContact(inputPath);
    const sender = readContact(senderPath);
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const layoutName = layout === 'letterpack' ? 'レターパック' : '普通郵便';
    const htmlPath = path.join(inputDir, `${baseName}_宛名ラベル_${layoutName}.html`);
    const outputPdfPath = path.join(inputDir, `${baseName}_宛名ラベル_${layoutName}.pdf`);

    fs.writeFileSync(htmlPath, buildLabelHtml(recipient, sender, layout), 'utf-8');
    console.log(`一時HTMLを生成しました: ${htmlPath}`);
    try {
        await convertHtmlToPdf(htmlPath, outputPdfPath, inputDir, null, {
            ...pdfOptions,
            engine: pdfOptions.engine || 'chrome'
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

    return { htmlPath, outputPdfPath, senderPath };
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
    if (parsed.files.length === 0) {
        console.error('エラー: 宛先vCardファイルを指定してください。');
        printUsage();
        process.exitCode = 1;
        return;
    }

    for (const file of parsed.files) {
        try {
            await createAddressLabel(file, parsed.layout, parsed.pdfOptions);
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
    cleanPostalCode,
    createAddressLabel,
    formatAddressLines,
    parseArgs,
    parseVCard,
    splitEscaped,
    unescapeVCardValue
};
