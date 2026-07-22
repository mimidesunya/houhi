const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    postprocessPdfJsAssets,
    requiredDirectories,
    requiredFiles,
} = require('../scripts/package_pdfjs_release.js');

test('PDF raster dependencies stay pinned to the compatible runtime pair', () => {
    const packageJson = require('../package.json');
    assert.equal(packageJson.dependencies['pdfjs-dist'], '4.10.38');
    assert.equal(packageJson.dependencies['@napi-rs/canvas'], '0.1.100');
    assert.equal(packageJson.dependencies.canvas, undefined);
});

test('PDF.js release assets: copies every runtime asset required by the pinned version', (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-pdfjs-release-'));
    t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    const sourceDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const destinationDir = path.join(tempRoot, 'app', 'node_modules', 'pdfjs-dist');

    postprocessPdfJsAssets({
        sourceDir,
        destinationDir,
        packageDir: tempRoot,
        releaseRoot: tempRoot,
    });

    for (const relativePath of requiredFiles) {
        assert.ok(fs.statSync(path.join(destinationDir, relativePath)).isFile());
    }
    for (const relativePath of requiredDirectories) {
        assert.ok(fs.statSync(path.join(destinationDir, relativePath)).isDirectory());
    }
});
