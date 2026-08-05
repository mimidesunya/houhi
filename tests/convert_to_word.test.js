const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    extractTitle,
    parseArgs,
    processMarkdownFile,
    sanitizeFilePart
} = require('../dist/src/convert_to_word.js');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-word-cli-'));
}

test('convert_to_word: parses CLI options without affecting existing PDF engine flags', () => {
    assert.deepEqual(parseArgs(['--no-open', '書面.md']), {
        files: ['書面.md'],
        openOutput: false,
        help: false
    });
    assert.equal(parseArgs(['--help']).help, true);
    assert.throws(() => parseArgs(['--pdf-engine=chrome', '書面.md']), /不明なオプション/);
});

test('convert_to_word: extracts and sanitizes a document title', () => {
    assert.equal(extractTitle('本文\n# 準備書面\n'), '準備書面');
    assert.equal(extractTitle('本文だけ'), '裁判文書');
    assert.equal(sanitizeFilePart('準備:書面/1'), '準備書面1');
});

test('convert_to_word: converts Markdown next to the input without changing it', async (t) => {
    const tempRoot = makeTempDir();
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
    const inputPath = path.join(tempRoot, '書面.md');
    const markdown = '# 準備書面\n\n本文です。';
    fs.writeFileSync(inputPath, markdown, 'utf-8');

    const result = await processMarkdownFile(inputPath, false);

    assert.equal(result.outputPath, path.join(tempRoot, '書面.docx'));
    assert.ok(fs.existsSync(result.outputPath));
    assert.equal(fs.readFileSync(inputPath, 'utf-8'), markdown);
});

test('convert_to_word: rejects non-Markdown input clearly', async (t) => {
    const tempRoot = makeTempDir();
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
    const inputPath = path.join(tempRoot, '書面.html');
    fs.writeFileSync(inputPath, '<p>本文</p>', 'utf-8');

    await assert.rejects(() => processMarkdownFile(inputPath, false), /\.md ファイル/);
});

test('GUI: exposes Word as a separate tool without treating it as a PDF engine', () => {
    const guiHtml = fs.readFileSync(path.resolve('src/gui/index.html'), 'utf-8');
    const renderer = fs.readFileSync(path.resolve('src/gui/renderer.ts'), 'utf-8');
    const main = fs.readFileSync(path.resolve('src/gui/main.ts'), 'utf-8');

    assert.match(guiHtml, /data-script="word"[\s\S]*?<div class="tool-name">Word作成<\/div>/);
    assert.match(renderer, /word:\s*'Markdownを編集可能なWord（\.docx）へ変換'/);
    assert.match(renderer, /value === 'word'/);
    assert.match(main, /'word':\s*\{\s*path:\s*'src\/convert_to_word\.js'/);
    assert.equal(/pdfEngineOption\.style\.display\s*=\s*[^;]*word/.test(renderer), false);
});

test('tool documentation: includes the generated Word conversion section', () => {
    const toolDocs = fs.readFileSync(path.resolve('docs/ツール詳細.md'), 'utf-8');
    assert.match(toolDocs, /## Word変換/);
    assert.match(toolDocs, /src\/convert_to_word\.ts/);
    assert.match(toolDocs, /同名の Word ファイルが既にある場合は上書きせず/);
});
