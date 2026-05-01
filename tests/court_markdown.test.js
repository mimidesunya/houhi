const test = require('node:test');
const assert = require('node:assert/strict');

const { convertMarkdownToCourtHtml } = require('../dist/src/base/court_markdown.js');

// ─── 基本的な変換 ──────────────────────────────────────────

test('convertMarkdownToCourtHtml: converts heading to HTML', () => {
    const result = convertMarkdownToCourtHtml('# テスト見出し');
    assert.ok(result.includes('テスト見出し'));
});

test('convertMarkdownToCourtHtml: converts paragraph text', () => {
    const result = convertMarkdownToCourtHtml('これは本文のテストです。');
    assert.ok(result.includes('これは本文のテストです。'));
});

test('convertMarkdownToCourtHtml: handles empty input', () => {
    const result = convertMarkdownToCourtHtml('');
    assert.ok(typeof result === 'string');
});

test('convertMarkdownToCourtHtml: handles newlines only', () => {
    const result = convertMarkdownToCourtHtml('\n\n\n');
    assert.ok(typeof result === 'string');
});

// ─── ブロック構造 ──────────────────────────────────────────

test('convertMarkdownToCourtHtml: handles ### --右 block', () => {
    const md = '### --右\n差出人名\n### --';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
});

test('convertMarkdownToCourtHtml: handles ### --左 block', () => {
    const md = '### --左\n宛先名\n### --';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
});

// ─── テーブル変換 ──────────────────────────────────────────

test('convertMarkdownToCourtHtml: converts table syntax', () => {
    const md = '| 列1 | 列2 |\n|:---|:---|\n| データ1 | データ2 |';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('データ1'));
    assert.ok(result.includes('データ2'));
});

// ─── リストテーブル変換 ────────────────────────────────────

test('convertMarkdownToCourtHtml: converts list-style table', () => {
    const md = '- 項目名：値';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('項目名'));
    assert.ok(result.includes('値'));
});

// ─── 改ページ ──────────────────────────────────────────────

test('convertMarkdownToCourtHtml: handles page break marker', () => {
    const md = '### ---\nテキスト';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(typeof result === 'string');
});

test('convertMarkdownToCourtHtml: converts table of contents marker', () => {
    const md = [
        '### 目次',
        '',
        '## 第1 はじめに',
        '',
        '1 概要',
        '',
        '#### (1) 詳細'
    ].join('\n');
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('<div class="toc-title">目次</div>'));
    assert.ok(result.includes('<cssj:make-toc'));
    assert.ok(result.includes('<li class="heading-item">'));
    assert.ok(result.includes('<h1>第1　はじめに</h1>'));
    assert.ok(result.includes('<h2>1　概要</h2>'));
    assert.ok(result.includes('<h3>(1)　詳細</h3>'));
});

test('convertMarkdownToCourtHtml: converts first two marker levels to headings for toc', () => {
    const md = [
        '## 第1 本書面の要旨',
        '',
        '1 原告らは代表者ではない。',
        '',
        '2 任意的訴訟担当',
        '',
        '3 本文として扱われる番号行である。',
        '',
        '(1) これは本文階層である。'
    ].join('\n');
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('<h1>第1　本書面の要旨</h1>'));
    assert.ok(!result.includes('<h2>1　原告らは代表者ではない。</h2>'));
    assert.ok(result.includes('<p>原告らは代表者ではない。</p>'));
    assert.ok(result.includes('<h2>2　任意的訴訟担当</h2>'));
    assert.ok(!result.includes('<h2>3　本文として扱われる番号行である。</h2>'));
    assert.ok(result.includes('<p>本文として扱われる番号行である。</p>'));
    assert.ok(!result.includes('<h3>(1)　これは本文階層である。</h3>'));
    assert.ok(result.includes('<p>これは本文階層である。</p>'));
});

// ─── 複合文書 ──────────────────────────────────────────────

test('convertMarkdownToCourtHtml: handles court document structure', () => {
    const md = [
        '# 準備書面',
        '',
        '### --右',
        '令和7年3月31日',
        '### --',
        '',
        '## 第1 はじめに',
        '',
        '## 1 概要',
        '',
        '原告は以下の通り主張する。',
        '',
        '## (1) 詳細',
        '',
        'テスト本文。'
    ].join('\n');
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('準備書面'));
    assert.ok(result.includes('原告は以下の通り主張する'));
});

// ─── 特殊文字 ──────────────────────────────────────────────

test('convertMarkdownToCourtHtml: handles special markdown chars', () => {
    const md = '**太字テスト**と*斜体テスト*';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(typeof result === 'string');
});
