/**
 * Web 版の PDF 画面（web/pdf.html）を Chromium と WebKit で動かし、テンプレート36件と src/base/sample.md を組んで、
 * paged.js の頁（.pagedjs_page）ごとの本文（NFKC・空白除去）を比べる。
 * Windows（Chrome・Edge）と Mac（Safari）で、同じ書面が同じ頁数になり、本文が欠けも重なりもしないことを確かめる。
 *
 * - Playwright のブラウザが入っていなければ skip する（npx playwright install chromium webkit）。
 * - 本文は Noto Serif JP の Web フォントで組む。Google Fonts を読み込めない（オフライン）ときは、
 *   端末のフォントで組むことになり比べても意味がないので skip する。
 *
 * 改頁の位置が数行ずれることは許す。理由（2026-11-26 に測った）:
 * - WebKit は行の箱の高さを画面の画素に丸める。行送り 1.618em（12pt で 25.888px）は、Windows の 125% 表示の
 *   WebKit で 25.6px（0.8px 刻み）、Mac の Retina の Safari で 0.5px 刻み、Linux の WebKit で 1px 刻みになり、
 *   丸めない Chromium と 1頁（34行）で 10px ほど違う。余白（em）は丸めないので、頁の下の余りが少ない頁では
 *   WebKit のほうが1〜3行多く入る。CSS の行送りを 26px にしても、Windows の WebKit は 25.6px に丸めた。
 *   どの刻みでも割り切れる行送りは 4px の倍数（24px・28px）しかなく、体裁を変えずには一致させられない。
 * - ルビのある行の高さの増え方も違う（Chromium は +5px、WebKit は +11px）。
 * - Typst などで PDF を直接作るなら、この差は無くなる（docs/組版エンジン検討.md）。
 * 本文の欠け（2026-11-25 の証拠説明書の行が消えた件）や頁数の違いは許さない。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');

let playwright = null;
try {
    playwright = require('playwright');
} catch (_err) {
    playwright = null;
}

// 改頁の位置のずれとして許す字数（1行は37字ほど。3行分）
const MAX_PAGE_BREAK_SHIFT_CHARS = 120;

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function startServer() {
    const port = await freePort();
    const child = spawn(process.execPath, [path.resolve('scripts/serve_web.js'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('serve_web.js did not start')), 15000);
        child.stdout.on('data', chunk => {
            if (String(chunk).includes('HOUHI web preview')) {
                clearTimeout(timer);
                resolve();
            }
        });
        child.once('exit', code => reject(new Error(`serve_web.js exited (${code})`)));
    });
    return { url: `http://127.0.0.1:${port}/pdf.html`, stop: () => child.kill() };
}

function normalizePageText(text) {
    return String(text || '').normalize('NFKC').replace(/\s+/g, '');
}

/**
 * Markdown を入力欄に入れてプレビューを作り直し、頁ごとの本文と、Web フォントを読み込めたかを返す
 */
async function renderPages(page, markdown) {
    await page.evaluate(value => {
        const editor = document.getElementById('markdownInput');
        editor.value = value;
        editor.dispatchEvent(new Event('input'));
        document.getElementById('previewStatus').textContent = '';
        document.getElementById('renderButton').click();
    }, markdown);
    await page.waitForFunction(() => {
        const status = document.getElementById('previewStatus').textContent || '';
        return status.startsWith('プレビュー更新済み') || /エラー|タイムアウト|できませんでした/.test(status);
    }, null, { timeout: 60000 });
    return page.evaluate(() => {
        const frame = document.getElementById('previewFrame');
        const doc = frame.contentDocument;
        return {
            status: document.getElementById('previewStatus').textContent,
            font: doc.documentElement.getAttribute('data-houhi-web-font'),
            // 頁の本文の領域だけを取る（頁番号の欄、本文に入っている style 要素の中身、
            // 続きの頁に写した表頭（src/lib/paged_tables.ts の data-houhi-repeated-thead）は除く）
            pages: Array.from(doc.querySelectorAll('.pagedjs_page')).map(pageElement => {
                const area = pageElement.querySelector('.pagedjs_page_content');
                if (!area) return '';
                const clone = area.cloneNode(true);
                clone.querySelectorAll('style, script, [data-houhi-repeated-thead]').forEach(element => element.remove());
                return clone.textContent || '';
            }),
        };
    });
}

/**
 * 頁の境目ごとに、そこまでの字数の差を返す（改頁の位置のずれ）
 */
function pageBreakShifts(a, b) {
    const shifts = [];
    let totalA = 0;
    let totalB = 0;
    for (let index = 0; index < Math.min(a.length, b.length) - 1; index++) {
        totalA += a[index].length;
        totalB += b[index].length;
        shifts.push(totalB - totalA);
    }
    return shifts;
}

async function launch(browserType) {
    try {
        return await browserType.launch();
    } catch (err) {
        return { error: err };
    }
}

test('web PDF preview: Chromium and WebKit give the same pages and text for every template', { timeout: 15 * 60 * 1000 }, async t => {
    if (!playwright) {
        t.skip('playwright が入っていません（npm ci）');
        return;
    }
    const browsers = {};
    for (const name of ['chromium', 'webkit']) {
        const launched = await launch(playwright[name]);
        if (launched.error) {
            for (const browser of Object.values(browsers)) await browser.close();
            t.skip(`${name} を起動できません（npx playwright install chromium webkit）: ${launched.error.message.split('\n')[0]}`);
            return;
        }
        browsers[name] = launched;
    }

    const server = await startServer();
    try {
        const pages = {};
        for (const [name, browser] of Object.entries(browsers)) {
            // Mac の Safari は Retina（2倍）で動くので、WebKit も2倍で組む
            const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
            const page = await context.newPage();
            await page.goto(server.url);
            await page.waitForFunction(() => (document.getElementById('previewStatus').textContent || '').startsWith('プレビュー更新済み'), null, { timeout: 60000 });
            pages[name] = page;
        }

        const templates = await pages.chromium.evaluate(() => window.HOUHI_DRAFTING_DATA.templates.map(template => ({ name: template.name, content: template.content })));
        assert.equal(templates.length, fs.readdirSync(path.resolve('src/templates')).filter(name => name.endsWith('.md')).length);
        const documents = [
            ...templates,
            { name: 'sample', content: fs.readFileSync(path.resolve('src/base/sample.md'), 'utf-8') },
        ];

        const failures = [];
        const shifted = [];
        for (const document of documents) {
            const results = {};
            for (const [name, page] of Object.entries(pages)) {
                results[name] = await renderPages(page, document.content);
            }
            if (Object.values(results).some(result => result.font !== 'loaded')) {
                t.skip(`Noto Serif JP を読み込めませんでした（${Object.entries(results).map(([name, result]) => `${name}: ${result.font}`).join(', ')}）。オフラインでは比べません。`);
                return;
            }
            for (const result of Object.values(results)) {
                assert.ok(result.status.startsWith('プレビュー更新済み'), `${document.name}: ${result.status}`);
                assert.ok(result.pages.length > 0, `${document.name}: no pages`);
            }

            const chromium = results.chromium.pages.map(normalizePageText);
            const webkit = results.webkit.pages.map(normalizePageText);
            if (chromium.length !== webkit.length) {
                failures.push(`${document.name}: 頁数が違う（Chromium ${chromium.length}頁 / WebKit ${webkit.length}頁）`);
                continue;
            }
            if (chromium.join('') !== webkit.join('')) {
                failures.push(`${document.name}: 本文が違う（欠けか重なり）`);
                continue;
            }
            const shifts = pageBreakShifts(chromium, webkit);
            const worst = shifts.reduce((max, shift) => Math.max(max, Math.abs(shift)), 0);
            if (worst > MAX_PAGE_BREAK_SHIFT_CHARS) {
                failures.push(`${document.name}: 改頁の位置が ${worst}字ずれる（${shifts.join(', ')}）`);
            } else if (worst > 0) {
                shifted.push(`${document.name}: ${shifts.map((shift, index) => `${index + 1}頁末 ${shift > 0 ? '+' : ''}${shift}字`).join('、')}`);
            }
        }

        t.diagnostic(`改頁の位置が WebKit で少しずれた文書 ${shifted.length}/${documents.length}件（WebKit の行の高さの丸めによる。ファイルの先頭の説明を参照）`);
        for (const line of shifted) t.diagnostic(`  ${line}`);
        assert.deepEqual(failures, []);
    } finally {
        server.stop();
        for (const browser of Object.values(browsers)) await browser.close();
    }
});
