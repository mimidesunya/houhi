const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument, degrees } = require('pdf-lib');

const {
    extractEvidenceNumber,
    getMaterialKind,
    buildStampText,
    naturalSortKey,
    buildOutputFilename,
    normalizeCombinedName,
    buildCombinedName,
    isImageFile,
    findJapaneseFont,
    getA4PrintScaleForPage,
    getStampMetricsForA4Print,
    getStampLayout,
    getTabStripes,
    getPageRotation,
    getDisplaySize,
    toPageSpace,
    turnLandscapePagesToPortrait,
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

test('naturalSortKey: returns [kind, letter, main, 0] for simple number', () => {
    assert.deepEqual(naturalSortKey('甲3_契約書.pdf'), [0, 0, 3, 0]);
});

test('naturalSortKey: returns [kind, letter, main, branch] for branch number', () => {
    assert.deepEqual(naturalSortKey('甲3-2_資料.pdf'), [0, 0, 3, 2]);
});

test('naturalSortKey: returns [kind, letter, main, branch] for の-style branch', () => {
    assert.deepEqual(naturalSortKey('乙5の3_写真.pdf'), [0, 0, 5, 3]);
});

test('naturalSortKey: supports alphabetic evidence groups', () => {
    assert.deepEqual(naturalSortKey('乙A5の3_写真.pdf'), [0, 1, 5, 3]);
});

test('naturalSortKey: returns zeros for non-matching file', () => {
    assert.deepEqual(naturalSortKey('readme.txt'), [0, 0, 0, 0]);
});

test('naturalSortKey: works with full path', () => {
    assert.deepEqual(naturalSortKey(path.join('C:', 'docs', '甲12-5_test.pdf')), [0, 0, 12, 5]);
});

test('naturalSortKey: sorting produces correct order', () => {
    const files = ['甲3.pdf', '甲1.pdf', '甲2-1.pdf', '甲2.pdf', '甲10.pdf'];
    const sorted = files.sort((a, b) => {
        const [ak, al, am, ab] = naturalSortKey(a);
        const [bk, bl, bm, bb] = naturalSortKey(b);
        return ak - bk || al - bl || am - bm || ab - bb;
    });
    assert.deepEqual(sorted, ['甲1.pdf', '甲2.pdf', '甲2-1.pdf', '甲3.pdf', '甲10.pdf']);
});

test('naturalSortKey: sorting handles alphabetic evidence groups', () => {
    const files = ['乙B1.pdf', '乙A2.pdf', '乙A1の2.pdf', '乙A1.pdf'];
    const sorted = files.sort((a, b) => {
        const [ak, al, am, ab] = naturalSortKey(a);
        const [bk, bl, bm, bb] = naturalSortKey(b);
        return ak - bk || al - bl || am - bm || ab - bb;
    });
    assert.deepEqual(sorted, ['乙A1.pdf', '乙A1の2.pdf', '乙A2.pdf', '乙B1.pdf']);
});

// ─── 資料（苦情申出の意見書などの添付資料） ────────────────

test('extractEvidenceNumber: extracts 資料1', () => {
    assert.equal(extractEvidenceNumber('資料1_裁判所ウェブサイト.jpg'), '資料1');
});

test('extractEvidenceNumber: extracts 資料2-1 (branch number)', () => {
    assert.equal(extractEvidenceNumber('資料2-1_詳細ページ.pdf'), '資料2-1');
});

test('extractEvidenceNumber: extracts 資料3の2 (の-style branch)', () => {
    assert.equal(extractEvidenceNumber('資料3の2_写し.pdf'), '資料3の2');
});

test('extractEvidenceNumber: does not treat 資料 in the middle as a number', () => {
    assert.equal(extractEvidenceNumber('甲3-2_資料.pdf'), '甲3-2');
});

test('buildStampText: appends 号証 to evidence numbers', () => {
    assert.equal(buildStampText('甲1'), '甲1号証');
    assert.equal(buildStampText('乙A1の2'), '乙A1の2号証');
});

test('buildStampText: leaves 資料 numbers as they are', () => {
    assert.equal(buildStampText('資料1'), '資料1');
    assert.equal(buildStampText('資料2-1'), '資料2-1');
});

test('naturalSortKey: sorts 資料 after 号証', () => {
    const files = ['資料2.pdf', '甲1.pdf', '資料1.pdf', '乙1.pdf'];
    const sorted = files.sort((a, b) => {
        const [ak, al, am, ab] = naturalSortKey(a);
        const [bk, bl, bm, bb] = naturalSortKey(b);
        return ak - bk || al - bl || am - bm || ab - bb;
    });
    assert.deepEqual(sorted, ['甲1.pdf', '乙1.pdf', '資料1.pdf', '資料2.pdf']);
});

test('naturalSortKey: sorts 資料 numerically including branches', () => {
    const files = ['資料10.pdf', '資料2-1.pdf', '資料1.pdf', '資料2.pdf'];
    const sorted = files.sort((a, b) => {
        const [ak, al, am, ab] = naturalSortKey(a);
        const [bk, bl, bm, bb] = naturalSortKey(b);
        return ak - bk || al - bl || am - bm || ab - bb;
    });
    assert.deepEqual(sorted, ['資料1.pdf', '資料2.pdf', '資料2-1.pdf', '資料10.pdf']);
});

// ─── 参考資料（審査会へ意見書と出す参考資料） ──────────────

const sortByKey = (files) => files.sort((a, b) => {
    const [ak, al, am, ab] = naturalSortKey(a);
    const [bk, bl, bm, bb] = naturalSortKey(b);
    return ak - bk || al - bl || am - bm || ab - bb;
});

test('extractEvidenceNumber: extracts 参考資料1', () => {
    assert.equal(extractEvidenceNumber('参考資料1_通知書.pdf'), '参考資料1');
});

test('extractEvidenceNumber: extracts 参考資料2-1 and 参考資料3の2 (branch numbers)', () => {
    assert.equal(extractEvidenceNumber('参考資料2-1_決定書.pdf'), '参考資料2-1');
    assert.equal(extractEvidenceNumber('参考資料2ー1_決定書.pdf'), '参考資料2-1');
    assert.equal(extractEvidenceNumber('参考資料3の2_写し.pdf'), '参考資料3の2');
});

test('extractEvidenceNumber: normalizes full-width digits in 参考資料', () => {
    assert.equal(extractEvidenceNumber('参考資料１２_答申.pdf'), '参考資料12');
});

test('extractEvidenceNumber: works with a full path to 参考資料', () => {
    assert.equal(extractEvidenceNumber(path.join('C:', '審査請求', '参考資料1_通知書.pdf')), '参考資料1');
});

test('extractEvidenceNumber: does not take 参考資料 in the middle of a name', () => {
    assert.equal(extractEvidenceNumber('意見書_参考資料1.pdf'), null);
    assert.equal(extractEvidenceNumber('甲2_参考資料.pdf'), '甲2');
});

test('getMaterialKind: tells 号証, 資料 and 参考資料 apart', () => {
    assert.equal(getMaterialKind('甲1'), '号証');
    assert.equal(getMaterialKind('乙A1の2'), '号証');
    assert.equal(getMaterialKind('資料1'), '資料');
    assert.equal(getMaterialKind('参考資料2-1'), '参考資料');
    assert.equal(getMaterialKind(null), '号証');
});

test('buildStampText: leaves 参考資料 numbers as they are (no 号証)', () => {
    assert.equal(buildStampText('参考資料1'), '参考資料1');
    assert.equal(buildStampText('参考資料2-1'), '参考資料2-1');
    assert.equal(buildStampText('参考資料1', true), '参考資料1');
});

test('naturalSortKey: gives 参考資料 its own kind after 資料', () => {
    assert.deepEqual(naturalSortKey('参考資料3_答申.pdf'), [2, 0, 3, 0]);
    assert.deepEqual(naturalSortKey('参考資料2の1_写し.pdf'), [2, 0, 2, 1]);
    assert.deepEqual(naturalSortKey('資料3_写し.pdf'), [1, 0, 3, 0]);
});

test('naturalSortKey: sorts 参考資料 numerically including branches', () => {
    const files = ['参考資料10_c.pdf', '参考資料2-1_b.pdf', '参考資料1_a.pdf', '参考資料2_b.pdf', '参考資料3_d.pdf'];
    assert.deepEqual(sortByKey(files), ['参考資料1_a.pdf', '参考資料2_b.pdf', '参考資料2-1_b.pdf', '参考資料3_d.pdf', '参考資料10_c.pdf']);
});

test('naturalSortKey: keeps 号証, 資料 and 参考資料 in separate runs', () => {
    const files = ['参考資料1.pdf', '資料2.pdf', '甲1.pdf', '参考資料2.pdf', '資料1.pdf'];
    assert.deepEqual(sortByKey(files), ['甲1.pdf', '資料1.pdf', '資料2.pdf', '参考資料1.pdf', '参考資料2.pdf']);
});

// ─── 個別PDFと結合PDFの名前 ─────────────────────────────────

test('buildOutputFilename: keeps the name and makes it .pdf', () => {
    assert.equal(buildOutputFilename('参考資料1_通知書.pdf', '参考資料1'), '参考資料1_通知書.pdf');
    assert.equal(buildOutputFilename('資料2_写真.jpg', '資料2'), '資料2_写真.pdf');
    assert.equal(buildOutputFilename('甲1_契約書.pdf', '甲1', true), '甲001_契約書.pdf');
});

test('buildCombinedName: names the merged PDF after the kind by default', () => {
    assert.equal(buildCombinedName(['甲1', '甲2']), '_結合_号証一式.pdf');
    assert.equal(buildCombinedName(['資料1', '資料2-1']), '_結合_資料一式.pdf');
    assert.equal(buildCombinedName(['参考資料1', '参考資料2']), '_結合_参考資料一式.pdf');
    assert.equal(buildCombinedName(['資料1', '参考資料1']), '_結合_一式.pdf');
    assert.equal(buildCombinedName(['甲1', '資料1']), '_結合_一式.pdf');
});

test('buildCombinedName: uses --combined-name when given', () => {
    const name = '令和○年（行情）諮問第○号_参考資料.pdf';
    assert.equal(buildCombinedName(['参考資料1', '参考資料2'], name), name);
    assert.equal(buildCombinedName(['甲1', '甲2'], '  甲号証一式  '), '甲号証一式.pdf');
    assert.equal(buildCombinedName(['甲1', '甲2'], ''), '_結合_号証一式.pdf');
});

test('normalizeCombinedName: adds .pdf, keeps .PDF and rejects folders or bad characters', () => {
    assert.equal(normalizeCombinedName('参考資料一式'), '参考資料一式.pdf');
    assert.equal(normalizeCombinedName('参考資料一式.PDF'), '参考資料一式.PDF');
    assert.equal(normalizeCombinedName(''), null);
    assert.equal(normalizeCombinedName(undefined), null);
    assert.throws(() => normalizeCombinedName('sub/一式.pdf'), /フォルダ/);
    assert.throws(() => normalizeCombinedName('..\\一式.pdf'), /フォルダ/);
    assert.throws(() => normalizeCombinedName('一式:2.pdf'), /使えない文字/);
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

test('stampPdf: normalizes non-A4 PDF pages to A4', async (t) => {
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

    assert.ok(Math.abs(width - 595.28) < 0.01);
    assert.ok(Math.abs(height - 841.89) < 0.01);
});

// ─── 境目の黒帯 ─────────────────────────────────────────────

test('getStampLayout: without tab keeps the stamp at the top-right margin', () => {
    const metrics = getStampMetricsForA4Print(595.28, 841.89, 20);
    const layout = getStampLayout(595.28, 841.89, 100, metrics);

    assert.equal(layout.tabRect, null);
    assert.ok(Math.abs(layout.textX - (595.28 - 100 - 15)) < 0.001);
    assert.ok(Math.abs(layout.textY - (841.89 - 12 - 20)) < 0.001);
});

test('getStampLayout: tab runs from the right of the number to the page edge', () => {
    const metrics = getStampMetricsForA4Print(595.28, 841.89, 20);
    const layout = getStampLayout(595.28, 841.89, 100, metrics, { tab: true, tabIndex: 0 });

    assert.ok(Math.abs(layout.tabRect.x + layout.tabRect.width - 595.28) < 0.001);
    assert.ok(Math.abs(layout.textX + 100 + metrics.tabGap - layout.tabRect.x) < 0.001);
    assert.ok(Math.abs(layout.tabRect.height - 20) < 0.001);
    assert.ok(layout.tabRect.y < layout.textY && layout.textY < layout.tabRect.y + layout.tabRect.height);
});

test('getStampLayout: tab moves down one band per index and cycles', () => {
    const metrics = getStampMetricsForA4Print(595.28, 841.89, 20);
    const ys = [0, 1, 2, 3, 4, 5].map(i => getStampLayout(595.28, 841.89, 100, metrics, { tab: true, tabIndex: i, tabSteps: 4 }).tabRect.y);

    assert.ok(Math.abs(ys[0] - ys[1] - 20) < 0.001);
    assert.ok(Math.abs(ys[0] - ys[3] - 60) < 0.001);
    assert.ok(Math.abs(ys[4] - ys[0]) < 0.001);
    for (let i = 1; i < ys.length; i++) {
        assert.notEqual(ys[i], ys[i - 1]);
    }
});

test('getStampLayout: tab steps of 1 keeps every tab at the top', () => {
    const metrics = getStampMetricsForA4Print(595.28, 841.89, 20);
    const a = getStampLayout(595.28, 841.89, 100, metrics, { tab: true, tabIndex: 0, tabSteps: 1 });
    const b = getStampLayout(595.28, 841.89, 100, metrics, { tab: true, tabIndex: 7, tabSteps: 1 });

    assert.equal(a.tabRect.y, b.tabRect.y);
});

test('stampPdf: draws the tab only when asked and never for mints', async (t) => {
    const fontPath = findJapaneseFont();
    if (!fontPath) {
        t.skip('Japanese font is not available');
        return;
    }

    const zlib = require('node:zlib');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-stamp-tab-'));
    const inputPath = path.join(tempDir, '乙1_test.pdf');
    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([595.28, 841.89]);
    fs.writeFileSync(inputPath, await sourceDoc.save());

    // 黒の塗り（0 0 0 rg）で閉じた経路を塗る（h f）ものを帯とみなす。pdf-lib は矩形を m/l/h/f で描く
    const hasBlackRect = async (bytes) => {
        const doc = await PDFDocument.load(bytes);
        const contents = doc.getPage(0).node.Contents();
        const streams = contents.asArray ? contents.asArray().map(ref => doc.context.lookup(ref)) : [contents];
        const text = streams.map(stream => {
            const raw = Buffer.from(stream.getContents());
            try { return zlib.inflateSync(raw).toString('latin1'); } catch (_) { return raw.toString('latin1'); }
        }).join('\n');
        return /0 0 0 rg[\s\S]*?\nh\nf\n/.test(text);
    };

    const font = fs.readFileSync(fontPath);
    const plain = await stampPdf(inputPath, path.join(tempDir, 'plain.pdf'), '乙1', font, {});
    const tabbed = await stampPdf(inputPath, path.join(tempDir, 'tab.pdf'), '乙1', font, { tab: true, tabIndex: 2 });
    const mints = await stampPdf(inputPath, path.join(tempDir, 'mints.pdf'), '乙1', font, { tab: true, mints: true });

    assert.equal(await hasBlackRect(plain), false);
    assert.equal(await hasBlackRect(tabbed), true);
    assert.equal(await hasBlackRect(mints), false);
});

test('getTabStripes: right-up stripes cover the whole band with half black', () => {
    const rect = { x: 553, y: 760, width: 42, height: 20 };
    const stripes = getTabStripes(rect, 8);

    for (const [p0, p1, p2, p3] of stripes) {
        assert.equal(p1[0] - p0[0], 4);
        assert.equal(p2[0] - p1[0], rect.height);
        assert.equal(p2[1] - p1[1], rect.height);
        assert.equal(p3[1], rect.y + rect.height);
    }
    // 帯の下の辺と上の辺のどちらも、左端から右端まで縞が並ぶ
    assert.ok(stripes[0][0][0] <= rect.x - rect.height);
    assert.ok(stripes[stripes.length - 1][0][0] >= rect.x + rect.width - 8);
});

// ─── 頁の回転と横長の頁 ─────────────────────────────────────

test('toPageSpace: maps the displayed top-right corner for each rotation', () => {
    // 横 842 × 縦 595 の頁。表示の右上隅がどこに来るか
    assert.deepEqual(toPageSpace(0, 842, 595, 842, 595), { x: 842, y: 595 });
    // 270: 表示は縦 595 × 842。表示の右上は元の頁の右下
    assert.deepEqual(toPageSpace(270, 842, 595, 595, 842), { x: 842, y: 0 });
    // 90: 表示の右上は元の頁の左上
    assert.deepEqual(toPageSpace(90, 842, 595, 595, 842), { x: 0, y: 595 });
    assert.deepEqual(toPageSpace(180, 842, 595, 842, 595), { x: 0, y: 0 });
});

test('turnLandscapePagesToPortrait: turns landscape pages so that they display upright portrait', async () => {
    const doc = await PDFDocument.create();
    const landscape = doc.addPage([842, 595]);
    const portrait = doc.addPage([595, 842]);
    const rotatedLandscape = doc.addPage([595, 842]);
    rotatedLandscape.setRotation(degrees(90));

    assert.equal(turnLandscapePagesToPortrait(doc.getPages()), 2);
    assert.equal(getPageRotation(landscape), 270);
    assert.equal(getPageRotation(portrait), 0);
    assert.equal(getPageRotation(rotatedLandscape), 0);
    for (const page of doc.getPages()) {
        const { width, height } = getDisplaySize(page);
        assert.ok(width < height);
    }
});

test('stampPdf: turns landscape pages to portrait only with the tab', async (t) => {
    const fontPath = findJapaneseFont();
    if (!fontPath) {
        t.skip('Japanese font is not available');
        return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-stamp-landscape-'));
    const inputPath = path.join(tempDir, '乙1_test.pdf');
    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([841.89, 595.28]);
    sourceDoc.addPage([841.89, 595.28]);
    fs.writeFileSync(inputPath, await sourceDoc.save());

    const font = fs.readFileSync(fontPath);
    const tabbed = await PDFDocument.load(await stampPdf(inputPath, path.join(tempDir, 'tab.pdf'), '乙1', font, { tab: true }));
    const plain = await PDFDocument.load(await stampPdf(inputPath, path.join(tempDir, 'plain.pdf'), '乙1', font, {}));

    assert.deepEqual(tabbed.getPages().map(getPageRotation), [270, 270]);
    assert.deepEqual(plain.getPages().map(getPageRotation), [0, 0]);
});

test('stampPdf: keeps /Rotate when a non-A4 page is placed on A4', async (t) => {
    const fontPath = findJapaneseFont();
    if (!fontPath) {
        t.skip('Japanese font is not available');
        return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-stamp-rotate-'));
    const inputPath = path.join(tempDir, '乙1_test.pdf');
    const sourceDoc = await PDFDocument.create();
    const page = sourceDoc.addPage([585, 840]);
    page.drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    page.setRotation(degrees(90));
    fs.writeFileSync(inputPath, await sourceDoc.save());

    const stamped = await PDFDocument.load(await stampPdf(inputPath, path.join(tempDir, 'out.pdf'), '乙1', fs.readFileSync(fontPath), {}));
    assert.equal(getPageRotation(stamped.getPage(0)), 90);
});

// ─── 参考資料の刷り ─────────────────────────────────────────

/** 頁の内容ストリームを展開した文字列 */
async function pageContentText(bytes, pageIndex = 0) {
    const zlib = require('node:zlib');
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(pageIndex).node.Contents();
    if (!contents) return '';
    const streams = contents.asArray ? contents.asArray().map(ref => doc.context.lookup(ref)) : [contents];
    return streams.map(stream => {
        const raw = Buffer.from(stream.getContents());
        try { return zlib.inflateSync(raw).toString('latin1'); } catch (_) { return raw.toString('latin1'); }
    }).join('\n');
}

/** 黒の塗り（0 0 0 rg）で閉じた経路を塗る（h f）ものを、境目の黒帯とみなす */
const hasBand = (contentText) => /0 0 0 rg[\s\S]*?\nh\nf\n/.test(contentText);

test('stampPdf: stamps 参考資料1 on the first page with the band', async (t) => {
    const fontPath = findJapaneseFont();
    if (!fontPath) {
        t.skip('Japanese font is not available');
        return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-stamp-sanko-'));
    const inputPath = path.join(tempDir, '参考資料1_test.pdf');
    const sourceDoc = await PDFDocument.create();
    sourceDoc.addPage([595.28, 841.89]);
    sourceDoc.addPage([595.28, 841.89]);
    fs.writeFileSync(inputPath, await sourceDoc.save());

    const stamped = await stampPdf(inputPath, path.join(tempDir, 'out.pdf'), '参考資料1', fs.readFileSync(fontPath), { tab: true });
    const sizes = (text) => [...text.matchAll(/ ([\d.]+) Tf/g)].map(m => Number(m[1]));
    const first = await pageContentText(stamped, 0);

    // 白の縁取り8回と赤1回の番号だけを 20pt で刷り、黒帯を付ける。2頁目には何も刷らない
    assert.deepEqual(sizes(first), Array(9).fill(20));
    assert.equal(hasBand(first), true);
    assert.equal(await pageContentText(stamped, 1), '');
});

// ─── コマンドとしての実行 ───────────────────────────────────

test('CLI: stamps 参考資料 in number order with the band and the given merged name', async (t) => {
    const fontPath = findJapaneseFont();
    if (!fontPath) {
        t.skip('Japanese font is not available');
        return;
    }

    const { execFileSync } = require('node:child_process');
    const script = path.join(__dirname, '..', 'dist', 'src', 'stamp_evidence_number.js');
    // 文書ごとに頁数と /Rotate（縦長のまま）を変え、結合PDFの頁の並びで順番を確かめる
    const makeInputs = async (dir) => {
        const specs = [['参考資料10_c.pdf', 3, 0], ['参考資料2_b.pdf', 2, 180], ['参考資料1_a.pdf', 1, 0]];
        for (const [name, count, rotation] of specs) {
            const doc = await PDFDocument.create();
            for (let i = 0; i < count; i++) doc.addPage([595.28, 841.89]).setRotation(degrees(rotation));
            fs.writeFileSync(path.join(dir, name), await doc.save());
        }
        return specs.map(([name]) => path.join(dir, name));
    };

    const named = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-stamp-cli-'));
    const combined = '令和○年（行情）諮問第○号_参考資料.pdf';
    execFileSync(process.execPath, [
        script, '--no-blank-pages', '--combined-name', combined, ...await makeInputs(named),
    ], { encoding: 'utf8' });
    const namedOut = path.join(named, 'stamped');
    assert.deepEqual(fs.readdirSync(namedOut).sort(), [combined, '参考資料10_c.pdf', '参考資料1_a.pdf', '参考資料2_b.pdf'].sort());
    const mergedBytes = fs.readFileSync(path.join(namedOut, combined));
    const merged = await PDFDocument.load(mergedBytes);
    assert.deepEqual(merged.getPages().map(getPageRotation), [0, 180, 180, 0, 0, 0]);
    // 各文書の1頁目（結合PDFの1・2・4頁目）に黒帯が付く
    for (const pageIndex of [0, 1, 3]) {
        assert.equal(hasBand(await pageContentText(mergedBytes, pageIndex)), true);
    }

    // 名前を指定しなければ `_結合_参考資料一式.pdf`。空白頁も今までどおり補う
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-stamp-cli-'));
    execFileSync(process.execPath, [script, '--no-tab', ...await makeInputs(plain)], { encoding: 'utf8' });
    const plainMerged = await PDFDocument.load(fs.readFileSync(path.join(plain, 'stamped', '_結合_参考資料一式.pdf')));
    assert.equal(plainMerged.getPageCount(), 7);

    // 結合PDFの名前が個別のPDFと同じなら、何も作らずに止める
    const clash = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-stamp-cli-'));
    const clashInputs = await makeInputs(clash);
    assert.throws(() => execFileSync(process.execPath, [script, '--combined-name', '参考資料1_a', ...clashInputs], { stdio: 'pipe' }));
    assert.equal(fs.existsSync(path.join(clash, 'stamped')), false);
});
