const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const configEditor = require('../dist/src/lib/config_editor.js');

function makeTempProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-config-editor-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
    fs.writeFileSync(
        path.join(dir, 'config.template.json'),
        JSON.stringify({
            copper: {
                serverUri: 'ctip://template/',
                user: 'template-user',
                password: 'template-pass',
                properties: {
                    'output.pdf.version': '1.4A-1',
                },
            },
            mail: {
                smtp: { host: 'smtp.template', port: 465, secure: true, tlsMinVersion: 'TLSv1.2' },
                imap: { host: 'imap.template', port: 993, secure: true, tlsMinVersion: 'TLSv1.2' },
                user: 'mail@example.test',
                password: 'mail-pass',
            },
            mfax: {
                sendPassword: 'send-pass',
                fromAddress: 'from@example.test',
                selfFax: '0312345678',
            },
        }),
        'utf8'
    );
    return dir;
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

test('loadConfigForEditor: copies template to config.json when it is missing', () => {
    const dir = makeTempProject();
    try {
        const nested = path.join(dir, 'nested');
        fs.mkdirSync(nested);

        const result = configEditor.loadConfigForEditor([nested]);
        const createdConfig = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));

        assert.equal(result.exists, true);
        assert.equal(result.created, true);
        assert.equal(result.createdFromTemplate, true);
        assert.equal(result.configPath, path.join(dir, 'config.json'));
        assert.equal(result.config.copper.serverUri, 'ctip://template/');
        assert.equal(result.config.mail.smtp.host, 'smtp.template');
        assert.equal(createdConfig.copper.serverUri, 'ctip://template/');
        assert.equal(result.parseError, null);
    } finally {
        cleanup(dir);
    }
});

test('saveConfigFromEditor: writes config.json to resolved project root', () => {
    const dir = makeTempProject();
    try {
        const config = {
            copper: { serverUri: 'ctip://saved/', user: 'u', password: 'p', properties: {} },
            mail: {
                smtp: { host: 'smtp.saved', port: 587, secure: false, tlsMinVersion: 'TLSv1.2' },
                imap: { host: 'imap.saved', port: 993, secure: true, tlsMinVersion: 'TLSv1.2' },
                user: 'user@example.test',
                password: 'secret',
            },
            mfax: { sendPassword: 'fax-pass', fromAddress: 'from@example.test', selfFax: '0312345678' },
        };

        const result = configEditor.saveConfigFromEditor(config, [dir]);
        const saved = JSON.parse(fs.readFileSync(result.configPath, 'utf8'));

        assert.equal(result.configPath, path.join(dir, 'config.json'));
        assert.equal(saved.copper.serverUri, 'ctip://saved/');
        assert.equal(saved.mail.smtp.port, 587);
    } finally {
        cleanup(dir);
    }
});

test('loadConfigForEditor: merges existing config over template defaults', () => {
    const dir = makeTempProject();
    try {
        fs.writeFileSync(
            path.join(dir, 'config.json'),
            JSON.stringify({
                copper: {
                    user: 'actual-user',
                    properties: {
                        'output.resolution': '300',
                    },
                },
            }),
            'utf8'
        );

        const result = configEditor.loadConfigForEditor([dir]);

        assert.equal(result.exists, true);
        assert.equal(result.created, false);
        assert.equal(result.config.copper.serverUri, 'ctip://template/');
        assert.equal(result.config.copper.user, 'actual-user');
        assert.equal(result.config.copper.properties['output.pdf.version'], '1.4A-1');
        assert.equal(result.config.copper.properties['output.resolution'], '300');
    } finally {
        cleanup(dir);
    }
});

test('loadConfigForEditor: reports parse error and returns defaults for invalid config', () => {
    const dir = makeTempProject();
    try {
        fs.writeFileSync(path.join(dir, 'config.json'), '{invalid', 'utf8');

        const result = configEditor.loadConfigForEditor([dir]);

        assert.equal(result.exists, true);
        assert.equal(result.created, false);
        assert.ok(result.parseError);
        assert.equal(result.config.copper.serverUri, 'ctip://template/');
    } finally {
        cleanup(dir);
    }
});
