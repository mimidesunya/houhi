// ブラウザで読む物の大きさ（そのまま・gzip・brotli）
const fs = require('fs'); const zlib = require('zlib');
for (const f of process.argv.slice(2)) {
    const b = fs.readFileSync(f);
    const gz = zlib.gzipSync(b, { level: 9 }).length;
    const br = zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
    console.log(`${(b.length / 1e6).toFixed(2)} MB raw, ${(gz / 1e6).toFixed(2)} MB gzip, ${(br / 1e6).toFixed(2)} MB brotli  ${f.split(/[\/]/).slice(-1)[0]}`);
}
