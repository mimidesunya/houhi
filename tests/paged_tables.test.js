const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getPagedTablesBrowserScript, registerPagedTableHandlers } = require('../dist/src/lib/paged_tables.js');
const { prepareHtmlForChrome } = require('../dist/src/lib/pdf_converter_chrome.js');
const { loadPdfJs } = require('../dist/src/lib/pdfjs_loader.js');

const TEMPLATE_DIR = path.resolve(__dirname, '../dist/src/base');
const HEADER = '甲号証標目原本写作成年月日作成者立証趣旨';

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-paged-tables-'));
}

function pad(n) {
    return String(n).padStart(2, '0');
}

// 長い標目の行・1頁を超える立証趣旨の行・短い行を混ぜた証拠説明書。
// 標目と立証趣旨はどの行も違う文にし、全文が PDF にちょうど1回ずつ出ているかを数える
// （行の途中の数行だけが消えても分かるように、行の頭と終わりの印だけでは数えない）。
function buildEvidence({ longSentences = 120 } = {}) {
    const titles = [];
    const purposes = [];
    const rows = [];
    const add = (no, title, date, purpose) => {
        titles.push(title);
        purposes.push(purpose);
        rows.push(`| ${no} | ${title} | 写し | ${date} | 佐賀豊 | ${purpose} |`);
    };
    for (let n = 1; n <= 8; n++) {
        // 「長」は PDF から部首補助の字（U+2ED1）で取れ、NFKC でも戻らないので使わない
        add(`8-${n}`, `【行${pad(n)}】令和8年10月${20 + n}日付ブログ記事「海上封鎖の嵐大作戦その${n}についての込み入った題名の記事」`,
            `令和8年10月${20 + n}日`, `本件記事${n}が公開されていた事実。【終${pad(n)}】`);
    }
    let longText = '';
    for (let k = 1; k <= longSentences; k++) longText += `第${k}文の立証趣旨です。`;
    add('9', '【行09】大部の記事の写し', '令和8年11月1日', `${longText}【終09】`);
    for (let n = 10; n <= 15; n++) {
        add(String(n), `【行${pad(n)}】短い書証${n}`, `令和8年11月${n}日`,
            `被告が本件記事${n}において原告の社会的評価を低下させる事実を摘示したこと、及び記事が現在も閲覧可能な状態に置かれていること。【終${pad(n)}】`);
    }
    const markdown = [
        '# 証拠説明書',
        '',
        '令和8年11月25日',
        '',
        '| 甲号証 | 標目 | 原本写 | 作成年月日 | 作成者 | 立証趣旨 |',
        '| :--- | :--- | :---: | :--- | :--- | :--- |',
        ...rows,
        ''
    ].join('\n');
    return { markdown, titles, purposes };
}

function assertEveryRowComplete(body, evidence) {
    evidence.titles.forEach(title => {
        assert.equal(countOf(body, title), 1, `標目「${title.slice(0, 20)}…」が全文そろってちょうど1回出る`);
    });
    evidence.purposes.forEach(purpose => {
        assert.equal(countOf(body, purpose), 1, `立証趣旨「${purpose.slice(0, 20)}…」が全文そろってちょうど1回出る`);
    });
}

function wrapHtml(markdown, headMarkup = '') {
    return `<!DOCTYPE html>
<html lang="ja" data-houhi-pdf-engine="chrome">
<head>
<meta charset="UTF-8">
<title>証拠説明書</title>
<link rel="stylesheet" href="style.css">
${headMarkup}
</head>
<body>
<pre>
${markdown}
</pre>
</body>
</html>`;
}

async function convertWithChrome(t, html) {
    const dir = makeTempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const htmlPath = path.join(dir, 'evidence.html');
    const pdfPath = path.join(dir, 'evidence.pdf');
    fs.writeFileSync(htmlPath, html, 'utf-8');
    const { convertHtmlToPdf } = require('../dist/src/lib/pdf_converter.js');
    try {
        await convertHtmlToPdf(htmlPath, pdfPath, dir, TEMPLATE_DIR, { engine: 'chrome', timeoutMs: 120000 });
    } catch (err) {
        if (/Chrome\/Chromium が見つかりません/.test(String(err && err.message))) {
            t.skip('Chrome/Chromium が無いので飛ばす');
            return null;
        }
        throw err;
    }
    return pdfPath;
}

async function readPageTexts(pdfPath) {
    const pdfjsLib = await loadPdfJs();
    const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const doc = await pdfjsLib.getDocument({
        data: new Uint8Array(fs.readFileSync(pdfPath)),
        standardFontDataUrl: path.join(pdfjsDir, 'standard_fonts') + path.sep,
        cMapUrl: path.join(pdfjsDir, 'cmaps') + path.sep,
        cMapPacked: true,
        useSystemFonts: false,
        disableFontFace: true,
        useWorkerFetch: false,
        isEvalSupported: false,
    }).promise;
    try {
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            // Chrome の PDF からは「目」「行」などが康熙部首（U+2F00〜）で取れるので NFKC でそろえる
            pages.push(content.items.map(item => item.str).join('').normalize('NFKC').replace(/\s+/g, ''));
        }
        const metadata = await doc.getMetadata();
        pages.title = (metadata && metadata.info && metadata.info.Title) || '';
        return pages;
    } finally {
        await doc.destroy();
    }
}

// 頁番号と、頁ごとに繰り返す表頭を除いて、頁をまたぐ文もつながるようにする
function joinBody(pages) {
    return pages.map(text => text.replace(/-\d+-/g, '').split(HEADER).join('')).join('');
}

function countOf(text, token) {
    return text.split(token).length - 1;
}

test('registerPagedTableHandlers: Paged.js が無ければ何もしない', () => {
    assert.equal(registerPagedTableHandlers({}), false);
});

test('registerPagedTableHandlers: ハンドラは1度だけ登録する', () => {
    const registered = [];
    class Handler {}
    const win = { Paged: { Handler, registerHandlers: (...handlers) => registered.push(...handlers) } };
    assert.equal(registerPagedTableHandlers(win), true);
    assert.equal(registerPagedTableHandlers(win), true);
    assert.equal(registered.length, 1);
    assert.equal(typeof registered[0].prototype.layout, 'function');
    assert.equal(typeof registered[0].prototype.onOverflow, 'function');
});

test('getPagedTablesBrowserScript: 頁に埋め込む文字列がそのまま実行できる', () => {
    const script = getPagedTablesBrowserScript();
    const run = new Function(`${script}; return { registerPagedTableHandlers, showPagedOverflow };`);
    const fns = run();
    assert.equal(typeof fns.registerPagedTableHandlers, 'function');
    assert.equal(typeof fns.showPagedOverflow, 'function');
});

test('prepareHtmlForChrome: Paged.js の前にハンドラを登録し、後で段組みを外す', (t) => {
    const dir = makeTempDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const htmlPath = path.join(dir, 'doc.html');
    fs.writeFileSync(htmlPath, wrapHtml('# 証拠説明書\n'), 'utf-8');
    const prepared = prepareHtmlForChrome(htmlPath, path.join(dir, 'doc.pdf'), dir, TEMPLATE_DIR);
    t.after(() => prepared.cleanup());
    const html = fs.readFileSync(prepared.htmlPath, 'utf-8');
    const register = html.indexOf('registerPagedTableHandlers(window);');
    const preview = html.indexOf('await window.PagedPolyfill.preview();');
    const fallback = html.indexOf('showPagedOverflow(document);');
    assert.ok(register > 0 && preview > register, 'preview() の前に登録する');
    assert.ok(fallback > preview, 'preview() の後で段組みを外す');
});

test('Chrome: 頁にまたがる証拠説明書の行が全部出て、続きの頁にも表頭と列幅が付く', async (t) => {
    const evidence = buildEvidence();
    const pdfPath = await convertWithChrome(t, wrapHtml(evidence.markdown));
    if (!pdfPath) return;
    const pages = await readPageTexts(pdfPath);
    assert.ok(pages.length >= 4, `頁にまたがる試料になっていない（${pages.length}頁）`);

    assertEveryRowComplete(joinBody(pages), evidence);
    pages.forEach((text, i) => {
        assert.ok(text.includes(HEADER), `${i + 1}頁に表頭がある`);
    });
});

test('Chrome: 頁割りの後で行が伸びても、頁末の行は消えずに余白へ出る', async (t) => {
    // 頁割りが終わった直後に、各頁の最後の行が本文領域の下へ 30px はみ出すように行を伸ばす
    // （行が2つ以上なら最後から2番目の行、1つだけならその行）。
    // 印刷のときの組み直しで行が伸びた状態（Web 版で行が消えた件）を模す。
    // はみ出しは下の余白（27mm ≒ 102px）に収まる量にする。
    // 伸ばした後、画面の組み上がりで頁（.pagedjs_sheet）の外へ出た行の断片を数えて、文書の題（PDF の Title）に書く。
    // Paged.js の段組みのままだと、はみ出した断片は頁の右の見えない段へ行く。
    // Chrome の印刷はそれを下へはみ出させることもあるので、PDF の文字だけでは確かめきれない
    const growth = `<script>
new MutationObserver(function (records, observer) {
    if (document.documentElement.getAttribute('data-houhi-paged') !== 'ready') return;
    observer.disconnect();
    var grown = 0;
    var pages = Array.prototype.slice.call(document.querySelectorAll('.pagedjs_page'));
    pages.forEach(function (page) {
        var sheet = page.querySelector('.pagedjs_sheet').getBoundingClientRect();
        var rows = page.querySelectorAll('tbody tr');
        if (rows.length < 1) return;
        var area = page.querySelector('.pagedjs_page_content').getBoundingClientRect();
        var bottom = 0;
        Array.prototype.forEach.call(rows[rows.length - 1].getClientRects(), function (r) {
            if (r.left < sheet.right && r.bottom > bottom) bottom = r.bottom;
        });
        var cell = rows[Math.max(0, rows.length - 2)].cells[1];
        if (!cell || !bottom) return;
        var pad = document.createElement('div');
        pad.style.height = Math.max(0, Math.round(area.bottom - bottom) + 30) + 'px';
        pad.textContent = '伸びた分';
        cell.appendChild(pad);
        grown++;
    });
    var outside = 0;
    pages.forEach(function (page) {
        var sheet = page.querySelector('.pagedjs_sheet').getBoundingClientRect();
        Array.prototype.forEach.call(page.querySelectorAll('tbody tr'), function (tr) {
            Array.prototype.forEach.call(tr.getClientRects(), function (r) {
                if (r.height > 0 && (r.left >= sheet.right - 1 || r.top >= sheet.bottom - 1)) outside++;
            });
        });
    });
    document.title = 'grown=' + grown + ' outside=' + outside;
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-houhi-paged'] });
</script>`;
    const evidence = buildEvidence({ longSentences: 20 });
    const pdfPath = await convertWithChrome(t, wrapHtml(evidence.markdown, growth));
    if (!pdfPath) return;
    const pages = await readPageTexts(pdfPath);
    const [, grown, outside] = String(pages.title).match(/^grown=(\d+) outside=(\d+)$/) || [];
    assert.ok(Number(grown) >= 3, `行を伸ばせていない（${pages.title}）`);
    assert.equal(Number(outside), 0, `頁の外へ出た行の断片がある（${pages.title}）`);
    assertEveryRowComplete(joinBody(pages), evidence);
});
