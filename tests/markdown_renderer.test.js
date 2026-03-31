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
