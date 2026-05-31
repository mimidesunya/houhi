const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { renderPreTags } = require('../dist/src/lib/markdown_renderer.js');

// ─── renderPreTags: basic rendering ─────────────────────────

test('renderPreTags: converts <pre> with markdown to div', () => {
    const html = '<pre>## 第1 概要\n\nテスト本文</pre>';
    const result = renderPreTags(html);
    assert.ok(!result.includes('<pre>'));
    assert.ok(result.includes('content-container'));
    assert.ok(result.includes('</div>'));
});

test('renderPreTags: preserves empty <pre> tags unchanged', () => {
    const html = '<pre>   </pre>';
    const result = renderPreTags(html);
    assert.equal(result, html);
});

test('renderPreTags: preserves original class on pre tag', () => {
    const html = '<pre class="my-class">テスト</pre>';
    const result = renderPreTags(html);
    assert.ok(result.includes('my-class'));
    assert.ok(result.includes('content-container'));
});

test('renderPreTags: handles multiple <pre> tags', () => {
    const html = '<pre>テスト1</pre><p>中間</p><pre>テスト2</pre>';
    const result = renderPreTags(html);
    const divCount = (result.match(/content-container/g) || []).length;
    assert.equal(divCount, 2);
});

// ─── renderPreTags: data-src ────────────────────────────────

test('renderPreTags: loads external file via data-src', (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-md-'));
    t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

    fs.writeFileSync(path.join(tmpDir, 'test.md'), '# テスト見出し\n\n本文です。', 'utf8');

    const html = '<pre data-src="test.md"></pre>';
    const result = renderPreTags(html, tmpDir);
    assert.ok(result.includes('content-container'));
    // The rendered result should include content from the external file
    assert.ok(!result.includes('data-src'));
});

test('renderPreTags: falls back to inline content when data-src file missing', () => {
    const html = '<pre data-src="missing.md">フォールバック内容</pre>';
    const result = renderPreTags(html, '/nonexistent/dir');
    assert.ok(result.includes('content-container'));
});

test('renderPreTags: data-src without baseDir uses inline content', () => {
    const html = '<pre data-src="test.md">インライン内容</pre>';
    const result = renderPreTags(html); // no baseDir
    assert.ok(result.includes('content-container'));
});

// ─── renderPreTags: no pre tags ─────────────────────────────

test('renderPreTags: returns unchanged HTML with no pre tags', () => {
    const html = '<div>テスト</div><p>段落</p>';
    const result = renderPreTags(html);
    assert.equal(result, html);
});

test('src/base/sample.md: follows preparation brief drafting syntax rules', () => {
    const sample = fs.readFileSync(path.resolve('src/base/sample.md'), 'utf-8');
    const alignmentBlocks = sample.match(/### --[左右]\r?\n[\s\S]*?\r?\n### --/g) || [];

    assert.ok(alignmentBlocks.length > 0);
    for (const block of alignmentBlocks) {
        assert.equal(/\r?\n\s*\r?\n/.test(block), false);
        assert.equal(/^\* /m.test(block), false);
        assert.equal(/^- [^:\r\n]+：/m.test(block), false);
    }

    assert.equal(/〒\d{3}-\d{4}/.test(sample), false);
    assert.equal(/東京都千代田区|丸の内|送達場所/.test(sample), false);
    assert.match(sample, /^# 準備書面$/m);
    assert.match(sample, /^## 第1　/m);
    assert.match(sample, /^1　/m);
    assert.match(sample, /^## 附属書類$/m);
    assert.match(sample, /^- 準備書面副本：1通$/m);
});

test('src/base/court_doc_rules.md: gives unambiguous heading instructions to AI', () => {
    const rules = fs.readFileSync(path.resolve('src/base/court_doc_rules.md'), 'utf-8');

    assert.match(rules, /Never output `###` or `####` as a normal section heading/);
    assert.match(rules, /Use `##` for every normal section heading/);
    assert.match(rules, /Use `#` only for the document title/);
    assert.match(rules, /Before finalizing output, scan every line that starts with `#`/);
});

test('drafting templates: use ## for regular section headings', () => {
    const files = [
        path.resolve('src/base/sample.md'),
        ...fs.readdirSync(path.resolve('src/templates'))
            .filter(file => file.endsWith('.md'))
            .map(file => path.resolve('src/templates', file))
    ];

    const forbiddenHeading = /^#{3,6}\s+(?!-{2}|---|\.{3}|目次\b).+/gm;
    const singleHashMarkerHeading = /^#\s+(?:第[0-9]+|[0-9]+[　\s]|\([0-9]+\)|[ア-ン][　\s]|\([ア-ン]\)|[a-z][　\s]|\([a-z]\)).*/gm;
    const failures = [];

    for (const file of files) {
        const markdown = fs.readFileSync(file, 'utf-8');
        for (const match of markdown.matchAll(forbiddenHeading)) {
            failures.push(`${path.relative(process.cwd(), file)}: use ## instead of ${match[0]}`);
        }
        for (const match of markdown.matchAll(singleHashMarkerHeading)) {
            failures.push(`${path.relative(process.cwd(), file)}: marker heading must use ##: ${match[0]}`);
        }
    }

    assert.deepEqual(failures, []);
});
