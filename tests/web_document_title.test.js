const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildPdfDocumentTitle,
    extractMarkdownDocumentTitle,
    sanitizeDownloadTitle,
} = require('../dist/src/web/document_title.js');

test('extractMarkdownDocumentTitle: uses the first level-1 heading', () => {
    assert.equal(extractMarkdownDocumentTitle('## 見出し\n# 準備書面\n本文'), '準備書面');
});

test('extractMarkdownDocumentTitle: ignores headings inside fenced code blocks', () => {
    const markdown = '```\n# コード内\n```\n# 訴状';
    assert.equal(extractMarkdownDocumentTitle(markdown), '訴状');
});

test('sanitizeDownloadTitle: removes filename-unsafe characters', () => {
    assert.equal(sanitizeDownloadTitle('訴状/答弁書:第1*版?'), '訴状 答弁書 第1 版');
});

test('buildPdfDocumentTitle: falls back when no title exists', () => {
    assert.equal(buildPdfDocumentTitle('## 第1 請求の趣旨'), '法匪 PDF');
});
