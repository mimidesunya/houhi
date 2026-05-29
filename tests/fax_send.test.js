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
