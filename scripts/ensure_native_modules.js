const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const canvasModulePath = path.join(repoRoot, 'node_modules', '@napi-rs', 'canvas');
const canvasPackagePath = path.join(canvasModulePath, 'package.json');

function canLoadCanvas() {
    try {
        const { createCanvas } = require(canvasModulePath);
        const canvas = createCanvas(1, 1);
        const context = canvas.getContext('2d');
        context.fillStyle = '#000000';
        context.fillRect(0, 0, 1, 1);
        const pixel = context.getImageData(0, 0, 1, 1).data;
        if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0 || pixel[3] !== 255) {
            throw new Error('@napi-rs/canvas produced an unexpected test pixel.');
        }
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
    const result = spawnSync(npmCommand, ['rebuild', '@napi-rs/canvas'], {
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
        console.error('[native] @napi-rs/canvas is not installed. Run npm install first.');
        process.exit(1);
    }

    if (canLoadCanvas()) {
        return;
    }

    console.log(`[native] rebuilding @napi-rs/canvas for ${process.platform}...`);
    rebuildCanvas();

    if (!canLoadCanvas()) {
        console.error('[native] @napi-rs/canvas is still unavailable after rebuild.');
        process.exit(1);
    }
}

main();
