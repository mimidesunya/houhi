const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { xml2js } = require('xml-js');

const {
    parseCourtInline,
    parseCourtMarkdown
} = require('../dist/src/lib/court_document_model.js');
const {
    buildCourtDocxBuffer,
    convertCourtMarkdownToDocx
} = require('../dist/src/lib/docx_converter.js');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-docx-'));
}

function unzipBuffer(buffer) {
    return new AdmZip(buffer);
}

function assertValidXmlParts(zip) {
    for (const entry of zip.getEntries()) {
        if (!entry.entryName.endsWith('.xml') && !entry.entryName.endsWith('.rels')) continue;
        assert.doesNotThrow(
            () => xml2js(zip.readAsText(entry), { compact: false }),
            `invalid XML: ${entry.entryName}`
        );
    }
}

function readAllXmlParts(zip) {
    return zip.getEntries()
        .filter(entry => entry.entryName.endsWith('.xml') || entry.entryName.endsWith('.rels'))
        .map(entry => zip.readAsText(entry))
        .join('\n');
}

test('parseCourtInline: preserves underline, ruby, line breaks, and escaped markers', () => {
    const runs = parseCourtInline('本文++重要++｜投稿《とうこう》<br>次行\\++字面\\++');
    assert.deepEqual(runs, [
        { type: 'text', text: '本文' },
        { type: 'text', text: '重要', underline: true },
        { type: 'text', text: '投稿', rubyText: 'とうこう' },
        { type: 'break' },
        { type: 'text', text: '次行++字面++' }
    ]);
});

test('parseCourtMarkdown: maps HOUHI structures to editable document blocks', () => {
    const markdown = [
        '# 準備書面',
        '### --右',
        '令和8年8月5日',
        '原告　甲野太郎',
        '### --',
        '### --目次',
        '## 第1　請求原因',
        '1　概要',
        '(1) 詳細。',
        '* 箇条書き',
        '| 項目 | 内容 |',
        '|:---|:---|',
        '| 争点 | ++重要++ |',
        '### --別紙--',
        '以上'
    ].join('\n');
    const model = parseCourtMarkdown(markdown);

    assert.equal(model.title, '準備書面');
    assert.ok(model.blocks.some(block => block.type === 'toc'));
    assert.ok(model.blocks.some(block => block.type === 'paragraph' && block.kind === 'date' && block.alignment === 'right'));
    assert.ok(model.blocks.some(block => block.type === 'paragraph' && block.kind === 'heading' && block.headingLevel === 1));
    assert.ok(model.blocks.some(block => block.type === 'paragraph' && block.kind === 'bullet'));
    assert.ok(model.blocks.some(block => block.type === 'table' && block.headerRow));
    assert.ok(model.blocks.some(block => block.type === 'paragraph' && block.pageBreakBefore));
    assert.ok(model.blocks.some(block => block.type === 'paragraph' && block.kind === 'end' && block.alignment === 'right'));
});

test('buildCourtDocxBuffer: creates valid A4 WordprocessingML without open-time field updates or external references', async () => {
    const markdown = [
        '# 準備書面',
        '### --目次',
        '## 第1　争点',
        '1　概要',
        '本文++重要++です。',
        '* 確認事項',
        '| 項目 | 内容 |',
        '|:---|:---|',
        '| 争点 | 説明 |',
        '### --別紙--',
        '以上'
    ].join('\n');
    const model = parseCourtMarkdown(markdown);
    const result = await buildCourtDocxBuffer(model, process.cwd());
    const zip = unzipBuffer(result.buffer);
    const entries = new Set(zip.getEntries().map(entry => entry.entryName));

    for (const required of [
        '[Content_Types].xml',
        '_rels/.rels',
        'word/document.xml',
        'word/styles.xml',
        'word/settings.xml',
        'word/numbering.xml',
        'word/footer1.xml',
        'word/_rels/document.xml.rels'
    ]) {
        assert.ok(entries.has(required), required);
    }
    assertValidXmlParts(zip);

    const documentXml = zip.readAsText('word/document.xml');
    const stylesXml = zip.readAsText('word/styles.xml');
    const settingsXml = zip.readAsText('word/settings.xml');
    const footerXml = zip.readAsText('word/footer1.xml');
    const allXml = readAllXmlParts(zip);

    assert.match(documentXml, /w:pgSz w:w="11906" w:h="16838"/);
    assert.match(documentXml, /w:pgMar w:top="1984" w:right="1134" w:bottom="1531" w:left="1701"/);
    assert.match(documentXml, /w:instrText[^>]*>TOC/);
    assert.match(documentXml, /w:pageBreakBefore/);
    assert.match(documentXml, /w:tblW w:type="dxa" w:w="9071"/);
    assert.match(documentXml, /w:numPr/);
    assert.match(stylesXml, /MS Mincho/);
    assert.match(stylesXml, /w:sz w:val="24"/);
    assert.equal(/<w:updateFields\b/.test(settingsXml), false);
    assert.match(footerXml, /PAGE/);
    assert.equal(/TargetMode="External"/.test(allXml), false);
    assert.equal(/vbaProject|attachedTemplate/i.test([...entries].join('\n') + allXml), false);
    assert.equal(/<w:instrText[^>]*>\s*(?:INCLUDETEXT|INCLUDEPICTURE|LINK|DDE(?:AUTO)?|DATABASE|RD)\b/i.test(allXml), false);
});

test('buildCourtDocxBuffer: keeps PAGE without requesting field updates when there is no TOC', async () => {
    const result = await buildCourtDocxBuffer(parseCourtMarkdown('# 準備書面\n\n本文です。'), process.cwd());
    const zip = unzipBuffer(result.buffer);

    assert.equal(/<w:updateFields\b/.test(zip.readAsText('word/settings.xml')), false);
    assert.equal(/>TOC\b/.test(zip.readAsText('word/document.xml')), false);
    assert.match(zip.readAsText('word/footer1.xml'), /<w:instrText[^>]*>PAGE<\/w:instrText>/);
});

test('buildCourtDocxBuffer: embeds only local in-folder images and records safe warnings', async (t) => {
    const tempRoot = makeTempDir();
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(path.join(tempRoot, 'inside.png'), png);
    const outsidePath = `${tempRoot}-outside.png`;
    fs.writeFileSync(outsidePath, png);
    t.after(() => fs.rmSync(outsidePath, { force: true }));

    const model = parseCourtMarkdown([
        '# 画像確認',
        '![内部](inside.png)',
        '![外部URL](https://example.com/image.png)',
        `![外側](../${path.basename(outsidePath)})`
    ].join('\n'));
    const result = await buildCourtDocxBuffer(model, tempRoot);
    const zip = unzipBuffer(result.buffer);
    const entries = zip.getEntries().map(entry => entry.entryName);
    const rels = zip.readAsText('word/_rels/document.xml.rels');

    assert.equal(entries.filter(name => /^word\/media\/[^/]+$/.test(name)).length, 1);
    assert.deepEqual(result.warnings.map(warning => warning.code), ['unsafe-image-path', 'unsafe-image-path']);
    assert.equal(rels.includes('https://example.com'), false);
    assert.equal(rels.includes('outside.png'), false);
    assert.equal(rels.includes('TargetMode="External"'), false);
});

test('buildCourtDocxBuffer: represents evidence cell continuations as vertical merges', async () => {
    const model = parseCourtMarkdown([
        '# 証拠説明書',
        '| 号証 | 標目 | 原本・写し | 作成年月日 | 作成者 | 立証趣旨 |',
        '|:---|:---|:---|:---|:---|:---|',
        '| 甲1 | 契約書 | 写し | 令和8年1月1日 | 原告 | 契約成立 |',
        '|  | 追補 |  |  |  | 補足 |'
    ].join('\n'));
    const result = await buildCourtDocxBuffer(model, process.cwd());
    const documentXml = unzipBuffer(result.buffer).readAsText('word/document.xml');

    assert.match(documentXml, /w:vMerge w:val="restart"/);
    assert.match(documentXml, /w:vMerge w:val="continue"/);
});

test('convertCourtMarkdownToDocx: writes atomically and never overwrites an existing Word file', async (t) => {
    const tempRoot = makeTempDir();
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
    const markdownPath = path.join(tempRoot, '準備書面.md');
    const markdown = '# 準備書面\n\n本文です。';
    fs.writeFileSync(markdownPath, markdown, 'utf-8');
    const desiredPath = path.join(tempRoot, '準備書面.docx');

    const first = await convertCourtMarkdownToDocx(markdown, desiredPath, tempRoot, '準備書面');
    const second = await convertCourtMarkdownToDocx(markdown, desiredPath, tempRoot, '準備書面');

    assert.equal(first.outputPath, desiredPath);
    assert.equal(second.outputPath, path.join(tempRoot, '準備書面_2.docx'));
    assert.ok(fs.statSync(first.outputPath).size > 1000);
    assert.ok(fs.statSync(second.outputPath).size > 1000);
    assert.equal(fs.readFileSync(markdownPath, 'utf-8'), markdown);
    assert.equal(fs.readdirSync(tempRoot).some(name => name.endsWith('.tmp')), false);
});
