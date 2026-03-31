const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
    extractEvidenceNumber,
    naturalSortKey,
    isImageFile,
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

test('naturalSortKey: returns [main, 0] for simple number', () => {
    assert.deepEqual(naturalSortKey('甲3_契約書.pdf'), [3, 0]);
});

test('naturalSortKey: returns [main, branch] for branch number', () => {
    assert.deepEqual(naturalSortKey('甲3-2_資料.pdf'), [3, 2]);
});

test('naturalSortKey: returns [main, branch] for の-style branch', () => {
    assert.deepEqual(naturalSortKey('乙5の3_写真.pdf'), [5, 3]);
});

test('naturalSortKey: returns [0, 0] for non-matching file', () => {
    assert.deepEqual(naturalSortKey('readme.txt'), [0, 0]);
});

test('naturalSortKey: works with full path', () => {
    assert.deepEqual(naturalSortKey(path.join('C:', 'docs', '甲12-5_test.pdf')), [12, 5]);
});

test('naturalSortKey: sorting produces correct order', () => {
    const files = ['甲3.pdf', '甲1.pdf', '甲2-1.pdf', '甲2.pdf', '甲10.pdf'];
    const sorted = files.sort((a, b) => {
        const [am, ab] = naturalSortKey(a);
        const [bm, bb] = naturalSortKey(b);
        return am - bm || ab - bb;
    });
    assert.deepEqual(sorted, ['甲1.pdf', '甲2.pdf', '甲2-1.pdf', '甲3.pdf', '甲10.pdf']);
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
