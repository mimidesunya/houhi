const fs = require('fs');
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { renderPreTags } = require('./markdown_renderer');
const { getPagedTocBrowserScript } = require('./paged_toc');

const A4_WIDTH_INCHES = 210 / 25.4;
const A4_HEIGHT_INCHES = 297 / 25.4;
const A4_PAGE_STYLE = '<style data-houhi-a4-page-size>@page { size: A4; }</style>';

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

function resolvePagedPolyfillPath() {
    try {
        const entryPath = require.resolve('pagedjs');
        const packageRoot = path.dirname(path.dirname(entryPath));
        const candidates = [
            path.join(packageRoot, 'dist', 'paged.polyfill.js'),
            path.join(packageRoot, 'dist', 'paged.polyfill.min.js')
        ];
        const found = candidates.find(candidate => fs.existsSync(candidate));
        if (found) return found;
    } catch (_err) {}

    throw new Error('Paged.js が見つかりません。npm install を実行して pagedjs をインストールしてください。');
}

function injectHeadMarkup(htmlContent, markup) {
    if (/<\/head>/i.test(htmlContent)) {
        return htmlContent.replace(/<\/head>/i, `${markup}\n</head>`);
    }

    if (/<html\b[^>]*>/i.test(htmlContent)) {
        return htmlContent.replace(/<html\b[^>]*>/i, match => `${match}\n<head>\n${markup}\n</head>`);
    }

    return `<!DOCTYPE html>
<html lang="ja">
<head>
${markup}
</head>
${htmlContent}
</html>`;
}

function injectA4PageSize(htmlContent) {
    if (htmlContent.includes('data-houhi-a4-page-size')) {
        return htmlContent;
    }
    return injectHeadMarkup(htmlContent, A4_PAGE_STYLE);
}

function prepareTocPlaceholdersForChrome(htmlContent) {
    return htmlContent.replace(/<cssj:make-toc\b[^>]*>\s*<\/cssj:make-toc>/gi, () => {
        return '<ul class="cssj-toc houhi-chrome-toc" data-houhi-chrome-toc="pending"></ul>';
    });
}

function injectPagedJsForChrome(htmlContent) {
    if (htmlContent.includes('data-houhi-pagedjs-runner')) {
        return htmlContent;
    }

    const pagedPolyfillPath = resolvePagedPolyfillPath();
    const pagedPolyfillUrl = pathToFileURL(pagedPolyfillPath).href;
    const markup = `${A4_PAGE_STYLE}
<script data-houhi-pagedjs-config>
window.PagedConfig = window.PagedConfig || {};
window.PagedConfig.auto = false;
</script>
<script data-houhi-pagedjs-polyfill src="${pagedPolyfillUrl}"></script>
<script data-houhi-pagedjs-runner>
(function () {
    var root = document.documentElement;
    window.__houhiPagedReady = false;
    window.__houhiPagedError = null;

    function finish(error) {
        if (error) {
            window.__houhiPagedError = String(error && (error.stack || error.message) || error);
            root.setAttribute('data-houhi-paged', 'error');
        } else {
            root.setAttribute('data-houhi-paged', 'ready');
        }
        window.__houhiPagedReady = true;
    }

    async function runPaged() {
        try {
            if (window.__houhiMarkdownPromise) {
                await window.__houhiMarkdownPromise;
            }
            if (document.fonts && document.fonts.ready) {
                await document.fonts.ready;
            }
            await new Promise(function (resolve) {
                requestAnimationFrame(function () {
                    requestAnimationFrame(resolve);
                });
            });
            prepareChromeToc();
            if (!window.PagedPolyfill || typeof window.PagedPolyfill.preview !== 'function') {
                throw new Error('Paged.js polyfill was not loaded');
            }
            await window.PagedPolyfill.preview();
            fillChromeTocPageNumbers();
            var pageNumberStyle = document.createElement('style');
            pageNumberStyle.setAttribute('data-houhi-pagedjs-page-numbers', 'manual');
            pageNumberStyle.textContent = 'html[data-houhi-pdf-engine="chrome"] body::before { content: none !important; display: none !important; } @page { size: A4; @bottom-center { content: none; } } .pagedjs_pages .pagedjs_margin-bottom .pagedjs_margin-bottom-center .pagedjs_margin-content::after { content: none !important; }';
            document.head.appendChild(pageNumberStyle);
            Array.prototype.forEach.call(document.querySelectorAll('.pagedjs_page'), function (page, index) {
                var footer = page.querySelector('.pagedjs_margin-bottom-center .pagedjs_margin-content');
                if (footer) {
                    if (footer.parentElement) {
                        footer.parentElement.classList.add('hasContent');
                    }
                    footer.textContent = '- ' + (index + 1) + ' -';
                }
            });
            finish(null);
        } catch (error) {
            finish(error);
        }
    }

    ${getPagedTocBrowserScript()}

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runPaged, { once: true });
    } else {
        runPaged();
    }
}());
</script>`;

    return injectHeadMarkup(htmlContent, markup);
}

function prepareHtmlForChrome(htmlPath, outputPath, resourceDir, defaultTemplateDir) {
    let htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    if (htmlContent.includes('<pre')) {
        htmlContent = renderPreTags(htmlContent, resourceDir);
    }

    const rewritten = htmlContent.replace(/\b(href|src)\s*=\s*(["'])([^"']+)\2/gi, (match, attr, quote, ref) => {
        const localPath = findLocalResource(ref, resourceDir, defaultTemplateDir);
        if (!localPath) return match;
        const { suffix } = splitRefSuffix(ref);
        return `${attr}=${quote}${pathToFileURL(localPath).href}${suffix}${quote}`;
    });

    const withTocPlaceholders = prepareTocPlaceholdersForChrome(rewritten);
    const withPagedJsRunner = injectPagedJsForChrome(withTocPlaceholders);
    const withPagedJs = injectA4PageSize(withPagedJsRunner);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-chrome-html-'));
    const tempHtmlPath = path.join(tempDir, path.basename(htmlPath, path.extname(htmlPath)) + '.html');
    fs.writeFileSync(tempHtmlPath, withPagedJs, 'utf-8');

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

function createMaskedWebSocketFrame(text) {
    const payload = Buffer.from(text);
    const mask = crypto.randomBytes(4);
    let header;

    if (payload.length < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81;
        header[1] = 0x80 | payload.length;
    } else if (payload.length <= 0xffff) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
    }

    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ mask[i % 4];
    }

    return Buffer.concat([header, mask, masked]);
}

class ChromeDevToolsClient {
    socket: any;
    buffer: Buffer;
    nextId: number;
    pending: Map<number, any>;
    eventWaiters: any[];

    constructor(socket) {
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        this.nextId = 1;
        this.pending = new Map();
        this.eventWaiters = [];

        socket.on('data', chunk => this.handleData(chunk));
        socket.on('error', err => this.rejectAll(err));
        socket.on('close', () => this.rejectAll(new Error('Chrome DevTools 接続が閉じられました。')));
    }

    send(method, params = {}, sessionId = null, timeoutMs = 60000) {
        const id = this.nextId++;
        const message: any = { id, method, params };
        if (sessionId) message.sessionId = sessionId;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Chrome DevTools コマンドがタイムアウトしました: ${method}`));
            }, timeoutMs);

            this.pending.set(id, { resolve, reject, timeout });
            this.socket.write(createMaskedWebSocketFrame(JSON.stringify(message)));
        });
    }

    waitForEvent(method, predicate = () => true, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            const waiter = { method, predicate, resolve, reject, timeout: null };
            waiter.timeout = setTimeout(() => {
                this.eventWaiters = this.eventWaiters.filter(item => item !== waiter);
                reject(new Error(`Chrome DevTools イベント待機がタイムアウトしました: ${method}`));
            }, timeoutMs);
            this.eventWaiters.push(waiter);
        });
    }

    handleData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        while (this.buffer.length >= 2) {
            const first = this.buffer[0];
            const second = this.buffer[1];
            const opcode = first & 0x0f;
            const masked = (second & 0x80) !== 0;
            let length = second & 0x7f;
            let offset = 2;

            if (length === 126) {
                if (this.buffer.length < offset + 2) return;
                length = this.buffer.readUInt16BE(offset);
                offset += 2;
            } else if (length === 127) {
                if (this.buffer.length < offset + 8) return;
                const bigLength = this.buffer.readBigUInt64BE(offset);
                if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
                    this.rejectAll(new Error('Chrome DevTools から大きすぎる WebSocket フレームを受信しました。'));
                    return;
                }
                length = Number(bigLength);
                offset += 8;
            }

            const maskOffset = offset;
            if (masked) offset += 4;
            if (this.buffer.length < offset + length) return;

            let payload = this.buffer.subarray(offset, offset + length);
            if (masked) {
                const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
                const unmasked = Buffer.alloc(payload.length);
                for (let i = 0; i < payload.length; i++) {
                    unmasked[i] = payload[i] ^ mask[i % 4];
                }
                payload = unmasked;
            }

            this.buffer = this.buffer.subarray(offset + length);

            if (opcode === 0x1) {
                this.handleMessage(payload.toString('utf-8'));
            } else if (opcode === 0x8) {
                this.socket.end();
                return;
            } else if (opcode === 0x9) {
                this.socket.write(Buffer.from([0x8a, 0x00]));
            }
        }
    }

    handleMessage(text) {
        let message;
        try {
            message = JSON.parse(text);
        } catch (_err) {
            return;
        }

        if (message.id && this.pending.has(message.id)) {
            const pending = this.pending.get(message.id);
            clearTimeout(pending.timeout);
            this.pending.delete(message.id);
            if (message.error) {
                pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
            } else {
                pending.resolve(message.result || {});
            }
            return;
        }

        if (message.method) {
            const waiters = this.eventWaiters.slice();
            for (const waiter of waiters) {
                if (waiter.method !== message.method) continue;
                if (!waiter.predicate(message)) continue;
                clearTimeout(waiter.timeout);
                this.eventWaiters = this.eventWaiters.filter(item => item !== waiter);
                waiter.resolve(message);
            }
        }
    }

    rejectAll(err) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(err);
        }
        this.pending.clear();

        for (const waiter of this.eventWaiters) {
            clearTimeout(waiter.timeout);
            waiter.reject(err);
        }
        this.eventWaiters = [];
    }

    close() {
        try {
            this.socket.end();
        } catch (_err) {}
    }
}

function connectDevToolsWebSocket(wsUrl, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(wsUrl);
        const host = parsed.hostname || '127.0.0.1';
        const port = Number(parsed.port);
        const requestPath = `${parsed.pathname}${parsed.search}`;
        const socket = net.createConnection({ host, port });
        const key = crypto.randomBytes(16).toString('base64');
        let handshakeBuffer = Buffer.alloc(0);
        const timeout = setTimeout(() => {
            socket.destroy();
            reject(new Error('Chrome DevTools WebSocket 接続がタイムアウトしました。'));
        }, timeoutMs);

        socket.on('connect', () => {
            socket.write([
                `GET ${requestPath} HTTP/1.1`,
                `Host: ${host}:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${key}`,
                'Sec-WebSocket-Version: 13',
                '',
                ''
            ].join('\r\n'));
        });

        socket.on('error', err => {
            clearTimeout(timeout);
            reject(err);
        });

        const onData = chunk => {
            handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
            const headerEnd = handshakeBuffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;

            const headerText = handshakeBuffer.subarray(0, headerEnd).toString('utf-8');
            if (!/^HTTP\/1\.[01] 101\b/.test(headerText)) {
                clearTimeout(timeout);
                socket.destroy();
                reject(new Error(`Chrome DevTools WebSocket 接続に失敗しました: ${headerText.split('\r\n')[0]}`));
                return;
            }

            socket.off('data', onData);
            clearTimeout(timeout);
            const client = new ChromeDevToolsClient(socket);
            const rest = handshakeBuffer.subarray(headerEnd + 4);
            if (rest.length > 0) {
                client.handleData(rest);
            }
            resolve(client);
        };

        socket.on('data', onData);
    });
}

function launchChromeForDevTools(chromePath, args, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(chromePath, args, {
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(new Error(`Chrome の起動がタイムアウトしました (${timeoutMs}ms)`));
        }, timeoutMs);

        child.stderr.on('data', data => {
            stderr += data.toString();
        });
        child.on('error', err => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(err);
        });
        child.on('spawn', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ child, getStderr: () => stderr });
        });
        child.on('exit', code => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error(`Chrome が起動直後に終了しました (code=${code})${stderr ? `: ${stderr.trim()}` : ''}`));
            }
        });
    });
}

async function waitForDevToolsWebSocket(userDataDir, timeoutMs = 30000) {
    const activePortPath = path.join(userDataDir, 'DevToolsActivePort');
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (fs.existsSync(activePortPath)) {
            const [portLine, wsPathLine] = fs.readFileSync(activePortPath, 'utf-8').trim().split(/\r?\n/);
            const port = Number(portLine);
            if (port && wsPathLine) {
                return `ws://127.0.0.1:${port}${wsPathLine}`;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error('Chrome DevTools の接続先取得がタイムアウトしました。');
}

async function waitForPagedJs(client, sessionId, timeoutMs = 60000) {
    const expression = `new Promise((resolve, reject) => {
        const startedAt = Date.now();
        function check() {
            if (window.__houhiPagedReady) {
                if (window.__houhiPagedError) {
                    reject(new Error(window.__houhiPagedError));
                } else {
                    resolve(true);
                }
                return;
            }
            if (Date.now() - startedAt > ${timeoutMs}) {
                reject(new Error('Paged.js rendering timed out'));
                return;
            }
            setTimeout(check, 100);
        }
        check();
    })`;

    const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
    }, sessionId, timeoutMs + 5000);

    if (result.exceptionDetails) {
        const details = result.exceptionDetails;
        const message = details.exception?.description || details.text || 'Paged.js の組版中にエラーが発生しました。';
        throw new Error(message);
    }
}

async function runChromePrintWithPagedJs(chromePath, htmlUrl, outputPath, userDataDir, timeoutMs = 60000) {
    const args = [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-gpu-sandbox',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--disable-features=VizDisplayCompositor',
        '--allow-file-access-from-files',
        '--remote-debugging-port=0',
        `--user-data-dir=${userDataDir}`,
        'about:blank'
    ];
    const launched: any = await launchChromeForDevTools(chromePath, args, timeoutMs);
    let client = null;
    let targetId = null;

    try {
        const browserWsUrl = await waitForDevToolsWebSocket(userDataDir, timeoutMs);
        client = await connectDevToolsWebSocket(browserWsUrl, timeoutMs);
        const target = await client.send('Target.createTarget', { url: 'about:blank' });
        targetId = target.targetId;
        const attached = await client.send('Target.attachToTarget', {
            targetId,
            flatten: true
        });
        const sessionId = attached.sessionId;

        await client.send('Page.enable', {}, sessionId);
        await client.send('Runtime.enable', {}, sessionId);
        const loadEvent = client.waitForEvent(
            'Page.loadEventFired',
            message => message.sessionId === sessionId,
            timeoutMs
        );
        await client.send('Page.navigate', { url: htmlUrl }, sessionId);
        await loadEvent;
        await waitForPagedJs(client, sessionId, timeoutMs);
        await client.send('Emulation.setEmulatedMedia', { media: 'screen' }, sessionId);

        const pdf = await client.send('Page.printToPDF', {
            displayHeaderFooter: false,
            printBackground: true,
            preferCSSPageSize: true,
            paperWidth: A4_WIDTH_INCHES,
            paperHeight: A4_HEIGHT_INCHES
        }, sessionId, timeoutMs);

        fs.writeFileSync(outputPath, Buffer.from(pdf.data, 'base64'));
    } catch (err) {
        const stderr = launched.getStderr();
        if (stderr) {
            console.error(stderr.trim());
        }
        throw err;
    } finally {
        if (client && targetId) {
            try {
                await client.send('Target.closeTarget', { targetId }, null, 5000);
            } catch (_err) {}
        }
        if (client) client.close();
        launched.child.kill();
    }
}

async function convertHtmlToPdfWithChrome(htmlPath, outputPath, resourceDir, defaultTemplateDir, config, options) {
    const chromePath = resolveChromeExecutable(config, options);
    const prepared = prepareHtmlForChrome(htmlPath, outputPath, resourceDir, defaultTemplateDir);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'houhi-chrome-profile-'));

    try {
        console.log(`Chrome + Paged.jsでPDFを生成します: ${chromePath}`);
        await runChromePrintWithPagedJs(
            chromePath,
            pathToFileURL(prepared.htmlPath).href,
            outputPath,
            userDataDir,
            options.timeoutMs || 60000
        );
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
    convertHtmlToPdfWithChrome,
    injectPagedJsForChrome,
    injectA4PageSize,
    prepareHtmlForChrome,
    prepareTocPlaceholdersForChrome,
    resolvePagedPolyfillPath
};
