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
