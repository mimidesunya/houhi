/**
 * mfaxメールFAX送信ツール
 *
 * 送付書 Markdown と添付 PDF をもとに、FAX 送信用 PDF を生成し、
 * `@mfax.jp` 宛のメールとして送信します。
 * 送信後は IMAP 上の送信済みフォルダへ保存します。
 *
 * 入力:
 * - `送付書.md + 添付PDF...`
 * - または `添付PDF...` のみ（FAX番号は手入力）
 *
 * 出力:
 * - 送付書 PDF、結合 PDF、二値化 PDF を一時ディレクトリに作成して送信に使用します。
 * - 一時ファイルは処理終了時に削除します。
 *
 * 必要設定:
 * - `config.json` の `mail`
 * - `config.json` の `mfax`
 *
 * 使い方:
 *   node src/fax_send.js <YYYY-MM-DD-送付書.md> <添付PDF...>
 *   node src/fax_send.js <添付PDF...>              ← 送付書なし（FAX番号を手入力）
 *
 * 動作:
 *   1. 送付書.mdをPDF化（送付書がある場合）
 *   2. 送付書PDF + 添付PDF全件を結合（送付書がある場合）
 *   3. 送付書.mdからFAX番号を抽出 (FAX XXXXXXXXXX)、または手入力
 *   4. {FAX番号}@mfax.jp 宛にメール送信（本文空、PDFを添付）
 *   5. 送信済みメールをIMAPの送信済みフォルダへ保存
 *
 * 補足:
 * - 送信前に確認プロンプトを表示します。
 * - GUI実行時は確認・入力要求を標準出力マーカ経由でダイアログ化します。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, registerFont, loadImage } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { loadConfig } = require('./lib/config_loader');
const { convertHtmlToPdf } = require('./lib/pdf_converter');
const { renderPreTags } = require('./lib/markdown_renderer');

const BASE_DIR = __dirname;
const DEFAULT_TEMPLATE_DIR = path.join(BASE_DIR, 'base');

// ─── MD→PDF 変換 ─────────────────────────────────────────────

function wrapMarkdownInHtml(markdownContent, title = '裁判文書') {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <link rel="stylesheet" href="style.css">
    <script src="court_markdown.js"></script>
</head>
<body>
<pre>
${markdownContent}
</pre>
</body>
</html>`;
}

async function convertMdToPdf(mdPath, outputPdfPath) {
    const inputText = fs.readFileSync(mdPath, 'utf-8');
    const titleMatch = inputText.match(/^#\s+(.*)$/m);
    const title = titleMatch ? titleMatch[1].trim() : path.basename(mdPath, '.md');

    let htmlContent = wrapMarkdownInHtml(inputText, title);
    htmlContent = renderPreTags(htmlContent, DEFAULT_TEMPLATE_DIR);

    const htmlPath = outputPdfPath.replace(/\.pdf$/i, '_tmp.html');
    fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
    try {
        await convertHtmlToPdf(htmlPath, outputPdfPath, DEFAULT_TEMPLATE_DIR, DEFAULT_TEMPLATE_DIR);
    } finally {
        try { fs.unlinkSync(htmlPath); } catch (_e) {}
    }
}

function formatFaxDestination(entry) {
    const parts: string[] = [];
    if (entry?.label) parts.push(`[${entry.label}]`);
    if (entry?.name) parts.push(entry.name);
    return parts.length > 0 ? parts.join(' ') : '(手入力)';
}

function getErrorMessage(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    return String(error);
}

function isExpiredCertificateError(error) {
    const code = error?.code || error?.cause?.code;
    const message = getErrorMessage(error);
    return code === 'CERT_HAS_EXPIRED'
        || /certificate (?:has )?expired/i.test(message)
        || /certificate was expired/i.test(message)
        || /証明書.*期限/i.test(message);
}

function describeMailServerError(error, { protocol, action, settingPath, host, port, secure }) {
    const originalMessage = getErrorMessage(error);
    if (!isExpiredCertificateError(error)) {
        return originalMessage;
    }

    const endpoint = host ? `${host}${port ? `:${port}` : ''}` : '(未設定)';
    const secureText = typeof secure === 'boolean' ? `, secure=${secure}` : '';
    return [
        `[${protocol}/TLS] ${action}に失敗しました。`,
        `config.json の ${settingPath}.host (${endpoint}${secureText}) のSSL/TLSサーバー証明書が期限切れです。`,
        'これはFAX番号・mfax送信パスワード・メールアカウントの認証ではなく、メールサーバーとの暗号化接続で行う証明書確認です。',
        `メールサーバー側の証明書更新、または config.json の ${settingPath}.host / port / secure を確認してください。`,
        `元のエラー: ${originalMessage}`,
    ].join('\n');
}

function toMailServerError(error, context) {
    const message = describeMailServerError(error, context);
    if (message === getErrorMessage(error) && error instanceof Error) {
        return error;
    }
    return new Error(message);
}

// ─── PDF結合 ──────────────────────────────────────────────────

async function mergePdfs(pdfPaths, outputPath) {
    const merged = await PDFDocument.create();
    for (const pdfPath of pdfPaths) {
        const bytes = fs.readFileSync(pdfPath);
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copied = await merged.copyPages(src, src.getPageIndices());
        copied.forEach(p => merged.addPage(p));
    }
    const mergedBytes = await merged.save();
    fs.writeFileSync(outputPath, mergedBytes);
}

function createFaxAttachmentFilename(pdfPaths) {
    if (pdfPaths.length === 1) {
        return path.basename(pdfPaths[0]);
    }

    const firstBase = path.basename(pdfPaths[0], path.extname(pdfPaths[0]));
    return `${firstBase}_ほか${pdfPaths.length - 1}件.pdf`;
}

function classifyFaxInputFiles(fileArgs) {
    let mdFile = null;
    const attachPdfs = [];

    for (const arg of fileArgs) {
        const abs = path.resolve(arg);
        if (!fs.existsSync(abs)) {
            throw new Error(`ファイルが見つかりません: ${abs}`);
        }

        const ext = path.extname(abs).toLowerCase();
        if (ext === '.md') {
            mdFile = abs;
        } else if (ext === '.pdf') {
            attachPdfs.push(abs);
        }
    }

    return { mdFile, attachPdfs };
}

function findPagedMarkdownForPdfs(pdfPaths) {
    for (const pdfPath of pdfPaths) {
        const candidate = pdfPath.replace(/\.pdf$/i, '') + '_paged.md';
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

// ─── FAX二値化 ───────────────────────────────────────────────

const FAX_DPI = 200;
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const { toFaxBinaryAuto, toFaxBinary, otsuThreshold, computeLuminanceData } = require('./fax_prepare_pdf');

const JAPANESE_FONT_CANDIDATES = [
    { path: 'C:/Windows/Fonts/msgothic.ttc', family: 'MS Gothic' },
    { path: 'C:/Windows/Fonts/meiryo.ttc',   family: 'Meiryo' },
    { path: 'C:/Windows/Fonts/YuGothM.ttc',  family: 'Yu Gothic' },
];

function registerJapaneseFonts() {
    for (const c of JAPANESE_FONT_CANDIDATES) {
        try { if (fs.existsSync(c.path)) registerFont(c.path, { family: c.family }); } catch (_) {}
    }
}

function getA4Placement(width, height) {
    const [pageW, pageH] = width > height ? [A4_HEIGHT, A4_WIDTH] : [A4_WIDTH, A4_HEIGHT];
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

class SafeCanvasFactory {
    create(w, h) {
        const canvas = createCanvas(Math.ceil(w), Math.ceil(h));
        return { canvas, context: canvas.getContext('2d') };
    }
    reset(cc, w, h) { if (cc?.canvas) { cc.canvas.width = Math.ceil(w); cc.canvas.height = Math.ceil(h); } }
    destroy(cc) { if (cc) { cc.canvas = null; cc.context = null; } }
}

async function binarizePdfForFax(inputPath, previewDir, noDither = false) {
    const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const previewPaths = [];
    const rawPaths = [];
    const ditherStatus = [];
    const pageDims = [];
    const pdfBytes = fs.readFileSync(inputPath);
    const src = await pdfjsLib.getDocument({
        data: new Uint8Array(pdfBytes),
        standardFontDataUrl: path.join(pdfjsDir, 'standard_fonts') + path.sep,
        cMapUrl: path.join(pdfjsDir, 'cmaps') + path.sep,
        cMapPacked: true,
        CanvasFactory: SafeCanvasFactory,
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        isEvalSupported: false,
    }).promise;

    const scale = FAX_DPI / 72;

    for (let n = 1; n <= src.numPages; n++) {
        const page = await src.getPage(n);
        const vpOrig = page.getViewport({ scale: 1 });
        const vpRender = page.getViewport({ scale });
        pageDims.push(getA4Placement(vpOrig.width, vpOrig.height));
        const canvas = createCanvas(Math.ceil(vpRender.width), Math.ceil(vpRender.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vpRender,
            canvasFactory: new SafeCanvasFactory(), background: 'rgb(255,255,255)' }).promise;

        // 原画像を保存（ページ単位の再生成用）
        const rawPath = path.join(previewDir, `raw_${n}.png`);
        fs.writeFileSync(rawPath, canvas.toBuffer('image/png'));
        rawPaths.push(rawPath);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (noDither) {
            const { histogram, totalPixels } = computeLuminanceData(imgData, canvas.width, canvas.height);
            const thresh = otsuThreshold(histogram, totalPixels);
            toFaxBinary(imgData, thresh);
            ditherStatus.push(false);
            console.log(`  [自動閾値] 閾値=${thresh} (ディザリングOFF)`);
        } else {
            const binResult = toFaxBinaryAuto(imgData, canvas.width, canvas.height);
            ditherStatus.push(binResult.hasPhoto);
            console.log(`  [自動調整] 閾値=${binResult.threshold}, 写真=${binResult.hasPhoto ? 'あり→ディザリング' : 'なし'} (中間調=${(binResult.midToneRatio * 100).toFixed(1)}%)`);
        }
        ctx.putImageData(imgData, 0, 0);
        const pp = path.join(previewDir, `preview_${n}.png`);
        fs.writeFileSync(pp, canvas.toBuffer('image/png'));
        previewPaths.push(pp);
        console.log(`[二値化] ${n}/${src.numPages} ページ`);
        if (typeof page.cleanup === 'function') page.cleanup();
    }
    if (typeof src.cleanup === 'function') src.cleanup();

    return { previewPaths, rawPaths, ditherStatus, pageDims };
}

async function regeneratePage(rawPngPath, previewPngPath, useDither) {
    const img = await loadImage(rawPngPath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (useDither) {
        toFaxBinaryAuto(imgData, canvas.width, canvas.height);
    } else {
        const { histogram, totalPixels } = computeLuminanceData(imgData, canvas.width, canvas.height);
        const thresh = otsuThreshold(histogram, totalPixels);
        toFaxBinary(imgData, thresh);
    }
    ctx.putImageData(imgData, 0, 0);
    fs.writeFileSync(previewPngPath, canvas.toBuffer('image/png'));
}

async function buildFaxPdf(previewPaths, pageDims, outputPath) {
    const out = await PDFDocument.create();
    for (let i = 0; i < previewPaths.length; i++) {
        const pngBuf = fs.readFileSync(previewPaths[i]);
        const img = await out.embedPng(pngBuf);
        const dims = pageDims[i];
        const p = out.addPage([dims.pageW, dims.pageH]);
        p.drawImage(img, { x: dims.x, y: dims.y, width: dims.width, height: dims.height });
    }
    fs.writeFileSync(outputPath, await out.save({ useObjectStreams: false }));
}

// ─── FAX番号抽出 ──────────────────────────────────────────────

/**
 * 送付書MDから送信先FAX番号を抽出する。
 *
 * fromReceipt=false（送付書.md）:
 *   1. 相手方: 受領書見出しより前の全「### --左」ブロック内の (FAX ...) を収集
 *   2. 裁判所: 受領書見出し以降の最初の「### --左」ブロック内の最初の (FAX ...)
 *
 * fromReceipt=true（_paged.md = 受領した文書）:
 *   受領書セクション内のすべての (FAX ...) を送信先として抽出
 */
function extractFaxNumbers(mdContent, { fromReceipt = false } = {}) {
    const lines = mdContent.split('\n').map(l => l.trim());
    const results = [];
    const seen = new Set();

    // ブロック内のすべてのFAX番号を取得するヘルパー
    // FAX番号と同一行の前半テキスト（御中, 宛 等）も名前として取得
    function allFaxInBlock(startIdx) {
        const found = [];
        let lastLabel = '';
        for (let i = startIdx; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('### --')) break;
            const m = line.match(/[\(（]FAX\s+([\d\-\(\)\s]+)[\)）]/);
            if (m) {
                const num = m[1].replace(/[^\d]/g, '');
                const prefix = line.substring(0, m.index).trim();
                const name = prefix || lastLabel;
                if (num) found.push({ name, number: num });
            } else if (line !== '') {
                lastLabel = line;
            }
        }
        return found;
    }

    // 受領書見出しの行番号を特定（「# ...受領書」にマッチ）
    let receiptLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^#\s+.*受領書/.test(lines[i])) {
            receiptLine = i;
            break;
        }
    }

    if (fromReceipt) {
        // _paged.md モード: 受領書セクション内のすべてのFAX番号を抽出
        if (receiptLine < 0) return results;
        for (let i = receiptLine; i < lines.length; i++) {
            if (lines[i] === '### --左' || lines[i] === '### --右') {
                for (const hit of allFaxInBlock(i + 1)) {
                    if (!seen.has(hit.number)) {
                        seen.add(hit.number);
                        const label = hit.name.includes('裁判所') ? '裁判所' : '相手方';
                        results.push({ label, ...hit });
                    }
                }
            }
        }
        return results;
    }

    // 送付書.md モード
    const boundary = receiptLine >= 0 ? receiptLine : lines.length;

    // 1. 相手方: 受領書より前のすべての「### --左」ブロックからFAX番号を収集
    for (let i = 0; i < boundary; i++) {
        if (lines[i] === '### --左') {
            for (const hit of allFaxInBlock(i + 1)) {
                if (!seen.has(hit.number)) {
                    seen.add(hit.number);
                    results.push({ label: '相手方', ...hit });
                }
            }
        }
    }

    // 2. 裁判所: 受領書以降の最初の「### --左」ブロックから最初のFAX番号（重複除外）
    if (receiptLine >= 0) {
        for (let i = receiptLine; i < lines.length; i++) {
            if (lines[i] === '### --左') {
                for (const hit of allFaxInBlock(i + 1)) {
                    if (!seen.has(hit.number)) {
                        seen.add(hit.number);
                        results.push({ label: '裁判所', ...hit });
                    }
                    break;
                }
                break;
            }
        }
    }

    return results;
}

// ─── 確認プロンプト ────────────────────────────────────────────

function askConfirm(question) {
    if (process.stdin.isTTY) {
        // CLIモード: readlineで標準入力
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise(resolve => {
            rl.question(question + '\n[y/N]: ', answer => {
                rl.close();
                resolve(answer.trim().toLowerCase() === 'y');
            });
        });
    } else {
        // GUIモード: [CONFIRM] マーカをstdoutに出してstdin応答待ち
        // 改行はエスケープして1行で送る
        const encoded = question.replace(/\n/g, '\\n');
        process.stdout.write(`[CONFIRM] ${encoded}\n`);
        return new Promise(resolve => {
            let buf = '';
            const onData = (chunk) => {
                buf += chunk.toString();
                if (buf.includes('\n')) {
                    process.stdin.removeListener('data', onData);
                    process.stdin.pause();
                    resolve(buf.trim().toLowerCase() === 'y');
                }
            };
            process.stdin.resume();
            process.stdin.setEncoding('utf-8');
            process.stdin.on('data', onData);
        });
    }
}

/**
 * ユーザーにテキスト入力を求める（GUI/CLI両対応）
 */
function askPrompt(question): Promise<string> {
    if (process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise(resolve => {
            rl.question(question + ': ', answer => {
                rl.close();
                resolve(answer.trim());
            });
        });
    } else {
        const encoded = question.replace(/\n/g, '\\n');
        process.stdout.write(`[PROMPT] ${encoded}\n`);
        return new Promise(resolve => {
            let buf = '';
            const onData = (chunk) => {
                buf += chunk.toString();
                if (buf.includes('\n')) {
                    process.stdin.removeListener('data', onData);
                    process.stdin.pause();
                    resolve(buf.trim());
                }
            };
            process.stdin.resume();
            process.stdin.setEncoding('utf-8');
            process.stdin.on('data', onData);
        });
    }
}

// ─── プレビュー確認 ──────────────────────────────────────────

function askPreviewConfirm(faxNumbers, previewPaths, rawPaths, ditherStatus): Promise<{ confirmed: boolean; faxNumbers: any[] }> {
    const faxList = faxNumbers
        .map((e, i) => `  ${i + 1}. ${formatFaxDestination(e)}  (${e.number})`)
        .join('\n');

    if (process.stdin.isTTY) {
        console.log('\n二値化プレビュー画像:');
        previewPaths.forEach((p, i) => console.log(`  ${i + 1}ページ: ${p}`));
        console.log('');
        return askConfirm(`以下の宛先に FAX 送信しますか？\n${faxList}`).then((ok: boolean) => ({
            confirmed: ok,
            faxNumbers: ok ? faxNumbers : []
        }));
    } else {
        const payload = JSON.stringify({
            faxNumbers: faxNumbers.map(f => ({ label: f.label, name: f.name, number: f.number })),
            images: previewPaths,
            ditherStatus: ditherStatus,
        });
        process.stdout.write(`[PREVIEW] ${payload}\n`);
        return new Promise((resolve) => {
            let buf = '';
            const onData = (chunk) => {
                buf += chunk.toString();
                while (buf.includes('\n')) {
                    const idx = buf.indexOf('\n');
                    const line = buf.substring(0, idx).trim();
                    buf = buf.substring(idx + 1);
                    if (!line) continue;

                    if (line.startsWith('REGEN ')) {
                        const parts = line.split(' ');
                        const pageNum = parseInt(parts[1]);
                        const useDither = parts[2] === 'dither';
                        regeneratePage(rawPaths[pageNum - 1], previewPaths[pageNum - 1], useDither)
                            .then(() => {
                                ditherStatus[pageNum - 1] = useDither;
                                process.stdout.write(`[REGEN_DONE] ${pageNum}\n`);
                            });
                    } else if (line.startsWith('CONFIRM_FAX ')) {
                        const json = line.substring('CONFIRM_FAX '.length);
                        try {
                            const nums = JSON.parse(json);
                            process.stdin.removeListener('data', onData);
                            process.stdin.pause();
                            resolve({ confirmed: true, faxNumbers: nums });
                        } catch (e) {
                            process.stdin.removeListener('data', onData);
                            process.stdin.pause();
                            resolve({ confirmed: false, faxNumbers: [] });
                        }
                        return;
                    } else if (line.toLowerCase() === 'n') {
                        process.stdin.removeListener('data', onData);
                        process.stdin.pause();
                        resolve({ confirmed: false, faxNumbers: [] });
                        return;
                    }
                }
            };
            process.stdin.resume();
            process.stdin.setEncoding('utf-8');
            process.stdin.on('data', onData);
        });
    }
}

// ─── IMAP Sent 保存 ───────────────────────────────────────────

async function saveToSent(rawMessage, mailConfig) {
    const client = new ImapFlow({
        host: mailConfig.imap.host,
        port: mailConfig.imap.port,
        secure: mailConfig.imap.secure,
        tls: { minVersion: mailConfig.imap.tlsMinVersion || 'TLSv1.2' },
        auth: {
            user: mailConfig.user,
            pass: mailConfig.password
        },
        logger: false
    });

    let connected = false;
    try {
        await client.connect();
        connected = true;
    } catch (error) {
        throw toMailServerError(error, {
            protocol: 'IMAP',
            action: '送信済みメールの保存',
            settingPath: 'mail.imap',
            host: mailConfig.imap.host,
            port: mailConfig.imap.port,
            secure: mailConfig.imap.secure,
        });
    }

    try {
        // Sent フォルダを探す（Sent / Sent Messages / 送信済み など）
        const mailboxes = await client.list();
        let sentPath = null;
        for (const mb of mailboxes) {
            const name = mb.path.toLowerCase();
            if (mb.specialUse === '\\Sent' || name.includes('sent') || name.includes('送信')) {
                sentPath = mb.path;
                break;
            }
        }
        if (!sentPath) {
            // フォールバック: "Sent" を直接試みる
            sentPath = 'Sent';
        }
        console.log(`[IMAP] Sentフォルダへ保存: ${sentPath}`);
        await client.append(sentPath, rawMessage, ['\\Seen']);
        console.log('[IMAP] 送信済みメールを保存しました。');
    } finally {
        if (connected) {
            await client.logout();
        }
    }
}

// ─── メイン ──────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log('-------------------------------------------------------');
        console.log(' mfax FAX送信ツール');
        console.log(' 使い方: node fax_send.js <送付書.md> <添付PDF...>');
        console.log('         node fax_send.js <添付PDF...>  (送付書なし)');
        console.log(' ドロップ: YYYY-MM-DD-送付書.md と 送付するPDFをドロップ');
        console.log('           または PDF のみドロップ（FAX番号を手入力）');
        console.log('-------------------------------------------------------');
        return;
    }

    // ─ オプション解析 ─
    let noDither = false;
    const fileArgs = [];
    for (const arg of args) {
        if (arg === '--no-dither') {
            noDither = true;
        } else {
            fileArgs.push(arg);
        }
    }

    // ─ ファイル分類 ─
    const { mdFile, attachPdfs } = classifyFaxInputFiles(fileArgs);

    if (attachPdfs.length === 0) {
        console.error('[エラー] 送信する PDF ファイルが見つかりません。');
        return;
    }
    if (attachPdfs.length > 1) {
        console.log(`[FAX] PDF ${attachPdfs.length} 件を指定順に結合します。`);
        attachPdfs.forEach((pdfPath, i) => {
            console.log(`  ${i + 1}. ${path.basename(pdfPath)}`);
        });
    }

    // ─ _paged.md 自動検出 ─
    // PDFのみドロップ時: {basename}_paged.md があればFAX番号抽出に使用
    let pagedMdFile = null;
    if (!mdFile) {
        pagedMdFile = findPagedMarkdownForPdfs(attachPdfs);
        if (pagedMdFile) {
            console.log(`[FAX] _paged.md を検出: ${path.basename(pagedMdFile)}`);
        }
    }

    // ─ 設定読み込み ─
    const config = loadConfig();
    const mailConfig = config?.mail;
    const mfaxConfig = config?.mfax;
    if (!mailConfig?.user || !mailConfig?.password) {
        console.error('[エラー] config.json に mail 設定が見つかりません。');
        return;
    }
    if (!mfaxConfig?.sendPassword) {
        console.error('[エラー] config.json に mfax.sendPassword が見つかりません。');
        return;
    }

    const fromAddress = mfaxConfig.fromAddress || mailConfig.user;
    const sendPassword = mfaxConfig.sendPassword;

    // ─ FAX番号抽出 ─
    let faxNumbers = [];
    const faxMdSource = mdFile || pagedMdFile;
    if (faxMdSource) {
        const mdContent = fs.readFileSync(faxMdSource, 'utf-8');
        faxNumbers = extractFaxNumbers(mdContent, { fromReceipt: !!pagedMdFile && !mdFile });
        if (faxNumbers.length === 0) {
            console.log('[FAX] MDファイルからFAX番号を検出できませんでした。プレビュー画面で入力してください。');
        }
    } else if (process.stdin.isTTY) {
        // CLIモード: プレビュー画面がないので従来通りプロンプト
        console.log('[FAX] 送付書が指定されていないため、FAX番号を手動入力します。');
        const faxInput = await askPrompt('送信先FAX番号を入力してください（例: 03-1234-5678）');
        if (!faxInput) {
            console.error('[エラー] FAX番号が入力されませんでした。');
            return;
        }
        const faxNum = faxInput.replace(/[^\d]/g, '');
        if (faxNum.length < 10) {
            console.error(`[エラー] FAX番号が短すぎます: ${faxInput}`);
            return;
        }
        faxNumbers.push({ label: '手動入力', name: faxInput, number: faxNum });
    } else {
        // GUIモード: プレビュー画面で入力させる
        console.log('[FAX] FAX番号はプレビュー画面で入力してください。');
    }

    // ─ 送付書MD→PDF変換 ─
    registerJapaneseFonts();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfax_'));
    const coverPdfPath  = path.join(tmpDir, 'cover.pdf');
    const mergedPdfPath = path.join(tmpDir, 'fax_merged.pdf');
    const faxPdfPath    = path.join(tmpDir, 'fax_binarized.pdf');

    try {
        if (mdFile) {
            console.log(`[FAX] 送付書PDFを生成中: ${path.basename(mdFile)}`);
            await convertMdToPdf(mdFile, coverPdfPath);
            if (!fs.existsSync(coverPdfPath)) {
                throw new Error('送付書PDFの生成に失敗しました。');
            }

            // ─ PDF結合（送付書 + 添付PDF全件）─
            console.log(`[FAX] PDFを結合中...`);
            await mergePdfs([coverPdfPath, ...attachPdfs], mergedPdfPath);
        } else {
            // 送付書なし: PDF全件を指定順に使用
            if (attachPdfs.length === 1) {
                fs.copyFileSync(attachPdfs[0], mergedPdfPath);
            } else {
                console.log(`[FAX] PDFを結合中...`);
                await mergePdfs(attachPdfs, mergedPdfPath);
            }
        }

        // ─ 二値化 ─
        const modeMsg = noDither ? 'auto (ディザリングOFF)' : 'auto';
        console.log(`[FAX] FAX用に二値化中 (${FAX_DPI}dpi, mode=${modeMsg})...`);
        const { previewPaths, rawPaths, ditherStatus, pageDims } = await binarizePdfForFax(mergedPdfPath, tmpDir, noDither);

        // ─ プレビュー＋送信確認 ─
        const result: { confirmed: boolean; faxNumbers: any[] } = await askPreviewConfirm(faxNumbers, previewPaths, rawPaths, ditherStatus);
        if (!result.confirmed || result.faxNumbers.length === 0) {
            if (result.confirmed && result.faxNumbers.length === 0) {
                console.log('[エラー] FAX番号が指定されていません。');
            } else {
                console.log('キャンセルしました。');
            }
            return;
        }
        faxNumbers = result.faxNumbers;

        // ─ 確定したプレビューからFAX PDFを生成 ─
        console.log('[FAX] FAX PDF を生成中...');
        await buildFaxPdf(previewPaths, pageDims, faxPdfPath);

        const mergedPdfBytes = fs.readFileSync(faxPdfPath);
        const attachFilename = createFaxAttachmentFilename(attachPdfs);

        const transporter = nodemailer.createTransport({
            host: mailConfig.smtp.host,
            port: mailConfig.smtp.port,
            secure: mailConfig.smtp.secure,
            tls: { minVersion: mailConfig.smtp.tlsMinVersion || 'TLSv1.2' },
            auth: {
                user: mailConfig.user,
                pass: mailConfig.password
            }
        });

        // ─ 宛先ごとに個別送信 ─
        for (let i = 0; i < faxNumbers.length; i++) {
            const { label, name, number: faxNum } = faxNumbers[i];
            const toAddress = `${faxNum}@mfax.jp`;
            console.log(`[FAX ${i + 1}/${faxNumbers.length}] ${formatFaxDestination({ label, name })} → ${toAddress}`);

            const mailOptions = {
                from: fromAddress,
                to: toAddress,
                subject: sendPassword,
                text: '',
                attachments: [
                    {
                        filename: attachFilename,
                        content: mergedPdfBytes
                    }
                ]
            };

            let info;
            try {
                info = await transporter.sendMail(mailOptions);
            } catch (error) {
                throw toMailServerError(error, {
                    protocol: 'SMTP',
                    action: 'FAX送信用メールの送信',
                    settingPath: 'mail.smtp',
                    host: mailConfig.smtp.host,
                    port: mailConfig.smtp.port,
                    secure: mailConfig.smtp.secure,
                });
            }
            console.log(`[FAX ${i + 1}/${faxNumbers.length}] 送信完了: ${info.messageId}`);

            // 全件IMAPに保存
            const rawMessage = await new Promise((resolve, reject) => {
                const mail = nodemailer.createTransport({ streamTransport: true });
                mail.sendMail(mailOptions, (err, info) => {
                    if (err) return reject(err);
                    const chunks = [];
                    info.message.on('data', c => chunks.push(c));
                    info.message.on('end', () => resolve(Buffer.concat(chunks)));
                    info.message.on('error', reject);
                });
            });
            console.log(`[IMAP] 送信済みメールを保存中...`);
            await saveToSent(rawMessage, mailConfig);
        }

        transporter.close();

        console.log('\n✅ FAX送信が完了しました。');
        for (let i = 0; i < faxNumbers.length; i++) {
            const { label, name, number } = faxNumbers[i];
            console.log(`   ${i + 1}. ${formatFaxDestination({ label, name })}  (${number})`);
        }
        console.log(`   添付: ${attachFilename} (${(mergedPdfBytes.length / 1024).toFixed(1)} KB)`);
        if (attachPdfs.length > 1) {
            console.log('   結合順:');
            attachPdfs.forEach((pdfPath, i) => {
                console.log(`     ${i + 1}. ${path.basename(pdfPath)}`);
            });
        }

    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
    }
}

if (require.main === module) {
    main().then(() => {
        process.exit(0);
    }).catch(err => {
        console.error(`[エラー] ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    wrapMarkdownInHtml,
    extractFaxNumbers,
    mergePdfs,
    classifyFaxInputFiles,
    createFaxAttachmentFilename,
    findPagedMarkdownForPdfs,
    describeMailServerError,
};
