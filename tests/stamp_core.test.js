const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');

const core = require('../dist/src/lib/stamp_core.js');

const A4 = [595.28, 841.89];
const A4_LANDSCAPE = [841.89, 595.28];

async function makePdf(sizes, rotations = []) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    sizes.forEach((size, index) => {
        const page = doc.addPage(size);
        page.drawText(`page ${index + 1}`, { x: 40, y: 40, size: 12, font });
        if (rotations[index]) page.setRotation(degrees(rotations[index]));
    });
    return doc.save();
}

/**
 * 文字を刷る代わりに、呼ばれた位置を記録する道具（幅は字数×字の大きさ×0.6）
 */
function recordingPainter(calls) {
    return async (_pdfDoc, stampText) => ({
        widthAt: size => stampText.length * size * 0.6,
        draw(_page, args) {
            calls.push({ stampText, ...args });
        },
    });
}

/**
 * 頁の内容（content stream）を文字列で返す。pdf-lib は保存時に圧縮するので、圧縮せずに保存し直してから読む。
 */
async function pageContentText(pdfBytes, pageIndex = 0) {
    const doc = await PDFDocument.load(pdfBytes);
    const plain = await PDFDocument.load(await doc.save({ useObjectStreams: false }));
    const page = plain.getPages()[pageIndex];
    const contents = page.node.Contents();
    const refs = contents && typeof contents.asArray === 'function' ? contents.asArray() : [contents];
    const zlib = require('node:zlib');
    return refs
        .map(ref => plain.context.lookup(ref))
        .map(stream => {
            const raw = Buffer.from(stream.getContents());
            const filter = stream.dict && stream.dict.get && String(stream.dict.get(require('pdf-lib').PDFName.of('Filter')) || '');
            return (/FlateDecode/.test(filter) ? zlib.inflateSync(raw) : raw).toString('latin1');
        })
        .join('\n');
}

// ─── ファイル名と番号 ─────────────────────────────

test('stamp_core: extractEvidenceNumber works without path and with Windows or POSIX paths', () => {
    assert.equal(core.extractEvidenceNumber('甲1_契約書.pdf'), '甲1');
    assert.equal(core.extractEvidenceNumber('C:\\証拠\\乙A1の2_写真.pdf'), '乙A1の2');
    assert.equal(core.extractEvidenceNumber('/tmp/証拠/甲３ー１_領収書.pdf'), '甲3-1');
    assert.equal(core.extractEvidenceNumber('参考資料２_答申.pdf'), '参考資料2');
    assert.equal(core.extractEvidenceNumber('メモ.pdf'), null);
});

test('stamp_core: mints numbers pad the main number to three digits and keep branches', () => {
    assert.equal(core.toMintsNumber('甲1'), '甲001');
    assert.equal(core.toMintsNumber('甲2-1'), '甲002-1');
    assert.equal(core.toMintsNumber('乙A12'), '乙A012');
    assert.equal(core.toMintsNumber('資料1'), '資料1');
    assert.equal(core.buildStampText('甲12', true), '甲012');
    assert.equal(core.buildOutputFilename('甲1_契約書.png', '甲1', true), '甲001_契約書.pdf');
    assert.equal(core.buildOutputFilename('C:\\x\\甲01_契約書.pdf', '甲1', true), '甲001_契約書.pdf');
    assert.equal(core.buildOutputFilename('甲1_契約書.pdf', '甲1', false), '甲1_契約書.pdf');
});

test('stamp_core: 資料 and 参考資料 take no 号証 and sort after 号証', () => {
    assert.equal(core.buildStampText('資料2-1'), '資料2-1');
    assert.equal(core.buildStampText('参考資料3'), '参考資料3');
    assert.equal(core.buildStampText('乙4'), '乙4号証');
    const names = ['参考資料1_a.pdf', '資料2_b.pdf', '甲10_c.pdf', '資料1_d.pdf', '甲2-1_e.pdf', '乙1_f.pdf', '甲2_g.pdf'];
    const sorted = [...names].sort((a, b) => core.compareSortKeys(core.naturalSortKey(a), core.naturalSortKey(b)));
    assert.deepEqual(sorted, ['甲2_g.pdf', '乙1_f.pdf', '甲2-1_e.pdf', '甲10_c.pdf', '資料1_d.pdf', '資料2_b.pdf', '参考資料1_a.pdf']
        .sort((a, b) => core.compareSortKeys(core.naturalSortKey(a), core.naturalSortKey(b))));
    // 種別の順（号証→資料→参考資料）
    assert.deepEqual(sorted.map(name => core.getMaterialKind(core.extractEvidenceNumber(name))),
        ['号証', '号証', '号証', '号証', '資料', '資料', '参考資料']);
    assert.equal(core.buildCombinedName(['資料1', '資料2']), '_結合_資料一式.pdf');
    assert.equal(core.buildCombinedName(['甲1', '資料1']), '_結合_一式.pdf');
    assert.equal(core.buildCombinedName(['甲1'], '諮問第1号_参考資料'), '諮問第1号_参考資料.pdf');
});

test('stamp_core: getBasename, getExtname and stripExtname handle both separators', () => {
    assert.equal(core.getBasename('a/b\\c.PDF'), 'c.PDF');
    assert.equal(core.getExtname('a/b\\c.PDF'), '.pdf');
    assert.equal(core.stripExtname('C:\\x\\甲1_写真.jpeg'), '甲1_写真');
    assert.equal(core.isImageFileName('甲1.JPG'), true);
    assert.equal(core.isImageFileName('甲1.pdf'), false);
});

// ─── 帯 ──────────────────────────────────────

test('stamp_core: the band runs to the page edge, steps down per index and cycles', () => {
    const metrics = core.getStampMetricsForA4Print(A4[0], A4[1]);
    const first = core.getStampLayout(A4[0], A4[1], 50, metrics, { tab: true, tabIndex: 0, tabSteps: 4 });
    const second = core.getStampLayout(A4[0], A4[1], 50, metrics, { tab: true, tabIndex: 1, tabSteps: 4 });
    const fifth = core.getStampLayout(A4[0], A4[1], 50, metrics, { tab: true, tabIndex: 4, tabSteps: 4 });
    assert.ok(Math.abs(first.tabRect.x + first.tabRect.width - A4[0]) < 1e-9, 'band reaches the right edge');
    assert.ok(Math.abs(first.textY - second.textY - metrics.fontSize) < 1e-9, 'one band lower per index');
    assert.equal(fifth.textY, first.textY, 'back to the top after tabSteps');
    assert.ok(first.textX + 50 < first.tabRect.x, 'number sits left of the band');
});

test('stamp_core: stampPdfBytes draws the striped band (clip + white + black stripes) only with tab and never for mints', async () => {
    const input = await makePdf([A4]);
    const calls = [];
    const withTab = await core.stampPdfBytes(input, '甲1', recordingPainter(calls), { tab: true });
    const noTab = await core.stampPdfBytes(input, '甲1', recordingPainter(calls), { tab: false });
    const mints = await core.stampPdfBytes(input, '甲1', recordingPainter(calls), { tab: true, mints: true });

    const tabContent = await pageContentText(withTab.bytes);
    assert.match(tabContent, /W\s+n/, 'clips to the band');
    assert.match(tabContent, /1 1 1 rg/, 'white underlay');
    assert.match(tabContent, /0 0 0 rg/, 'black stripes');
    assert.doesNotMatch(await pageContentText(noTab.bytes), /W\s+n/);
    assert.doesNotMatch(await pageContentText(mints.bytes), /W\s+n/);
    assert.equal(withTab.stampText, '甲1号証');
    assert.equal(mints.stampText, '甲001');
    assert.equal(calls.length, 3);
});

// ─── 回転 ──────────────────────────────────────

test('stamp_core: with the band, landscape pages are turned to portrait and the stamp goes to the displayed top-right', async () => {
    const input = await makePdf([A4_LANDSCAPE, A4]);
    const calls = [];
    const result = await core.stampPdfBytes(input, '甲2', recordingPainter(calls), { tab: true, allPages: true });
    const doc = await PDFDocument.load(result.bytes);
    const [landscape, portrait] = doc.getPages();
    assert.equal(core.getPageRotation(landscape), 270);
    assert.equal(core.getPageRotation(portrait), 0);
    assert.deepEqual(core.getDisplaySize(landscape), { width: A4[0], height: A4[1] });
    // 表示したときの右上（縦長の頁と同じ位置）に刷る
    assert.equal(calls[0].rotation, 270);
    assert.equal(calls[1].rotation, 0);
    assert.ok(Math.abs(calls[0].x - calls[1].x) < 1e-6);
    assert.ok(Math.abs(calls[0].y - calls[1].y) < 1e-6);
});

test('stamp_core: without the band landscape pages are left as they are', async () => {
    const input = await makePdf([A4_LANDSCAPE]);
    const result = await core.stampPdfBytes(input, '甲2', recordingPainter([]), { tab: false });
    const [page] = (await PDFDocument.load(result.bytes)).getPages();
    assert.equal(core.getPageRotation(page), 0);
});

test('stamp_core: ensureA4Pages keeps /Rotate when it places a non-A4 page on A4', async () => {
    const input = await makePdf([[612, 792], A4], [90, 0]);
    const output = await core.ensureA4Pages(input);
    const pages = (await PDFDocument.load(output)).getPages();
    assert.equal(core.getPageRotation(pages[0]), 90);
    assert.deepEqual(pages[0].getSize(), { width: A4[0], height: A4[1] });
    assert.equal(core.getPageRotation(pages[1]), 0);
});

test('stamp_core: the band on a page with /Rotate 90 is drawn in page space at the displayed top-right', async () => {
    // 横長の頁に /Rotate 90 が付いていると、表示は縦長になる。回さずに、表示の右上へ帯を刷る
    const input = await makePdf([A4_LANDSCAPE], [90]);
    const result = await core.stampPdfBytes(input, '甲3', recordingPainter([]), { tab: true });
    const page = (await PDFDocument.load(result.bytes)).getPages()[0];
    assert.equal(core.getPageRotation(page), 90);
    const content = await pageContentText(result.bytes);
    const clip = content.match(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\s+W\s+n/);
    assert.ok(clip, content.slice(0, 400));
    const [x, y, w, h] = clip.slice(1).map(Number);
    // /Rotate 90 では、表示の右端（u = 表示の幅）は頁の座標の上端（y = 頁の高さ）、表示の上端は頁の左端（x = 0）に当たる
    const { width: pageW, height: pageH } = page.getSize();
    assert.ok(Math.abs(y + h - pageH) < 0.01, `band reaches the displayed right edge: ${y + h} vs ${pageH}`);
    assert.ok(x < 80, `band is near the displayed top: x=${x}`);
    assert.ok(x + w <= pageW && y >= 0);
});

// ─── 結合 ──────────────────────────────────────

test('stamp_core: mergeStampedPdfBytes adds a blank page after odd documents with the same rotation, not after the last', async () => {
    const odd = await makePdf([A4], [90]);
    const even = await makePdf([A4, A4]);
    const merged = await core.mergeStampedPdfBytes([odd, even, odd], { insertBlankPages: true });
    assert.equal(merged.totalPages, 5);
    assert.equal(merged.blankPages, 1);
    const pages = (await PDFDocument.load(merged.bytes)).getPages();
    assert.equal(core.getPageRotation(pages[1]), 90, 'blank page follows the rotation of the last page');
    const none = await core.mergeStampedPdfBytes([odd, even], { insertBlankPages: false });
    assert.equal(none.blankPages, 0);
});

test('stamp_core: convertImageBytesToPdf places a PNG on an A4 page of the same orientation', async () => {
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(300, 200);
    const png = canvas.toBuffer('image/png');
    const pdf = await core.convertImageBytesToPdf(new Uint8Array(png), true);
    const [page] = (await PDFDocument.load(pdf)).getPages();
    assert.deepEqual(page.getSize(), { width: A4_LANDSCAPE[0], height: A4_LANDSCAPE[1] });
});
