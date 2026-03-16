const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configLoader = require('../dist/src/lib/config_loader.js');

test('findConfigPath and loadConfig find config.json from nested working directory', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-config-'));
    const nestedDir = path.join(tempRoot, 'nested', 'deeper');
    fs.mkdirSync(nestedDir, { recursive: true });

    const configPath = path.join(tempRoot, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
        copper: {
            serverUri: 'ctip://example/'
        }
    }), 'utf8');

    process.chdir(nestedDir);

    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    assert.equal(configLoader.findConfigPath(), configPath);
    assert.deepEqual(configLoader.loadConfig(), {
        copper: {
            serverUri: 'ctip://example/'
        }
    });
});
