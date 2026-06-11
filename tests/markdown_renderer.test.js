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
    assert.match(sample, /^## 第1 /m);
    assert.match(sample, /^## 1 /m);
    assert.match(sample, /｜売買契約《ばいばいけいやく》/);
    assert.doesNotMatch(sample, /^1 原告/m);
    assert.doesNotMatch(sample, /^## 附属書類$/m);
    assert.doesNotMatch(sample, /証拠説明書/);
});

test('src/base/court_doc_rules.md: gives unambiguous heading instructions to AI', () => {
    const rules = fs.readFileSync(path.resolve('src/base/court_doc_rules.md'), 'utf-8');

    assert.match(rules, /Never output `###` or `####` as a normal section heading/);
    assert.match(rules, /Use `##` for every normal section heading/);
    assert.match(rules, /Use `#` only for the document title/);
    assert.match(rules, /Use one half-width space after a structure marker/);
    assert.match(rules, /Do not remove `##` from numbered headings found in a template/);
    assert.match(rules, /Plain numbered body items are allowed/);
    assert.match(rules, /The difference is function, not the marker itself/);
    assert.match(rules, /Allowed numbered argument paragraph when intentional/);
    assert.match(rules, /Use half-width Arabic numerals and half-width English alphabet letters throughout the Markdown/);
    assert.match(rules, /`｜親文字《ルビ》`/);
    assert.match(rules, /Always include `｜`/);
    assert.match(rules, /Treat template examples as format references/);
    assert.match(rules, /ask targeted questions before drafting/);
    assert.match(rules, /`【要確認】`/);
    assert.match(rules, /draft only that one document/);
    assert.match(rules, /Do not draft related documents such as 証拠説明書/);
    assert.match(rules, /Mentions of related documents in attachment lists or templates are filing information only/);
    assert.match(rules, /simple parenthesized references/);
    assert.match(rules, /甲1_確認メール\.pdf/);
    assert.match(rules, /`1 争点の整理` when used as a subheading/);
    assert.match(rules, /Before finalizing output, scan every line that starts with `#`/);
});

test('AI start guides: do not invite drafting related documents by default', () => {
    const setupSource = fs.readFileSync(path.resolve('setup.ts'), 'utf-8');
    const webBuildSource = fs.readFileSync(path.resolve('scripts/build_web.js'), 'utf-8');

    for (const source of [setupSource, webBuildSource]) {
        assert.match(source, /<success_criteria>/);
        assert.match(source, /<workflow>/);
        assert.match(source, /根拠資料/);
        assert.match(source, /テンプレート内の例示文/);
        assert.match(source, /その書面1通だけを作成してください/);
        assert.match(source, /関連書面は、ユーザーが明示的に依頼した場合に限り作成してください/);
        assert.match(source, /必要であれば別途作成できます/);
        assert.match(source, /最終稿/);
    }
});

test('src/web/drafting.ts: structures the handoff prompt for chat AIs', () => {
    const source = fs.readFileSync(path.resolve('src/web/drafting.ts'), 'utf-8');

    assert.match(source, /<role>/);
    assert.match(source, /<context>/);
    assert.match(source, /<success_criteria>/);
    assert.match(source, /<workflow>/);
    assert.match(source, /<rules>/);
    assert.match(source, /<template_markdown>/);
    assert.match(source, /テンプレートの例示文を、ユーザーの事件の事実として扱わない/);
    assert.match(source, /検討は内部で行い/);
});

test('web/drafting.html: offers Grok as a handoff AI', () => {
    const html = fs.readFileSync(path.resolve('web/drafting.html'), 'utf-8');

    assert.match(html, /引継ぎ先AI/);
    assert.match(html, /https:\/\/chatgpt\.com\//);
    assert.match(html, /https:\/\/claude\.ai\/new/);
    assert.match(html, /https:\/\/gemini\.google\.com\/app/);
    assert.match(html, /https:\/\/grok\.com\//);
    assert.match(html, />Grok<\/a>/);
});

test('src/templates/訴訟.準備書面.md: keeps numbered subheadings as ## headings', () => {
    const template = fs.readFileSync(path.resolve('src/templates/訴訟.準備書面.md'), 'utf-8');

    assert.match(template, /^## 1 争点の整理$/m);
    assert.match(template, /^## \(1\) 〇〇について$/m);
    assert.match(template, /｜契約成立《けいやくせいりつ》/);
    assert.doesNotMatch(template, /^1 争点の整理$/m);
    assert.doesNotMatch(template, /^\(1\) 〇〇について$/m);
});

test('preservation templates: keep preserved right as a normal paragraph', () => {
    const files = [
        '保全.発信者情報開示仮処分命令申立書.md',
        '保全.発信者情報消去禁止仮処分命令申立書.md'
    ];
    const preservedRight = '被保全権利　情報流通プラットフォーム対処法に基づく発信者情報開示請求権';

    for (const file of files) {
        const template = fs.readFileSync(path.resolve('src/templates', file), 'utf-8');
        assert.match(template, new RegExp(`^${preservedRight}$`, 'm'));
        assert.doesNotMatch(template, /^- 被保全権利:/m);
    }
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
    const markdownOrderedList = /^(?:[0-9]+\.|- [0-9]+\.)\s+/gm;
    const fullWidthMarkerSpace = /^(?:## )?(?:第[0-9０-９一二三四五六七八九十]+|[0-9０-９]+|\([0-9０-９]+\)|[ア-ン]|\([ア-ン]\)|[a-z]|\([a-z]\))　.+/gm;
    const oldEvidenceReference = /[甲乙丙丁戊疎証](?:第)?[0-9０-９〇○]+(?:[-ー－の][0-9０-９〇○]+)?号証/gm;
    const failures = [];

    for (const file of files) {
        const markdown = fs.readFileSync(file, 'utf-8');
        for (const match of markdown.matchAll(forbiddenHeading)) {
            failures.push(`${path.relative(process.cwd(), file)}: use ## instead of ${match[0]}`);
        }
        for (const match of markdown.matchAll(singleHashMarkerHeading)) {
            failures.push(`${path.relative(process.cwd(), file)}: marker heading must use ##: ${match[0]}`);
        }
        for (const match of markdown.matchAll(markdownOrderedList)) {
            failures.push(`${path.relative(process.cwd(), file)}: use court markers instead of Markdown ordered lists: ${match[0]}`);
        }
        for (const match of markdown.matchAll(fullWidthMarkerSpace)) {
            failures.push(`${path.relative(process.cwd(), file)}: use a half-width space after the marker: ${match[0]}`);
        }
        for (const match of markdown.matchAll(oldEvidenceReference)) {
            failures.push(`${path.relative(process.cwd(), file)}: use simple evidence references like （甲1） instead of ${match[0]}`);
        }
    }

    assert.deepEqual(failures, []);
});
