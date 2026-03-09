const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const geminiClient = require('../dist/src/lib/gemini_client.js');

test('findConfigPath and loadConfig find config.json from nested working directory', async (t) => {
    const originalCwd = process.cwd();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-config-'));
    const nestedDir = path.join(tempRoot, 'nested', 'deeper');
    fs.mkdirSync(nestedDir, { recursive: true });

    const configPath = path.join(tempRoot, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
        gemini: {
            apiKey: 'dummy-key',
            chatModel: 'dummy-model'
        }
    }), 'utf8');

    process.chdir(nestedDir);

    t.after(() => {
        process.chdir(originalCwd);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    assert.equal(geminiClient.findConfigPath(), configPath);
    assert.equal(geminiClient.getProjectRoot(), tempRoot);
    assert.deepEqual(geminiClient.loadConfig(), {
        gemini: {
            apiKey: 'dummy-key',
            chatModel: 'dummy-model'
        }
    });
    assert.equal(geminiClient.getApiKey(), 'dummy-key');
    assert.equal(geminiClient.getGeminiChatModel(), 'dummy-model');
});
