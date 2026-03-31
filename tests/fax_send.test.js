const test = require('node:test');
const assert = require('node:assert/strict');

const { wrapMarkdownInHtml, extractFaxNumbers } = require('../dist/src/fax_send.js');

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
