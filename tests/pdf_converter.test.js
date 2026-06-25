const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-pdf-'));
}

function loadPdfConverterWithMocks(config, calls) {
    const copperPath = require.resolve('copper-cti');
    const configLoaderPath = require.resolve('../dist/src/lib/config_loader.js');
    const pdfConverterPath = require.resolve('../dist/src/lib/pdf_converter.js');

    const originalCopperCache = require.cache[copperPath];
    const originalConfigCache = require.cache[configLoaderPath];
    delete require.cache[pdfConverterPath];

    require.cache[copperPath] = {
        id: copperPath,
        filename: copperPath,
        loaded: true,
        exports: {
            get_session: () => ({
                setOutputAsFile(outputPath) {
                    calls.outputPath = outputPath;
                },
                setProperty(name, value) {
                    calls.properties.push([name, value]);
                },
                setResolverFunc() {},
                setMessageFunc() {},
                transcode(baseUri) {
                    calls.baseUri = baseUri;
                    return {
                        write(content) {
                            calls.content = content;
                        },
                        end() {}
                    };
                },
                waitForCompletion: async () => {},
                close() {
                    calls.closed = true;
                }
            })
        }
    };

    require.cache[configLoaderPath] = {
        id: configLoaderPath,
        filename: configLoaderPath,
        loaded: true,
        exports: {
            loadConfig: () => config
        }
    };

    const converter = require('../dist/src/lib/pdf_converter.js');

    return {
        converter,
        restore() {
            delete require.cache[pdfConverterPath];
            if (originalCopperCache) {
                require.cache[copperPath] = originalCopperCache;
            } else {
                delete require.cache[copperPath];
            }
            if (originalConfigCache) {
                require.cache[configLoaderPath] = originalConfigCache;
            } else {
                delete require.cache[configLoaderPath];
            }
        }
    };
}

test('convertHtmlToPdf: uses at least three passes when generating toc', async (t) => {
    const tempRoot = makeTempDir();
    const htmlPath = path.join(tempRoot, 'toc.html');
    const outputPath = path.join(tempRoot, 'out.pdf');
    fs.writeFileSync(htmlPath, '<html><body><cssj:make-toc></cssj:make-toc></body></html>');
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const calls = { properties: [] };
    const { converter, restore } = loadPdfConverterWithMocks({
        pdf: {
            engine: 'copper'
        },
        copper: {
            properties: {
                'processing.pass-count': '2'
            }
        }
    }, calls);
    t.after(restore);

    await converter.convertHtmlToPdf(htmlPath, outputPath, tempRoot);

    assert.ok(calls.properties.some(([name, value]) => name === 'processing.page-references' && value === 'true'));
    assert.ok(calls.properties.some(([name, value]) => name === 'processing.pass-count' && value === '3'));
    assert.equal(calls.properties.some(([name, value]) => name === 'processing.pass-count' && value === '2'), false);
    assert.match(String(calls.content), /data-houhi-a4-page-size/);
    assert.match(String(calls.content), /@page\s*\{\s*size:\s*A4\s*;/);
    assert.equal(calls.closed, true);
});

test('convertHtmlToPdf: preserves configured pass count above three for toc', async (t) => {
    const tempRoot = makeTempDir();
    const htmlPath = path.join(tempRoot, 'toc.html');
    const outputPath = path.join(tempRoot, 'out.pdf');
    fs.writeFileSync(htmlPath, '<html><body><cssj:make-toc></cssj:make-toc></body></html>');
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const calls = { properties: [] };
    const { converter, restore } = loadPdfConverterWithMocks({
        pdf: {
            engine: 'copper'
        },
        copper: {
            properties: {
                'processing.pass-count': '4'
            }
        }
    }, calls);
    t.after(restore);

    await converter.convertHtmlToPdf(htmlPath, outputPath, tempRoot);

    assert.ok(calls.properties.some(([name, value]) => name === 'processing.pass-count' && value === '4'));
});

test('prepareHtmlForChrome: injects Paged.js and expands pre data-src before printing', (t) => {
    const tempRoot = makeTempDir();
    const htmlPath = path.join(tempRoot, 'input.html');
    const outputPath = path.join(tempRoot, 'out.pdf');
    fs.writeFileSync(path.join(tempRoot, 'style.css'), 'body { color: black; }');
    fs.writeFileSync(path.join(tempRoot, 'source.md'), '# 表題\n\n本文です');
    fs.writeFileSync(htmlPath, [
        '<!doctype html>',
        '<html lang="ja">',
        '<head><link rel="stylesheet" href="style.css"></head>',
        '<body><pre data-src="source.md"></pre></body>',
        '</html>'
    ].join('\n'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const chromeConverter = require('../dist/src/lib/pdf_converter_chrome.js');
    const prepared = chromeConverter.prepareHtmlForChrome(htmlPath, outputPath, tempRoot, tempRoot);
    t.after(prepared.cleanup);

    const preparedHtml = fs.readFileSync(prepared.htmlPath, 'utf-8');
    assert.match(preparedHtml, /data-houhi-pagedjs-polyfill/);
    assert.match(preparedHtml, /data-houhi-pagedjs-runner/);
    assert.match(preparedHtml, /data-houhi-a4-page-size/);
    assert.match(preparedHtml, /@page\s*\{\s*size:\s*A4\s*;/);
    assert.match(preparedHtml, /paged\.polyfill/);
    assert.match(preparedHtml, /file:\/\/\/.*style\.css/i);
    assert.equal(preparedHtml.includes('<pre data-src="source.md"></pre>'), false);
    assert.match(preparedHtml, /<div class="doc-title">表題<\/div>/);
    assert.match(preparedHtml, /<p>本文です<\/p>/);
});

test('prepareHtmlForChrome: converts cssj toc marker for Chrome/Paged.js', (t) => {
    const tempRoot = makeTempDir();
    const htmlPath = path.join(tempRoot, 'toc.html');
    const outputPath = path.join(tempRoot, 'out.pdf');
    fs.writeFileSync(htmlPath, [
        '<!doctype html>',
        '<html lang="ja"><body>',
        '<div class="toc-title">目次</div>',
        '<cssj:make-toc xmlns:cssj="http://www.cssj.jp/ns/cssjml"></cssj:make-toc>',
        '<h1>第1　見出し</h1>',
        '<h2>1　小見出し</h2>',
        '</body></html>'
    ].join('\n'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const chromeConverter = require('../dist/src/lib/pdf_converter_chrome.js');
    const prepared = chromeConverter.prepareHtmlForChrome(htmlPath, outputPath, tempRoot, tempRoot);
    t.after(prepared.cleanup);

    const preparedHtml = fs.readFileSync(prepared.htmlPath, 'utf-8');
    assert.equal(preparedHtml.includes('cssj:make-toc'), false);
    assert.match(preparedHtml, /<ul class="cssj-toc houhi-chrome-toc" data-houhi-chrome-toc="pending"><\/ul>/);
    assert.match(preparedHtml, /function prepareChromeToc/);
    assert.match(preparedHtml, /function fillChromeTocPageNumbers/);
    assert.match(preparedHtml, /cssj-leader/);
});

test('base stylesheet increments list counters on real li elements for Paged.js', () => {
    const stylePath = path.resolve('src/base/style.css');
    const css = fs.readFileSync(stylePath, 'utf-8');

    for (let level = 1; level <= 7; level++) {
        const liRule = new RegExp(`ol\\.lvl${level}\\s*>\\s*li\\s*\\{[^}]*counter-increment:\\s*cnt${level}\\b`, 's');
        const beforeRule = new RegExp(`ol\\.lvl${level}\\s*>\\s*li:before\\s*\\{[^}]*counter-increment:\\s*cnt${level}\\b`, 's');

        assert.match(css, liRule);
        assert.equal(beforeRule.test(css), false);
    }
});

test('base stylesheet fixes page size to A4', () => {
    const stylePath = path.resolve('src/base/style.css');
    const css = fs.readFileSync(stylePath, 'utf-8');

    assert.match(css, /@page\s*\{[^}]*size:\s*A4\s*;/s);
});

test('base stylesheet keeps info table labels on one line', () => {
    const stylePath = path.resolve('src/base/style.css');
    const css = fs.readFileSync(stylePath, 'utf-8');
    const rule = /table\.info\s+td:first-child\s*\{[^}]*white-space:\s*nowrap\b/s;

    assert.match(css, rule);
});

test('base stylesheet keeps ruby text small', () => {
    const stylePath = path.resolve('src/base/style.css');
    const css = fs.readFileSync(stylePath, 'utf-8');

    assert.match(css, /rt\s*\{[^}]*font-size:\s*50%\s*;[^}]*line-height:\s*1\s*;/s);
});

test('base stylesheet suppresses browser markers on heading list items', () => {
    const stylePath = path.resolve('src/base/style.css');
    const css = fs.readFileSync(stylePath, 'utf-8');

    assert.match(css, /li\.heading-item\s*\{[^}]*list-style-type:\s*none\b/s);
    assert.match(css, /li\.heading-item::marker\s*\{[^}]*content:\s*""\s*;/s);
    assert.match(css, /li\.heading-item:before\s*\{[^}]*visibility:\s*hidden\b/s);
    assert.match(css, /ol\.lvl1\s*>\s*li\.heading-item:before[\s\S]*?\{[^}]*display:\s*none\b[^}]*width:\s*0\b/s);
    assert.match(css, /ol\.lvl1\s*>\s*li\.heading-item\s*>\s*h1\s*\{[^}]*display:\s*block\b[^}]*margin-left:\s*0\b/s);
    assert.equal(/ol\.lvl1\s*>\s*li\.heading-item\s*>\s*h1\s*\{[^}]*margin-left:\s*1em\b/s.test(css), false);
});
