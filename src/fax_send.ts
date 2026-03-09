/**
 * mfaxメールFAX送信ツール
 *
 * 使い方:
 *   node src/fax_send.js <YYYY-MM-DD-送付書.md> <添付PDF>
 *   node src/fax_send.js <添付PDF>              ← 送付書なし（FAX番号を手入力）
 *
 * 動作:
 *   1. 送付書.mdをPDF化（送付書がある場合）
 *   2. 送付書PDF + 添付PDFを結合（送付書がある場合）
 *   3. 送付書.mdからFAX番号を抽出 (FAX XXXXXXXXXX)、または手入力
 *   4. {FAX番号}@mfax.jp 宛にメール送信（本文空、PDFを添付）
 *   5. 送信済みメールをIMAPのSentフォルダに保存
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, registerFont } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { loadConfig } = require('./lib/gemini_client');
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

// ─── FAX二値化 ───────────────────────────────────────────────

const FAX_DPI = 200;
const FAX_THRESHOLD = 170;

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

class SafeCanvasFactory {
    create(w, h) {
        const canvas = createCanvas(Math.ceil(w), Math.ceil(h));
        return { canvas, context: canvas.getContext('2d') };
    }
    reset(cc, w, h) { if (cc?.canvas) { cc.canvas.width = Math.ceil(w); cc.canvas.height = Math.ceil(h); } }
    destroy(cc) { if (cc) { cc.canvas = null; cc.context = null; } }
}

function toFaxBinary(imageData, threshold) {
    const px = imageData.data;
    for (let i = 0; i < px.length; i += 4) {
        const v = (0.299 * px[i] + 0.587 * px[i+1] + 0.114 * px[i+2]) >= threshold ? 255 : 0;
        px[i] = px[i+1] = px[i+2] = v; px[i+3] = 255;
    }
}

async function binarizePdfForFax(inputPath, outputPath) {
    const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
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

    const out = await PDFDocument.create();
    const scale = FAX_DPI / 72;

    for (let n = 1; n <= src.numPages; n++) {
        const page = await src.getPage(n);
        const vpOrig = page.getViewport({ scale: 1 });
        const vpRender = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(vpRender.width), Math.ceil(vpRender.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vpRender,
            canvasFactory: new SafeCanvasFactory(), background: 'rgb(255,255,255)' }).promise;
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        toFaxBinary(imgData, FAX_THRESHOLD);
        ctx.putImageData(imgData, 0, 0);
        const img = await out.embedPng(canvas.toBuffer('image/png'));
        const p = out.addPage([vpOrig.width, vpOrig.height]);
        p.drawImage(img, { x: 0, y: 0, width: vpOrig.width, height: vpOrig.height });
        console.log(`[二値化] ${n}/${src.numPages} ページ`);
        if (typeof page.cleanup === 'function') page.cleanup();
    }
    if (typeof src.cleanup === 'function') src.cleanup();

    fs.writeFileSync(outputPath, await out.save({ useObjectStreams: false }));
}

// ─── FAX番号抽出 ──────────────────────────────────────────────

/**
 * 送付書MDから送信先2件を確定的に抽出する。
 *   1. 相手方: 文書冒頭の最初の「### --左」ブロック内の最初の (FAX ...)
 *   2. 裁判所: 「# 受領書」以降の最初の「### --左」ブロック内の最初の (FAX ...)
 */
function extractFaxNumbers(mdContent) {
    const lines = mdContent.split('\n').map(l => l.trim());
    const results = [];

    // ブロック内の最初のFAX番号と直前ラベルを取得するヘルパー
    function firstFaxInBlock(startIdx) {
        let lastLabel = '';
        for (let i = startIdx; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('### --')) break; // ブロック終端
            const m = line.match(/\(FAX\s+([\d\-\(\)\s]+)\)/);
            if (m) {
                const num = m[1].replace(/[^\d]/g, '');
                if (num) return { name: lastLabel, number: num };
            } else if (line !== '') {
                lastLabel = line;
            }
        }
        return null;
    }

    // 1. 相手方: 最初の「### --左」ブロック
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '### --左') {
            const hit = firstFaxInBlock(i + 1);
            if (hit) { results.push({ label: '相手方', ...hit }); }
            break;
        }
    }

    // 2. 裁判所: 「# 受領書」以降の最初の「### --左」ブロック
    let inReceipt = false;
    for (let i = 0; i < lines.length; i++) {
        if (!inReceipt && lines[i] === '# 受領書') { inReceipt = true; continue; }
        if (inReceipt && lines[i] === '### --左') {
            const hit = firstFaxInBlock(i + 1);
            if (hit) { results.push({ label: '裁判所', ...hit }); }
            break;
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

    await client.connect();
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
        await client.logout();
    }
}

// ─── メイン ──────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.log('-------------------------------------------------------');
        console.log(' mfax FAX送信ツール');
        console.log(' 使い方: node fax_send.js <送付書.md> <添付PDF>');
        console.log('         node fax_send.js <添付PDF>  (送付書なし)');
        console.log(' ドロップ: YYYY-MM-DD-送付書.md と 送付するPDF をペアでドロップ');
        console.log('           または PDF のみドロップ（FAX番号を手入力）');
        console.log('-------------------------------------------------------');
        return;
    }

    // ─ ファイル分類 ─
    let mdFile = null;
    let attachPdf = null;

    for (const arg of args) {
        const abs = path.resolve(arg);
        if (!fs.existsSync(abs)) {
            console.error(`[エラー] ファイルが見つかりません: ${abs}`);
            return;
        }
        const ext = path.extname(abs).toLowerCase();
        if (ext === '.md') {
            mdFile = abs;
        } else if (ext === '.pdf') {
            attachPdf = abs;
        }
    }

    if (!attachPdf) {
        console.error('[エラー] 送信する PDF ファイルが見つかりません。');
        return;
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
    if (mdFile) {
        const mdContent = fs.readFileSync(mdFile, 'utf-8');
        faxNumbers = extractFaxNumbers(mdContent);
        if (faxNumbers.length === 0) {
            console.error('[エラー] 送付書.mdからFAX番号を抽出できませんでした。');
            console.error('         "(FAX XXXXXXXXXX)" という形式の番号が必要です。');
            return;
        }
    } else {
        // 送付書なし: ユーザーにFAX番号を入力してもらう
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
    }
    console.log('');
    console.log('┌─────────────────────────────────────────────┐');
    console.log('│  FAX送信確認                                │');
    console.log('├─────────────────────────────────────────────┤');
    const coverLabel = mdFile ? path.basename(mdFile) : '（なし）';
    console.log(`│  送付書: ${coverLabel.padEnd(36)}│`);
    console.log(`│  添付:   ${path.basename(attachPdf).padEnd(36)}│`);
    console.log('│  送信先:                                    │');
    for (let i = 0; i < faxNumbers.length; i++) {
        const { label, name, number } = faxNumbers[i];
        const nameLine = `│    ${i + 1}. [${label}] ${name}`;
        console.log(nameLine.padEnd(45) + '│');
        const numLine  = `│       ${number}`;
        console.log(numLine.padEnd(45) + '│');
    }
    console.log('└─────────────────────────────────────────────┘');
    console.log('');

    const faxList = faxNumbers.map((e, i) => `  ${i + 1}. [${e.label}] ${e.name}  (${e.number})`).join('\n');
    const confirmed = await askConfirm(`以下の宛先に FAX 送信しますか？\n${faxList}`);
    if (!confirmed) {
        console.log('キャンセルしました。');
        return;
    }
    console.log('');

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

            // ─ PDF結合（送付書 + 添付PDF）─
            console.log(`[FAX] PDFを結合中...`);
            await mergePdfs([coverPdfPath, attachPdf], mergedPdfPath);
        } else {
            // 送付書なし: 添付PDFをそのまま使用
            fs.copyFileSync(attachPdf, mergedPdfPath);
        }

        // ─ 二値化 ─
        console.log(`[FAX] FAX用に二値化中 (${FAX_DPI}dpi, threshold=${FAX_THRESHOLD})...`);
        await binarizePdfForFax(mergedPdfPath, faxPdfPath);

        const mergedPdfBytes = fs.readFileSync(faxPdfPath);
        const attachFilename = path.basename(attachPdf);

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
            console.log(`[FAX ${i + 1}/${faxNumbers.length}] [${label}] ${name} → ${toAddress}`);

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

            const info = await transporter.sendMail(mailOptions);
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
            console.log(`   ${i + 1}. [${label}] ${name}  (${number})`);
        }
        console.log(`   添付: ${attachFilename} (${(mergedPdfBytes.length / 1024).toFixed(1)} KB)`);

    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}
    }
}

main().then(() => {
    process.exit(0);
}).catch(err => {
    console.error(`[エラー] ${err.message}`);
    process.exit(1);
});
