const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const canvasPackagePath = path.join(repoRoot, 'node_modules', 'canvas', 'package.json');

function canLoadCanvas() {
    try {
        require(path.join(repoRoot, 'node_modules', 'canvas'));
        return true;
    } catch (error) {
        const message = String(error && error.message ? error.message : error);
        const rebuildableCodes = new Set(['MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED']);
        const rebuildableMessages = [
            'invalid ELF header',
            'not a valid Win32 application',
            'Module did not self-register'
        ];

        if (error && rebuildableCodes.has(error.code)) {
            return false;
        }

        if (rebuildableMessages.some((fragment) => message.includes(fragment))) {
            return false;
        }

        throw error;
    }
}

function rebuildCanvas() {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npmCommand, ['rebuild', 'canvas'], {
        cwd: repoRoot,
        env: process.env,
        stdio: 'inherit'
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function main() {
    if (!fs.existsSync(canvasPackagePath)) {
        return;
    }

    if (canLoadCanvas()) {
        return;
    }

    console.log(`[native] rebuilding canvas for ${process.platform}...`);
    rebuildCanvas();

    if (!canLoadCanvas()) {
        console.error('[native] canvas is still unavailable after rebuild.');
        process.exit(1);
    }
}

main();
