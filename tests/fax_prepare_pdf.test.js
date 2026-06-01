const test = require('node:test');
const assert = require('node:assert/strict');

const {
    computeLuminanceData,
    otsuThreshold,
    detectPhotoContent,
    toFaxBinaryAuto,
    toFaxBinary,
    parseArgs
} = require('../dist/src/fax_prepare_pdf.js');

// ─── ヘルパー: ImageData風オブジェクト生成 ──────────────────

function makeImageData(width, height, fillFn) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const [r, g, b, a] = fillFn(x, y);
            data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
        }
    }
    return { data, width, height };
}

// ─── computeLuminanceData ───────────────────────────────────

test('computeLuminanceData: computes histogram for white image', () => {
    const img = makeImageData(10, 10, () => [255, 255, 255, 255]);
    const result = computeLuminanceData(img, 10, 10);
    assert.equal(result.totalPixels, 100);
    assert.equal(result.histogram[255], 100);
    assert.equal(result.isRedInk.length, 100);
});

test('computeLuminanceData: computes histogram for black image', () => {
    const img = makeImageData(10, 10, () => [0, 0, 0, 255]);
    const result = computeLuminanceData(img, 10, 10);
    assert.equal(result.histogram[0], 100);
});

test('computeLuminanceData: detects red ink pixels', () => {
    // Red pixel: R=200, G=50, B=50 → R - min(G,B) = 150 > 30 && R > 60
    const img = makeImageData(2, 2, () => [200, 50, 50, 255]);
    const result = computeLuminanceData(img, 2, 2);
    for (let i = 0; i < 4; i++) {
        assert.equal(result.isRedInk[i], 1);
    }
});

test('computeLuminanceData: non-red pixels have isRedInk=0', () => {
    const img = makeImageData(2, 2, () => [100, 100, 100, 255]);
    const result = computeLuminanceData(img, 2, 2);
    for (let i = 0; i < 4; i++) {
        assert.equal(result.isRedInk[i], 0);
    }
});

test('computeLuminanceData: luminance calculation is correct', () => {
    // Single pixel: R=100, G=150, B=200
    // Luminance = 0.299*100 + 0.587*150 + 0.114*200 = 29.9 + 88.05 + 22.8 = 140.75
    const img = makeImageData(1, 1, () => [100, 150, 200, 255]);
    const result = computeLuminanceData(img, 1, 1);
    assert.ok(Math.abs(result.luminance[0] - 140.75) < 0.01);
});

// ─── otsuThreshold ──────────────────────────────────────────

test('otsuThreshold: returns threshold for bimodal histogram', () => {
    // Simulate: 50 pixels of value 50, 50 pixels of value 200
    const histogram = new Uint32Array(256);
    histogram[50] = 50;
    histogram[200] = 50;
    const result = otsuThreshold(histogram, 100);
    // Otsu picks first t that maximises between-class variance
    assert.ok(result >= 50 && result <= 200, `threshold ${result} should be between 50 and 200`);
});

test('otsuThreshold: returns 128 for flat histogram', () => {
    // All same value — variance is 0 everywhere
    const histogram = new Uint32Array(256);
    histogram[128] = 1000;
    const result = otsuThreshold(histogram, 1000);
    assert.equal(result, 128);
});

test('otsuThreshold: handles document-like histogram (bright background, dark text)', () => {
    const histogram = new Uint32Array(256);
    // Mostly white with some dark text
    histogram[240] = 900; // white background
    histogram[20] = 100;  // black text
    const result = otsuThreshold(histogram, 1000);
    assert.ok(result >= 20 && result <= 240, `threshold ${result}`);
});

// ─── detectPhotoContent ─────────────────────────────────────

test('detectPhotoContent: detects photo content with spread histogram', () => {
    const histogram = new Uint32Array(256);
    // Spread pixels across mid-tones (32-223)
    for (let i = 32; i < 224; i++) {
        histogram[i] = 10;
    }
    const totalPixels = 192 * 10; // 1920
    const result = detectPhotoContent(histogram, totalPixels);
    assert.equal(result.hasPhoto, true);
    assert.ok(result.midToneRatio > 0.15);
});

test('detectPhotoContent: no photo for document-like histogram', () => {
    const histogram = new Uint32Array(256);
    histogram[0] = 100;   // black text
    histogram[255] = 900; // white background
    const result = detectPhotoContent(histogram, 1000);
    assert.equal(result.hasPhoto, false);
    assert.ok(result.midToneRatio < 0.15);
});

test('detectPhotoContent: edge case at 15% threshold', () => {
    const histogram = new Uint32Array(256);
    histogram[100] = 150; // mid-tone
    histogram[255] = 850; // white
    // midToneRatio = 150/1000 = 0.15, boundary case
    const result = detectPhotoContent(histogram, 1000);
    assert.equal(result.hasPhoto, false); // 0.15 is not > 0.15
});

// ─── toFaxBinary ────────────────────────────────────────────

test('toFaxBinary: white pixels stay white above threshold', () => {
    const img = makeImageData(2, 2, () => [255, 255, 255, 255]);
    toFaxBinary(img, 128);
    for (let i = 0; i < img.data.length; i += 4) {
        assert.equal(img.data[i], 255);
        assert.equal(img.data[i + 1], 255);
        assert.equal(img.data[i + 2], 255);
    }
});

test('toFaxBinary: dark pixels become black below threshold', () => {
    const img = makeImageData(2, 2, () => [50, 50, 50, 255]);
    toFaxBinary(img, 128);
    for (let i = 0; i < img.data.length; i += 4) {
        assert.equal(img.data[i], 0);
    }
});

test('toFaxBinary: red ink pixels become black regardless of luminance', () => {
    // Red ink: R=200, G=30, B=30 → bright but red → should be black
    const img = makeImageData(2, 2, () => [200, 30, 30, 255]);
    toFaxBinary(img, 50);
    for (let i = 0; i < img.data.length; i += 4) {
        assert.equal(img.data[i], 0);
    }
});

test('toFaxBinary: alpha is always set to 255', () => {
    const img = makeImageData(2, 2, () => [128, 128, 128, 0]);
    toFaxBinary(img, 128);
    for (let i = 0; i < img.data.length; i += 4) {
        assert.equal(img.data[i + 3], 255);
    }
});

// ─── toFaxBinaryAuto ────────────────────────────────────────

test('toFaxBinaryAuto: returns threshold and photo detection', () => {
    const img = makeImageData(10, 10, () => [200, 200, 200, 255]);
    const result = toFaxBinaryAuto(img, 10, 10);
    assert.ok('threshold' in result);
    assert.ok('hasPhoto' in result);
    assert.ok('midToneRatio' in result);
});

test('toFaxBinaryAuto: produces binary output for document image', () => {
    // Simulate a document: half white, half black
    const img = makeImageData(10, 10, (x) => x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    const result = toFaxBinaryAuto(img, 10, 10);
    // All pixels should be either 0 or 255
    for (let i = 0; i < img.data.length; i += 4) {
        assert.ok(img.data[i] === 0 || img.data[i] === 255, `pixel ${i/4} = ${img.data[i]}`);
    }
});

test('toFaxBinaryAuto: uses neutral threshold for dithered photo content', () => {
    const img = makeImageData(20, 10, (x) => x < 10 ? [64, 64, 64, 255] : [192, 192, 192, 255]);
    const result = toFaxBinaryAuto(img, 20, 10);
    assert.equal(result.hasPhoto, true);
    assert.equal(result.threshold, 128);
});

// ─── parseArgs ──────────────────────────────────────────────

test('parseArgs: parses --auto flag', () => {
    const result = parseArgs(['--auto', 'file.pdf']);
    assert.equal(result.auto, true);
    assert.deepEqual(result.inputFiles, ['file.pdf']);
});

test('parseArgs: parses --dpi value', () => {
    const result = parseArgs(['--dpi', '300', 'file.pdf']);
    assert.equal(result.dpi, 300);
});

test('parseArgs: parses --threshold value', () => {
    const result = parseArgs(['--threshold', '200', 'file.pdf']);
    assert.equal(result.threshold, 200);
});

test('parseArgs: defaults when no options', () => {
    const result = parseArgs(['file1.pdf', 'file2.pdf']);
    assert.equal(result.dpi, 200);
    assert.equal(result.threshold, 170);
    assert.equal(result.auto, false);
    assert.deepEqual(result.inputFiles, ['file1.pdf', 'file2.pdf']);
});

test('parseArgs: throws on unknown option', () => {
    assert.throws(() => parseArgs(['--unknown']), /不明なオプション/);
});

test('parseArgs: throws on invalid dpi range', () => {
    assert.throws(() => parseArgs(['--dpi', '500']), /72〜400/);
    assert.throws(() => parseArgs(['--dpi', '10']), /72〜400/);
});

test('parseArgs: throws on invalid threshold range', () => {
    assert.throws(() => parseArgs(['--threshold', '300']), /0〜255/);
    assert.throws(() => parseArgs(['--threshold', '-1']), /0〜255/);
});

test('parseArgs: combines multiple options', () => {
    const result = parseArgs(['--auto', '--dpi', '150', 'a.pdf', 'b.pdf']);
    assert.equal(result.auto, true);
    assert.equal(result.dpi, 150);
    assert.deepEqual(result.inputFiles, ['a.pdf', 'b.pdf']);
});
