const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { mergeOcrPages } = require('../dist/src/ocr_merge_pages.js');

test('mergeOcrPages removes continuation boundaries and keeps paragraph breaks for non-continuation pages', async (t) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-merge-'));
    const inputPath = path.join(tempDir, 'sample_paged.md');
    const outputPath = path.join(tempDir, 'sample_merged.md');

    const source = [
        '前半の段落',
        '### -- End Page 1 (Continuation) --',
        '### -- Begin Page 2 (Continuation) --',
        '後半の段落',
        '### -- End Page 2 --',
        '### -- Begin Page 3 --',
        '別段落'
    ].join('\n');

    fs.writeFileSync(inputPath, source, 'utf8');

    t.after(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    mergeOcrPages(inputPath);

    assert.equal(fs.existsSync(outputPath), true);
    const merged = fs.readFileSync(outputPath, 'utf8');

    assert.equal(merged.includes('### -- Begin Page'), false);
    assert.equal(merged.includes('### -- End Page'), false);
    assert.equal(merged.includes('前半の段落後半の段落'), true);
    assert.equal(merged.includes('後半の段落\n\n別段落'), true);
});
