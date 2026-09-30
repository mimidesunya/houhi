const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const {
    wrapMarkdownInHtml,
    extractFaxNumbers,
    mergePdfs,
    classifyFaxInputFiles,
    createFaxAttachmentFilename,
    findPagedMarkdownForPdfs,
    getFaxSendConfiguration,
    normalizeFaxProvider,
    checkByosokuFromAddress,
    planFaxChunks,
    buildFaxMailOptions,
    chunkAttachmentFilename,
    buildFaxPdfParts,
    isBlankFaxPage,
    findBlankFaxPages,
    describeMailServerError,
    main,
} = require('../dist/src/fax_send.js');

// ─── wrapMarkdownInHtml ─────────────────────────────────────

test('wrapMarkdownInHtml: returns valid HTML with default title', () => {
    const html = wrapMarkdownInHtml('# Test', undefined);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<title>裁判文書</title>'));
    assert.ok(html.includes('# Test'));
    assert.ok(html.includes('<pre>'));
    assert.ok(html.includes('court_markdown.js'));
    assert.ok(html.includes('style.css'));
});

test('wrapMarkdownInHtml: uses custom title', () => {
    const html = wrapMarkdownInHtml('body', '送付書');
    assert.ok(html.includes('<title>送付書</title>'));
});

test('wrapMarkdownInHtml: preserves markdown content inside pre tag', () => {
    const md = '### --左\n被告 山田太郎\n(FAX 0312345678)';
    const html = wrapMarkdownInHtml(md, '送付書');
    assert.ok(html.includes('### --左'));
    assert.ok(html.includes('(FAX 0312345678)'));
});

// ─── input file handling ─────────────────────────────────────

test('classifyFaxInputFiles: keeps multiple PDFs in argument order', (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-fax-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const md = path.join(tempRoot, '送付書.md');
    const first = path.join(tempRoot, '01.pdf');
    const second = path.join(tempRoot, '02.pdf');
    fs.writeFileSync(md, '# 送付書');
    fs.writeFileSync(first, Buffer.alloc(1));
    fs.writeFileSync(second, Buffer.alloc(1));

    const result = classifyFaxInputFiles([md, first, second]);
    assert.equal(result.mdFile, path.resolve(md));
    assert.deepEqual(result.attachPdfs, [path.resolve(first), path.resolve(second)]);
});

test('createFaxAttachmentFilename: names merged PDF from first file', () => {
    const result = createFaxAttachmentFilename([
        path.join('docs', '01_申立書.pdf'),
        path.join('docs', '02_資料.pdf'),
        path.join('docs', '03_別紙.pdf'),
    ]);
    assert.equal(result, '01_申立書_ほか2件.pdf');
});

test('findPagedMarkdownForPdfs: returns first matching _paged.md', (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-fax-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const first = path.join(tempRoot, 'a.pdf');
    const second = path.join(tempRoot, 'b.pdf');
    const paged = path.join(tempRoot, 'b_paged.md');
    fs.writeFileSync(first, Buffer.alloc(1));
    fs.writeFileSync(second, Buffer.alloc(1));
    fs.writeFileSync(paged, '# 受領書');

    assert.equal(findPagedMarkdownForPdfs([first, second]), paged);
});

test('getFaxSendConfiguration: explains missing settings and that PDF processing has not started', () => {
    assert.throws(() => getFaxSendConfiguration(null, {
        configPath: 'C:\\portable\\houhi\\config.json',
        searchStartDirs: ['C:\\portable\\houhi', 'C:\\portable\\houhi\\app\\dist\\src'],
    }), error => {
        assert.match(error.message, /FAX送信設定が不足しています/);
        assert.match(error.message, /PDFファイルの読込・結合・二値化は開始していません/);
        assert.match(error.message, /C:\\portable\\houhi\\config\.json/);
        assert.match(error.message, /探索起点（各親フォルダも確認）/);
        assert.match(error.message, /mail\.user/);
        assert.match(error.message, /mfax\.sendPassword/);
        assert.match(error.message, /HOUHIの「設定」を開いて/);
        return true;
    });

    const result = getFaxSendConfiguration({
        mail: { user: 'sender@example.test', password: 'secret' },
        mfax: { sendPassword: 'fax-secret', fromAddress: 'fax@example.test' },
    });
    assert.equal(result.mailConfig.user, 'sender@example.test');
    assert.equal(result.fromAddress, 'fax@example.test');
    assert.equal(result.sendPassword, 'fax-secret');
});

// ─── 秒速FAX ─────────────────────────────────────────────────

const byosokuBaseConfig = {
    mail: { user: 'sender@example.test', password: 'secret' },
    fax: { provider: 'byosoku' },
    byosokuFax: { sendAddress: 'send-123@fax.example.test' },
};

test('normalizeFaxProvider: defaults to mfax and accepts byosoku aliases', () => {
    assert.equal(normalizeFaxProvider(undefined), 'mfax');
    assert.equal(normalizeFaxProvider('MFAX'), 'mfax');
    assert.equal(normalizeFaxProvider('byosoku'), 'byosoku');
    assert.equal(normalizeFaxProvider('秒速FAX'), 'byosoku');
    assert.throws(() => normalizeFaxProvider('efax'), /mfax または byosoku/);
});

test('getFaxSendConfiguration: byosoku requires a real send address', () => {
    assert.throws(() => getFaxSendConfiguration({
        mail: { user: 'sender@example.test', password: 'secret' },
        fax: { provider: 'byosoku' },
        byosokuFax: { sendAddress: 'YOUR_BYOSOKU_SEND_ADDRESS' },
    }, { configPath: 'config.json', searchStartDirs: ['C:\\houhi'] }), error => {
        assert.match(error.message, /送信サービス: 秒速FAX/);
        assert.match(error.message, /byosokuFax\.sendAddress/);
        assert.doesNotMatch(error.message, /mfax\.sendPassword/);
        return true;
    });
});

test('getFaxSendConfiguration: byosoku uses mail.user as sender and default limits', () => {
    const result = getFaxSendConfiguration(byosokuBaseConfig);
    assert.equal(result.provider, 'byosoku');
    assert.equal(result.fromAddress, 'sender@example.test');
    assert.equal(result.sendAddress, 'send-123@fax.example.test');
    assert.equal(result.maxPagesPerMail, 10);
    assert.equal(result.maxBytesPerMail, 1000000);
});

test('getFaxSendConfiguration: provider override switches from mfax to byosoku', () => {
    const result = getFaxSendConfiguration({ ...byosokuBaseConfig, fax: { provider: 'mfax' } }, { provider: 'byosoku' });
    assert.equal(result.provider, 'byosoku');
});

test('getFaxSendConfiguration: rejects sender addresses byosoku cannot accept', () => {
    assert.throws(() => getFaxSendConfiguration({
        ...byosokuBaseConfig,
        byosokuFax: { sendAddress: 'send-123@fax.example.test', fromAddress: 'me+fax@example.test' },
    }), /「!」「\+」「\*」は使えません/);
});

test('checkByosokuFromAddress: enforces length and characters', () => {
    assert.equal(checkByosokuFromAddress('tm@jigensha.info'), null);
    assert.match(checkByosokuFromAddress(`${'a'.repeat(45)}@example.test`), /50文字/);
    assert.match(checkByosokuFromAddress('日本語@example.test'), /半角英数記号/);
    assert.match(checkByosokuFromAddress('not-an-address'), /形式/);
});

test('planFaxChunks: splits by page count', () => {
    const chunks = planFaxChunks(Array(14).fill(50000), { maxPages: 10, maxBytes: 1000000 });
    assert.deepEqual(chunks.map(c => c.length), [10, 4]);
    assert.deepEqual(chunks.flat(), Array.from({ length: 14 }, (_v, i) => i));
});

test('planFaxChunks: splits by size while keeping page order', () => {
    const chunks = planFaxChunks(Array(7).fill(300000), { maxPages: 10, maxBytes: 1000000 });
    assert.deepEqual(chunks, [[0, 1, 2], [3, 4, 5], [6]]);
});

test('planFaxChunks: refuses a single page larger than the limit', () => {
    assert.throws(() => planFaxChunks([100, 2000000], { maxPages: 10, maxBytes: 1000000 }), /2頁目だけで/);
});

test('buildFaxMailOptions: byosoku sends to the send address with the FAX number as subject', () => {
    const content = Buffer.from('%PDF');
    const byosoku = buildFaxMailOptions(
        { provider: 'byosoku', fromAddress: 'tm@example.test', sendAddress: 'send-123@fax.example.test' },
        { faxNumber: '0332001234', filename: 'a.pdf', content }
    );
    assert.equal(byosoku.to, 'send-123@fax.example.test');
    assert.equal(byosoku.subject, '0332001234');
    assert.equal(byosoku.text, '');
    assert.equal(byosoku.from, 'tm@example.test');
    assert.equal(byosoku.attachments.length, 1);

    const mfax = buildFaxMailOptions(
        { provider: 'mfax', fromAddress: 'tm@example.test', sendPassword: 'pw' },
        { faxNumber: '0332001234', filename: 'a.pdf', content }
    );
    assert.equal(mfax.to, '0332001234@mfax.jp');
    assert.equal(mfax.subject, 'pw');
});

test('chunkAttachmentFilename: numbers split attachments only', () => {
    assert.equal(chunkAttachmentFilename('送付書.pdf', 0, 1), '送付書.pdf');
    assert.equal(chunkAttachmentFilename('送付書.pdf', 1, 2), '送付書_2of2.pdf');
});

test('buildFaxPdfParts: every part stays within page and byte limits', async (t) => {
    const { createCanvas } = require('@napi-rs/canvas');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-fax-parts-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    // 白黒ノイズの頁（圧縮が効かず大きい）と白紙の頁（小さい）を混ぜる
    const previewPaths = [];
    const pageDims = [];
    for (let n = 0; n < 5; n++) {
        const canvas = createCanvas(300, 300);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 300, 300);
        if (n % 2 === 0) {
            const img = ctx.getImageData(0, 0, 300, 300);
            for (let i = 0; i < img.data.length; i += 4) {
                const v = Math.random() < 0.5 ? 0 : 255;
                img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
            }
            ctx.putImageData(img, 0, 0);
        }
        const p = path.join(tempRoot, `preview_${n + 1}.png`);
        fs.writeFileSync(p, canvas.toBuffer('image/png'));
        previewPaths.push(p);
        pageDims.push({ pageW: 595.28, pageH: 841.89, x: 0, y: 0, width: 595.28, height: 841.89 });
    }

    // 1頁ずつのPDFの大きさを実測し、ノイズ頁2枚は入らないが1枚なら入る上限にする
    const singles = await buildFaxPdfParts(previewPaths, pageDims, tempRoot, { maxPages: 1, maxBytes: 50000000 });
    const largest = Math.max(...singles.map(p => p.bytes.length));
    const maxBytes = Math.floor(largest * 1.5);
    const parts = await buildFaxPdfParts(previewPaths, pageDims, tempRoot, { maxPages: 2, maxBytes });
    assert.ok(parts.length >= 3);
    assert.deepEqual(parts.flatMap(p => p.pages), [0, 1, 2, 3, 4]);
    for (const part of parts) {
        assert.ok(part.pages.length <= 2);
        assert.ok(part.bytes.length <= maxBytes, `part of ${part.bytes.length} bytes exceeds ${maxBytes}`);
        const pdf = await PDFDocument.load(part.bytes);
        assert.equal(pdf.getPageCount(), part.pages.length);
    }
});

test('findBlankFaxPages: reports all-white pages by page number', async (t) => {
    const { createCanvas } = require('@napi-rs/canvas');
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-fax-blank-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    function writePage(name, withMark) {
        const canvas = createCanvas(200, 280);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 200, 280);
        if (withMark) {
            ctx.fillStyle = '#000';
            ctx.fillRect(100, 140, 1, 1);
        }
        const p = path.join(tempRoot, name);
        fs.writeFileSync(p, canvas.toBuffer('image/png'));
        return p;
    }

    const marked = writePage('p1.png', true);
    const blank = writePage('p2.png', false);
    assert.equal(await isBlankFaxPage(marked), false);
    assert.equal(await isBlankFaxPage(blank), true);
    assert.deepEqual(await findBlankFaxPages([marked, blank, marked]), [2]);
});

test('main: stops before reading an invalid PDF when FAX settings are missing', async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-fax-preflight-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const inputPath = path.join(tempRoot, 'input.pdf');
    fs.writeFileSync(inputPath, Buffer.from('not a PDF'));

    const errors = [];
    const originalConsoleError = console.error;
    console.error = (...parts) => errors.push(parts.join(' '));
    try {
        await main({
            args: ['--no-dither', inputPath],
            loadConfig: () => null,
            configPath: null,
            configSearchStartDirs: ['C:\\portable\\houhi'],
        });
    } finally {
        console.error = originalConsoleError;
    }

    assert.match(errors.join('\n'), /\[設定エラー\]/);
    assert.match(errors.join('\n'), /PDFファイルの読込・結合・二値化は開始していません/);
    assert.match(errors.join('\n'), /config\.json は見つかりませんでした/);
});

test('describeMailServerError: explains expired SMTP certificate context', () => {
    const message = describeMailServerError(
        Object.assign(new Error('Certificate was expired'), { code: 'CERT_HAS_EXPIRED' }),
        {
            protocol: 'SMTP',
            action: 'FAX送信用メールの送信',
            settingPath: 'mail.smtp',
            host: 'smtp.example.test',
            port: 465,
            secure: true,
        }
    );

    assert.ok(message.includes('[SMTP/TLS] FAX送信用メールの送信に失敗しました。'));
    assert.ok(message.includes('mail.smtp.host (smtp.example.test:465, secure=true)'));
    assert.ok(message.includes('mfax送信パスワード'));
    assert.ok(message.includes('メールサーバーとの暗号化接続'));
    assert.ok(message.includes('元のエラー: Certificate was expired'));
});

test('describeMailServerError: preserves non-certificate errors', () => {
    const message = describeMailServerError(new Error('Invalid login'), {
        protocol: 'SMTP',
        action: 'FAX送信用メールの送信',
        settingPath: 'mail.smtp',
        host: 'smtp.example.test',
        port: 465,
        secure: true,
    });

    assert.equal(message, 'Invalid login');
});

test('mergePdfs: appends multiple PDFs in supplied order', async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-fax-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    async function writePdf(filePath, size) {
        const pdf = await PDFDocument.create();
        pdf.addPage(size);
        fs.writeFileSync(filePath, await pdf.save());
    }

    const first = path.join(tempRoot, 'first.pdf');
    const second = path.join(tempRoot, 'second.pdf');
    const output = path.join(tempRoot, 'merged.pdf');
    await writePdf(first, [123, 456]);
    await writePdf(second, [234, 567]);

    await mergePdfs([first, second], output);
    const merged = await PDFDocument.load(fs.readFileSync(output));
    const pages = merged.getPages();

    assert.equal(pages.length, 2);
    assert.equal(pages[0].getWidth(), 123);
    assert.equal(pages[0].getHeight(), 456);
    assert.equal(pages[1].getWidth(), 234);
    assert.equal(pages[1].getHeight(), 567);
});

// ─── extractFaxNumbers ──────────────────────────────────────

test('extractFaxNumbers: extracts FAX from --左 block before receipt', () => {
    const md = [
        '# 送付書',
        '### --左',
        '被告 山田太郎 御中',
        '(FAX 03-1234-5678)',
        '### --右',
        '原告 佐藤花子',
    ].join('\n');
    const result = extractFaxNumbers(md);
    assert.equal(result.length, 1);
    assert.equal(result[0].number, '0312345678');
    assert.equal(result[0].label, '相手方');
});

test('extractFaxNumbers: extracts multiple FAX numbers from same block', () => {
    const md = [
        '# 送付書',
        '### --左',
        '被告 山田太郎 御中',
        '(FAX 03-1234-5678)',
        '被告 田中次郎 御中',
        '(FAX 03-9999-8888)',
        '### --右',
    ].join('\n');
    const result = extractFaxNumbers(md);
    assert.equal(result.length, 2);
    assert.equal(result[0].number, '0312345678');
    assert.equal(result[1].number, '0399998888');
});

test('extractFaxNumbers: extracts court FAX from after receipt heading', () => {
    const md = [
        '# 送付書',
        '### --左',
        '被告 山田太郎 御中',
        '(FAX 03-1234-5678)',
        '### --右',
        '原告 佐藤花子',
        '# 受領書',
        '### --左',
        '東京地方裁判所 御中',
        '(FAX 03-5555-6666)',
        '### --右',
    ].join('\n');
    const result = extractFaxNumbers(md);
    assert.equal(result.length, 2);
    // 相手方
    assert.equal(result[0].label, '相手方');
    assert.equal(result[0].number, '0312345678');
    // 裁判所
    assert.equal(result[1].label, '裁判所');
    assert.equal(result[1].number, '0355556666');
});

test('extractFaxNumbers: deduplicates same FAX number', () => {
    const md = [
        '# 送付書',
        '### --左',
        '相手方A 御中',
        '(FAX 03-1234-5678)',
        '### --左',
        '相手方A 御中',
        '(FAX 03-1234-5678)',
        '### --右',
    ].join('\n');
    const result = extractFaxNumbers(md);
    assert.equal(result.length, 1);
});

test('extractFaxNumbers: returns empty for no FAX numbers', () => {
    const md = '# 送付書\n### --左\n相手方\n### --右\n';
    const result = extractFaxNumbers(md);
    assert.equal(result.length, 0);
});

test('extractFaxNumbers: handles full-width parentheses', () => {
    const md = [
        '# 送付書',
        '### --左',
        '被告 御中',
        '（FAX 03-1234-5678）',
    ].join('\n');
    const result = extractFaxNumbers(md);
    assert.equal(result.length, 1);
    assert.equal(result[0].number, '0312345678');
});

test('extractFaxNumbers: fromReceipt mode extracts from receipt section', () => {
    const md = [
        '# 送付書',
        '### --左',
        '被告 御中',
        '(FAX 03-1234-5678)',
        '# 受領書',
        '### --左',
        '裁判所 御中',
        '(FAX 03-5555-6666)',
    ].join('\n');
    const result = extractFaxNumbers(md, { fromReceipt: true });
    assert.equal(result.length, 1);
    assert.equal(result[0].number, '0355556666');
});

test('extractFaxNumbers: fromReceipt returns empty if no receipt heading', () => {
    const md = [
        '# 送付書',
        '### --左',
        '被告 御中',
        '(FAX 03-1111-2222)',
    ].join('\n');
    const result = extractFaxNumbers(md, { fromReceipt: true });
    assert.equal(result.length, 0);
});

test('extractFaxNumbers: extracts name from preceding text line', () => {
    const md = [
        '# 送付書',
        '### --左',
        '株式会社テスト 御中',
        '(FAX 03-1111-2222)',
    ].join('\n');
    const result = extractFaxNumbers(md);
    assert.equal(result[0].name, '株式会社テスト 御中');
});

test('extractFaxNumbers: uses same-line prefix as name', () => {
    const md = [
        '# 送付書',
        '### --左',
        '被告側 (FAX 03-1111-2222)',
    ].join('\n');
    const result = extractFaxNumbers(md);
    assert.equal(result[0].name, '被告側');
});
