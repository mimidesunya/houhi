const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configLoader = require('../dist/src/lib/config_loader.js');

// ─── ヘルパー ───────────────────────────────────────────────

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-cfg-'));
}

// ─── findConfigPath ─────────────────────────────────────────

test('findConfigPath: finds config.json from nested working directory', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = makeTempDir();
    const nestedDir = path.join(tempRoot, 'nested', 'deeper');
    fs.mkdirSync(nestedDir, { recursive: true });

    const configPath = path.join(tempRoot, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ copper: { serverUri: 'ctip://example/' } }), 'utf8');

    process.chdir(nestedDir);
    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    assert.equal(configLoader.findConfigPath(), configPath);
});

test('findConfigPath: returns null when no config.json exists', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = makeTempDir();
    process.chdir(tempRoot);
    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    const result = configLoader.findConfigPath();
    assert.ok(result === null || fs.existsSync(result));
});

test('findConfigPath: finds config.json in current directory', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = makeTempDir();
    const configPath = path.join(tempRoot, 'config.json');
    fs.writeFileSync(configPath, '{}', 'utf8');

    process.chdir(tempRoot);
    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    assert.equal(configLoader.findConfigPath(), configPath);
});

// ─── loadConfig ─────────────────────────────────────────────

test('loadConfig: loads and parses valid config.json', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = makeTempDir();
    const configData = {
        copper: { serverUri: 'ctip://test/' },
        mail: { host: 'smtp.example.com' }
    };
    fs.writeFileSync(path.join(tempRoot, 'config.json'), JSON.stringify(configData), 'utf8');

    process.chdir(tempRoot);
    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    assert.deepEqual(configLoader.loadConfig(), configData);
});

test('loadConfig: copies config.template.json when config.json is missing', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = makeTempDir();
    const configPath = path.join(tempRoot, 'config.json');
    const templateData = {
        copper: { serverUri: 'ctip://template/', user: 'template-user' },
        mail: { user: 'mail@example.test' }
    };
    fs.writeFileSync(path.join(tempRoot, 'config.template.json'), JSON.stringify(templateData), 'utf8');

    process.chdir(tempRoot);
    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    assert.deepEqual(configLoader.loadConfig(), templateData);
    assert.equal(configLoader.findConfigPath(), configPath);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), templateData);
});

test('loadConfig: returns null for invalid JSON', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = makeTempDir();
    fs.writeFileSync(path.join(tempRoot, 'config.json'), '{invalid json', 'utf8');

    process.chdir(tempRoot);
    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    assert.equal(configLoader.loadConfig(), null);
});

test('loadConfig: returns config with nested properties', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = makeTempDir();
    const configData = {
        copper: {
            serverUri: 'ctip://cti.li/',
            user: 'admin',
            password: 'secret',
            properties: {
                'output.pdf.version': '1.7',
                'output.resolution': '300'
            }
        }
    };
    fs.writeFileSync(path.join(tempRoot, 'config.json'), JSON.stringify(configData), 'utf8');

    process.chdir(tempRoot);
    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    const loaded = configLoader.loadConfig();
    assert.equal(loaded.copper.serverUri, 'ctip://cti.li/');
    assert.equal(loaded.copper.properties['output.pdf.version'], '1.7');
});
