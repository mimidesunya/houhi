const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeEditableMarkdown } = require('../dist/src/web/markdown_normalizer.js');

test('normalizeEditableMarkdown: converts non-reserved ### headings to ##', () => {
    assert.equal(normalizeEditableMarkdown('### 申立ての理由'), '## 申立ての理由');
});

test('normalizeEditableMarkdown: converts deeper markdown headings to ##', () => {
    assert.equal(normalizeEditableMarkdown('#### (1) 詳細'), '## (1) 詳細');
});

test('normalizeEditableMarkdown: preserves reserved ### hyphen markers', () => {
    const markdown = [
        '### --目次',
        '### --右',
        '### --',
        '### -- 別紙 --',
        '### ---',
        '### -',
    ].join('\n');

    assert.equal(normalizeEditableMarkdown(markdown), markdown);
});

test('normalizeEditableMarkdown: preserves indentation when converting', () => {
    assert.equal(normalizeEditableMarkdown('  ### 小見出し'), '  ## 小見出し');
});
