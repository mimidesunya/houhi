const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const {
    extractEvidenceNumber,
    naturalSortKey,
    isImageFile,
    findJapaneseFont,
    getA4PrintScaleForPage,
    getStampMetricsForA4Print,
    stampPdf,
} = require('../dist/src/stamp_evidence_number.js');

// ─── extractEvidenceNumber ──────────────────────────────────

test('extractEvidenceNumber: extracts 甲1', () => {
    assert.equal(extractEvidenceNumber('甲1_契約書.pdf'), '甲1');
});

test('extractEvidenceNumber: extracts 乙2-1 (branch number with hyphen)', () => {
    assert.equal(extractEvidenceNumber('乙2-1_領収書.pdf'), '乙2-1');
});

test('extractEvidenceNumber: extracts 丙3の1 (branch with の)', () => {
    assert.equal(extractEvidenceNumber('丙3の1メール.pdf'), '丙3の1');
});

test('extractEvidenceNumber: extracts 甲10 (multi-digit)', () => {
    assert.equal(extractEvidenceNumber('甲10_陳述書.pdf'), '甲10');
});

test('extractEvidenceNumber: extracts 疎1 (provisional disposition evidence)', () => {
    assert.equal(extractEvidenceNumber('疎1_申立書.pdf'), '疎1');
});

test('extractEvidenceNumber: extracts 証1', () => {
    assert.equal(extractEvidenceNumber('証1_記録.pdf'), '証1');
});

test('extractEvidenceNumber: extracts 乙A1', () => {
    assert.equal(extractEvidenceNumber('乙A1_写真.pdf'), '乙A1');
});

test('extractEvidenceNumber: extracts 乙A1の2', () => {
    assert.equal(extractEvidenceNumber('乙A1の2_写真.pdf'), '乙A1の2');
});

test('extractEvidenceNumber: normalizes full-width latin and digits', () => {
    assert.equal(extractEvidenceNumber('乙ａ１の２_写真.pdf'), '乙A1の2');
});

test('extractEvidenceNumber: returns null for non-matching filename', () => {
    assert.equal(extractEvidenceNumber('契約書.pdf'), null);
});

test('extractEvidenceNumber: returns null for number-only filename', () => {
    assert.equal(extractEvidenceNumber('123_file.pdf'), null);
});

test('extractEvidenceNumber: must start at beginning of filename', () => {
    assert.equal(extractEvidenceNumber('file_甲1.pdf'), null);
});

// ─── naturalSortKey ─────────────────────────────────────────

test('naturalSortKey: returns [letter, main, 0] for simple number', () => {
    assert.deepEqual(naturalSortKey('甲3_契約書.pdf'), [0, 3, 0]);
});

test('naturalSortKey: returns [main, branch] for branch number', () => {
    assert.deepEqual(naturalSortKey('甲3-2_資料.pdf'), [0, 3, 2]);
});

test('naturalSortKey: returns [main, branch] for の-style branch', () => {
    assert.deepEqual(naturalSortKey('乙5の3_写真.pdf'), [0, 5, 3]);
});

test('naturalSortKey: supports alphabetic evidence groups', () => {
    assert.deepEqual(naturalSortKey('乙A5の3_写真.pdf'), [1, 5, 3]);
});

test('naturalSortKey: returns [0, 0] for non-matching file', () => {
    assert.deepEqual(naturalSortKey('readme.txt'), [0, 0, 0]);
});

test('naturalSortKey: works with full path', () => {
    assert.deepEqual(naturalSortKey(path.join('C:', 'docs', '甲12-5_test.pdf')), [0, 12, 5]);
});

test('naturalSortKey: sorting produces correct order', () => {
    const files = ['甲3.pdf', '甲1.pdf', '甲2-1.pdf', '甲2.pdf', '甲10.pdf'];
    const sorted = files.sort((a, b) => {
        const [al, am, ab] = naturalSortKey(a);
        const [bl, bm, bb] = naturalSortKey(b);
        return al - bl || am - bm || ab - bb;
    });
    assert.deepEqual(sorted, ['甲1.pdf', '甲2.pdf', '甲2-1.pdf', '甲3.pdf', '甲10.pdf']);
});

test('naturalSortKey: sorting handles alphabetic evidence groups', () => {
    const files = ['乙B1.pdf', '乙A2.pdf', '乙A1の2.pdf', '乙A1.pdf'];
    const sorted = files.sort((a, b) => {
        const [al, am, ab] = naturalSortKey(a);
        const [bl, bm, bb] = naturalSortKey(b);
        return al - bl || am - bm || ab - bb;
    });
    assert.deepEqual(sorted, ['乙A1.pdf', '乙A1の2.pdf', '乙A2.pdf', '乙B1.pdf']);
});

// ─── isImageFile ────────────────────────────────────────────

test('isImageFile: returns true for .jpg', () => {
    assert.equal(isImageFile('photo.jpg'), true);
});

test('isImageFile: returns true for .jpeg', () => {
    assert.equal(isImageFile('photo.jpeg'), true);
});

test('isImageFile: returns true for .png', () => {
    assert.equal(isImageFile('photo.png'), true);
});

test('isImageFile: returns true for uppercase .JPG', () => {
    assert.equal(isImageFile('photo.JPG'), true);
});

test('isImageFile: returns false for .pdf', () => {
    assert.equal(isImageFile('document.pdf'), false);
});

test('isImageFile: returns false for .gif', () => {
    assert.equal(isImageFile('animation.gif'), false);
});

test('isImageFile: returns false for no extension', () => {
    assert.equal(isImageFile('readme'), false);
});

// ─── A4印刷換算スタンプ寸法 ─────────────────────────────────

test('getA4PrintScaleForPage: returns 1 for A4 portrait page', () => {
    assert.equal(getA4PrintScaleForPage(595.28, 841.89), 1);
});

test('getA4PrintScaleForPage: returns 1 for A4 landscape page', () => {
    assert.equal(getA4PrintScaleForPage(841.89, 595.28), 1);
});

test('getStampMetricsForA4Print: enlarges stamp metrics for A3 portrait page', () => {
    const metrics = getStampMetricsForA4Print(841.89, 1190.55, 20);

    assert.ok(Math.abs(metrics.printScale - 0.707) < 0.001);
    assert.ok(Math.abs(metrics.fontSize * metrics.printScale - 20) < 0.001);
    assert.ok(Math.abs(metrics.marginRight * metrics.printScale - 15) < 0.001);
    assert.ok(Math.abs(metrics.marginTop * metrics.printScale - 12) < 0.001);
});

test('stampPdf: preserves original PDF page size', async (t) => {
    const fontPath = findJapaneseFont();
    if (!fontPath) {
        t.skip('Japanese font is not available');
        return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-stamp-'));
    const inputPath = path.join(tempDir, '乙1_test.pdf');
    const outputPath = path.join(tempDir, '乙1_test_stamped.pdf');

    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([300, 400]);
    fs.writeFileSync(inputPath, await sourceDoc.save());

    const stampedBytes = await stampPdf(inputPath, outputPath, '乙1', fs.readFileSync(fontPath), { allPages: true });
    const stampedDoc = await PDFDocument.load(stampedBytes);
    const { width, height } = stampedDoc.getPage(0).getSize();

    assert.equal(width, 300);
    assert.equal(height, 400);
});
