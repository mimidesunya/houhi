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

test('convertMarkdownToCourtHtml: converts underline inline syntax', () => {
    const result = convertMarkdownToCourtHtml('これは++重要な部分++です。');
    assert.ok(result.includes('<p>これは<span class="underline">重要な部分</span>です。</p>'));
});

test('convertMarkdownToCourtHtml: escapes text inside underline inline syntax', () => {
    const result = convertMarkdownToCourtHtml('++<重要>&確認++');
    assert.ok(result.includes('<span class="underline">&lt;重要&gt;&amp;確認</span>'));
});

test('convertMarkdownToCourtHtml: converts underline syntax in table cells', () => {
    const md = '| 項目 | 内容 |\n|:---|:---|\n| 争点 | ++投稿者の同一性++ |';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('<td class="col-1">争点</td>'));
    assert.ok(result.includes('<td class="col-2"><span class="underline">投稿者の同一性</span></td>'));
});

test('convertMarkdownToCourtHtml: keeps escaped underline delimiter literal', () => {
    const result = convertMarkdownToCourtHtml('これは\\++下線にしない\\++です。');
    assert.ok(result.includes('<p>これは++下線にしない++です。</p>'));
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

test('convertMarkdownToCourtHtml: converts numbered colon rows as attachment-style list rows', () => {
    const md = [
        '# 送付書',
        '',
        '令和7年（ワ）第36723号 損害賠償等請求事件について、下記のとおり送付します。',
        '',
        '記',
        '',
        '1 乙B1号証の1ないし4写し（クリーンコピー）:各1通',
        '',
        '以上'
    ].join('\n');
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('<table class="att">'));
    assert.ok(result.includes('<td class="col-1">乙B1号証の1ないし4写し（クリーンコピー）</td>'));
    assert.ok(result.includes('<td class="col-2">各1通</td>'));
    assert.ok(!result.includes('<h2>1　乙B1号証の1ないし4写し（クリーンコピー）:各1通</h2>'));
    assert.ok(!result.includes('</ol>\n</li>'));
});

// ─── 改ページ ──────────────────────────────────────────────

test('convertMarkdownToCourtHtml: handles page break marker', () => {
    const md = '### ---\nテキスト';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(typeof result === 'string');
});

test('convertMarkdownToCourtHtml: converts image syntax to centered image block', () => {
    const md = '![本件記事の表示例](images/article.png)';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('<div class="image-block"><img src="images/article.png" alt="本件記事の表示例" /></div>'));
});

test('convertMarkdownToCourtHtml: escapes image attributes', () => {
    const md = '!["引用" & 説明](images/a&b.png)';
    const result = convertMarkdownToCourtHtml(md);
    assert.ok(result.includes('alt="&quot;引用&quot; &amp; 説明"'));
    assert.ok(result.includes('src="images/a&amp;b.png"'));
});

test('convertMarkdownToCourtHtml: preserves list hierarchy around images', () => {
    const md = [
        '## 第1 見出し',
        '',
        '1 小見出し',
        '',
        '(1) 画像の前。',
        '',
        '![説明](images/test.jpg)',
        '',
        '(2) 画像の後。'
    ].join('\n');
    const result = convertMarkdownToCourtHtml(md);
    const imageIndex = result.indexOf('<div class="image-block">');
    const secondItemIndex = result.indexOf('<p>画像の後。</p>');
    const closeLevelThreeIndex = result.indexOf('</ol>', imageIndex);
    assert.ok(imageIndex > -1);
    assert.ok(secondItemIndex > imageIndex);
    assert.ok(closeLevelThreeIndex > secondItemIndex);
});

test('convertMarkdownToCourtHtml: converts table of contents marker', () => {
    const md = [
        '### 目次',
        '',
        '## 第1 はじめに',
        '',
        '1 概要',
        '',
        '## (1) 詳細'
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
