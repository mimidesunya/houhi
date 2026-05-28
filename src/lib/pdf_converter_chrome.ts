const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

function isExternalUri(value) {
    return /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value);
}

function splitRefSuffix(ref) {
    const match = String(ref).match(/^([^?#]*)([?#].*)?$/);
    return {
        main: match ? match[1] : ref,
        suffix: match && match[2] ? match[2] : ''
    };
}

function findLocalResource(ref, resourceDir, defaultTemplateDir) {
    if (!ref || isExternalUri(ref)) return null;

    const { main } = splitRefSuffix(ref);
    if (!main) return null;

    const candidates = [];
    if (path.isAbsolute(main)) {
        candidates.push(main);
    } else {
        candidates.push(path.resolve(resourceDir, main));
        candidates.push(path.join(resourceDir, path.basename(main)));
        if (defaultTemplateDir) {
            candidates.push(path.resolve(defaultTemplateDir, main));
            candidates.push(path.join(defaultTemplateDir, path.basename(main)));
        }
    }

    return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function prepareHtmlForChrome(htmlPath, outputPath, resourceDir, defaultTemplateDir) {
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const rewritten = htmlContent.replace(/\b(href|src)\s*=\s*(["'])([^"']+)\2/gi, (match, attr, quote, ref) => {
        const localPath = findLocalResource(ref, resourceDir, defaultTemplateDir);
        if (!localPath) return match;
        const { suffix } = splitRefSuffix(ref);
        return `${attr}=${quote}${pathToFileURL(localPath).href}${suffix}${quote}`;
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-chrome-html-'));
    const tempHtmlPath = path.join(tempDir, path.basename(htmlPath, path.extname(htmlPath)) + '.html');
    fs.writeFileSync(tempHtmlPath, rewritten, 'utf-8');

    return {
        htmlPath: tempHtmlPath,
        cleanup() {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_err) {}
        }
    };
}

function getChromeExecutableCandidates(config, options) {
    const chromeConfig = (config && config.chrome) || {};
    const pdfConfig = (config && config.pdf) || {};
    const configuredPath = options.chromePath || chromeConfig.executablePath || pdfConfig.chromePath || process.env.CHROME_PATH;
    const candidates = [];

    if (configuredPath) candidates.push(configuredPath);

    if (process.platform === 'win32') {
        const programFiles = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
        for (const root of programFiles) {
            candidates.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
            candidates.push(path.join(root, 'Chromium', 'Application', 'chrome.exe'));
        }
        candidates.push('chrome.exe', 'chromium.exe');
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            'google-chrome',
            'chromium'
        );
    } else {
        candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
    }

    return [...new Set(candidates.filter(Boolean))];
}

function resolveChromeExecutable(config, options) {
    const candidates = getChromeExecutableCandidates(config, options);
    for (const candidate of candidates) {
        if (path.isAbsolute(candidate)) {
            if (fs.existsSync(candidate)) return candidate;
        } else {
            return candidate;
        }
    }

    throw new Error('Chrome/Chromium が見つかりません。config.json の pdf.chromePath または環境変数 CHROME_PATH を設定してください。');
}

async function runChromePrint(chromePath, args, timeoutMs = 60000) {
    await new Promise((resolve, reject) => {
        const child = spawn(chromePath, args, {
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error(`Chrome PDF変換がタイムアウトしました (${timeoutMs}ms)`));
        }, timeoutMs);

        child.stderr.on('data', data => {
            stderr += data.toString();
        });
        child.on('error', err => {
            clearTimeout(timeout);
            reject(err);
        });
        child.on('close', code => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve(null);
                return;
            }
            reject(new Error(`Chrome PDF変換が失敗しました (code=${code})${stderr ? `: ${stderr.trim()}` : ''}`));
        });
    });
}

async function convertHtmlToPdfWithChrome(htmlPath, outputPath, resourceDir, defaultTemplateDir, config, options) {
    const chromePath = resolveChromeExecutable(config, options);
    const prepared = prepareHtmlForChrome(htmlPath, outputPath, resourceDir, defaultTemplateDir);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-chrome-profile-'));

    try {
        const originalHtmlContent = fs.readFileSync(htmlPath, 'utf-8');
        if (originalHtmlContent.includes('cssj:make-toc')) {
            console.warn('警告: Chrome PDFでは Copper PDF の cssj:make-toc 目次生成は使用できません。');
        }

        console.log(`ChromeでPDFを生成します: ${chromePath}`);
        const args = [
            '--headless=new',
            '--no-sandbox',
            '--disable-gpu',
            '--disable-gpu-sandbox',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--disable-features=VizDisplayCompositor',
            '--allow-file-access-from-files',
            '--no-pdf-header-footer',
            '--print-to-pdf-no-header',
            `--user-data-dir=${userDataDir}`,
            `--print-to-pdf=${outputPath}`,
            pathToFileURL(prepared.htmlPath).href
        ];

        await runChromePrint(chromePath, args);
        if (!fs.existsSync(outputPath)) {
            throw new Error(`Chrome PDF変換後に出力ファイルが見つかりません: ${outputPath}`);
        }
        console.log(`PDFの生成が完了しました: ${outputPath}`);
    } finally {
        prepared.cleanup();
        try {
            fs.rmSync(userDataDir, { recursive: true, force: true });
        } catch (_err) {}
    }
}

module.exports = {
    convertHtmlToPdfWithChrome
};
