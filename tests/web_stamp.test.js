/**
 * Web 版の号証スタンプ（web/stamp.js）を、DOM の代わりの簡単な物で Node の上で動かして確かめる。
 * canvas は @napi-rs/canvas、PDF は pdf-lib（ブラウザでは unpkg から読み込む window.PDFLib）を使う。
 * 字形は端末のフォントになるので、字の形ではなく、ZIP の中身・番号・帯・回転を見る。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const AdmZip = require('adm-zip');
const PDFLib = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');

const { PDFDocument, StandardFonts, degrees, PDFName } = PDFLib;
const bundleSource = fs.readFileSync(path.resolve('web/stamp.js'), 'utf-8');

const A4 = [595.28, 841.89];
const A4_LANDSCAPE = [841.89, 595.28];

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.textContent = '';
        this.hidden = false;
        this.max = 1;
        this.scrollTop = 0;
        this.scrollHeight = 0;
        this.files = [];
        this.listeners = {};
        this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(type, handler) {
        (this.listeners[type] ||= []).push(handler);
    }
    dispatch(type, event = {}) {
        for (const handler of this.listeners[type] || []) handler({ preventDefault() {}, target: this, ...event });
    }
    focus() {}
    click() { this.dispatch('click'); }
    remove() {}
}

class FakeCanvas {
    constructor() {
        this.width = 300;
        this.height = 150;
        this.real = null;
    }
    getContext() {
        if (!this.real || this.real.width !== this.width || this.real.height !== this.height) {
            this.real = createCanvas(this.width, this.height);
        }
        return this.real.getContext('2d');
    }
    toBlob(callback, type) {
        callback(new Blob([this.real.toBuffer('image/png')], { type }));
    }
}

/**
 * stamp.html の要素の代わりを用意して web/stamp.js を読み込み、操作の道具を返す
 */
function loadWebStamp() {
    const ids = [
        'stampFileInput', 'stampDropZone', 'chooseStampFilesButton', 'stampButton', 'stampAllPages', 'stampNoBlankPages',
        'stampTab', 'stampTabSteps', 'stampMints', 'stampCombinedName', 'stampStatus', 'stampSummary', 'stampLog',
        'stampProgress', 'stampProgressText',
    ];
    const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id)]));
    elements.stampTab.checked = true;
    elements.stampTabSteps.value = '4';
    const downloads = [];
    const blobs = new Map();
    let blobId = 0;

    const fakeDocument = {
        getElementById: id => elements[id] || null,
        createElement(tag) {
            if (tag === 'canvas') return new FakeCanvas();
            const element = new FakeElement();
            element.click = () => downloads.push({ name: element.download, blob: blobs.get(element.href) });
            return element;
        },
        body: { appendChild() {} },
        fonts: undefined,
    };
    const fakeWindow = { PDFLib, setTimeout, clearTimeout };
    const fakeURL = {
        createObjectURL(blob) {
            const url = `blob:test-${++blobId}`;
            blobs.set(url, blob);
            return url;
        },
        revokeObjectURL() {},
    };

    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'URL', bundleSource)(fakeWindow, fakeDocument, fakeURL);

    return {
        elements,
        downloads,
        select(files) {
            elements.stampFileInput.files = files;
            elements.stampFileInput.dispatch('change');
        },
        async run() {
            const before = downloads.length;
            elements.stampButton.dispatch('click');
            for (let i = 0; i < 400; i++) {
                if (/^作成しました|^作成に失敗|結合PDFの名前/.test(elements.stampStatus.textContent) && downloads.length > before) break;
                if (/^作成に失敗|結合PDFの名前/.test(elements.stampStatus.textContent)) break;
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            return downloads.slice(before);
        },
    };
}

async function makePdfFile(name, sizes) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const size of sizes) {
        doc.addPage(size).drawText('evidence', { x: 40, y: 40, size: 12, font });
    }
    return new File([await doc.save()], name, { type: 'application/pdf' });
}

async function readZip(download) {
    return new AdmZip(Buffer.from(await download.blob.arrayBuffer()));
}

async function pageContent(pdfBytes, pageIndex = 0) {
    const doc = await PDFDocument.load(pdfBytes);
    const page = doc.getPages()[pageIndex];
    const contents = page.node.Contents();
    const refs = typeof contents.asArray === 'function' ? contents.asArray() : [contents];
    return refs.map(ref => {
        const stream = doc.context.lookup(ref);
        const raw = Buffer.from(stream.getContents());
        const filter = String(stream.dict.get(PDFName.of('Filter')) || '');
        return (/FlateDecode/.test(filter) ? zlib.inflateSync(raw) : raw).toString('latin1');
    }).join('\n');
}

test('web stamp: stamps 号証 and 資料 with the striped band, turns landscape pages and merges in number order', async () => {
    const stamp = loadWebStamp();
    stamp.select([
        await makePdfFile('甲2_横.pdf', [A4_LANDSCAPE]),
        await makePdfFile('資料1_通知.pdf', [A4]),
        await makePdfFile('メモ.pdf', [A4]),
        await makePdfFile('甲1_縦.pdf', [A4, A4]),
    ]);
    assert.match(stamp.elements.stampSummary.textContent, /スタンプ対象 3件、除外 1件/);
    assert.match(stamp.elements.stampLog.value, /対象: 資料1 ← 資料1_通知\.pdf/);
    assert.match(stamp.elements.stampLog.value, /対象: 甲1号証 ← 甲1_縦\.pdf/);

    const [download] = await stamp.run();
    assert.equal(download.name, 'stamped_一式.zip');
    const zip = await readZip(download);
    assert.deepEqual(zip.getEntries().map(entry => entry.entryName), [
        'stamped/甲1_縦.pdf',
        'stamped/甲2_横.pdf',
        'stamped/資料1_通知.pdf',
        'stamped/_結合_一式.pdf',
    ]);

    const landscape = zip.readFile('stamped/甲2_横.pdf');
    const [turned] = (await PDFDocument.load(landscape)).getPages();
    assert.equal(turned.getRotation().angle, 270, 'landscape page is turned so that it shows portrait');
    const content = await pageContent(landscape);
    assert.match(content, /re\s+W\s+n/, 'band is clipped to its rectangle');
    assert.match(content, /0 0 0 rg/, 'black stripes');
    assert.match(content, /Do/, 'stamp image is drawn');

    const merged = await PDFDocument.load(zip.readFile('stamped/_結合_一式.pdf'));
    // 甲1（2頁）＋甲2（1頁）＋空白1頁＋資料1（1頁）
    assert.equal(merged.getPageCount(), 5);
});

test('web stamp: mints writes 甲001-style files into mints/ without merging, band or turning', async () => {
    const stamp = loadWebStamp();
    stamp.elements.stampMints.checked = true;
    stamp.elements.stampMints.dispatch('change');
    assert.equal(stamp.elements.stampTab.disabled, true);
    assert.equal(stamp.elements.stampCombinedName.disabled, true);
    stamp.select([
        await makePdfFile('甲1_契約書.pdf', [A4]),
        await makePdfFile('甲2-1_写真.pdf', [A4_LANDSCAPE]),
    ]);
    assert.match(stamp.elements.stampLog.value, /対象: 甲002-1 ← 甲2-1_写真\.pdf/);

    const [download] = await stamp.run();
    assert.equal(download.name, 'mints_号証一式.zip');
    const zip = await readZip(download);
    assert.deepEqual(zip.getEntries().map(entry => entry.entryName), ['mints/甲001_契約書.pdf', 'mints/甲002-1_写真.pdf']);
    const photo = zip.readFile('mints/甲002-1_写真.pdf');
    const [page] = (await PDFDocument.load(photo)).getPages();
    assert.equal(page.getRotation().angle, 0);
    assert.doesNotMatch(await pageContent(photo), /re\s+W\s+n/);
});

test('web stamp: keeps /Rotate of a non-A4 page and uses the given merged name', async () => {
    const stamp = loadWebStamp();
    stamp.elements.stampCombinedName.value = '諮問第1号_参考資料';
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).setRotation(degrees(90));
    const rotated = new File([await doc.save()], '参考資料2_答申.pdf', { type: 'application/pdf' });
    stamp.select([rotated, await makePdfFile('参考資料1_通知.pdf', [A4])]);
    assert.match(stamp.elements.stampLog.value, /対象: 参考資料2 ← 参考資料2_答申\.pdf/);

    const [download] = await stamp.run();
    assert.equal(download.name, 'stamped_参考資料一式.zip');
    const zip = await readZip(download);
    assert.deepEqual(zip.getEntries().map(entry => entry.entryName), [
        'stamped/参考資料1_通知.pdf',
        'stamped/参考資料2_答申.pdf',
        'stamped/諮問第1号_参考資料.pdf',
    ]);
    const [page] = (await PDFDocument.load(zip.readFile('stamped/参考資料2_答申.pdf'))).getPages();
    // レター縦に /Rotate 90 → 表示は横長 → A4 に載せ直して /Rotate を保ち、帯のために縦へ回す（90 + 270）
    assert.deepEqual(page.getSize(), { width: A4[0], height: A4[1] });
    assert.equal(page.getRotation().angle, 0);
});

test('web stamp: a merged name that clashes with a stamped file is refused', async () => {
    const stamp = loadWebStamp();
    stamp.elements.stampCombinedName.value = '甲1_契約書';
    stamp.select([await makePdfFile('甲1_契約書.pdf', [A4]), await makePdfFile('甲2_領収書.pdf', [A4])]);
    const downloads = await stamp.run();
    assert.equal(downloads.length, 0);
    assert.match(stamp.elements.stampStatus.textContent, /同じです/);
});

test('web stamp: a single file is downloaded as a PDF', async () => {
    const stamp = loadWebStamp();
    stamp.select([await makePdfFile('乙A1の2_写真.pdf', [A4])]);
    const [download] = await stamp.run();
    assert.equal(download.name, '乙A1の2_写真.pdf');
    assert.equal(download.blob.type, 'application/pdf');
});
