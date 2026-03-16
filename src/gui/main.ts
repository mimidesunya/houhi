const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function resolveAppIconPath() {
    const candidates = [
        path.resolve(__dirname, '../../../src/launcher/app.ico'),
        path.resolve(process.cwd(), 'src', 'launcher', 'app.ico')
    ];

    return candidates.find(candidate => fs.existsSync(candidate));
}

const appIconPath = resolveAppIconPath();

function createWindow() {
    const win = new BrowserWindow({
        width: 480,
        height: 730,
        icon: appIconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#00000000',
            symbolColor: '#74b1be'
        },
        transparent: true, // For glass effect background
        vibrancy: 'under-window', // macOS specific, but good to have
        backgroundColor: '#00000000' // Transparent
    });

    win.loadFile(path.join(__dirname, 'index.html'));
    // win.webContents.openDevTools(); // For debugging
}

function createConsoleWindow() {
    const consoleWin = new BrowserWindow({
        width: 800,
        height: 500,
        icon: appIconPath,
        webPreferences: {
            preload: path.join(__dirname, 'console_preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#1a1a2e',
            symbolColor: '#64b5f6'
        },
        backgroundColor: '#1a1a2e',
        show: false
    });

    consoleWin.loadFile(path.join(__dirname, 'console.html'));
    
    consoleWin.once('ready-to-show', () => {
        consoleWin.show();
    });

    // consoleWin.webContents.openDevTools(); // For debugging

    return consoleWin;
}

app.whenReady().then(() => {
    if (process.platform === 'win32') {
        app.setAppUserModelId('jp.mimidesunya.houhi');
    }

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Script definitions
const SCRIPTS = {
    'pdf': { path: 'src/convert_to_pdf.js', name: '裁判文書PDF作成' },
    'renumber': { path: 'src/renumber_markdown.js', name: 'Markdown番号振直' },
    'ai_archive': { path: 'src/archive_for_ai.js', name: 'AI分析用アーカイブ作成' },
    'stamp': { path: 'src/stamp_evidence_number.js', name: '号証スタンプ' },
    'fax_send': { path: 'src/fax_send.js', name: 'mfax FAX送信' }
};

ipcMain.handle('execute-script', async (event, { scriptKey, filePaths }) => {
    if (!SCRIPTS[scriptKey]) {
        throw new Error('Invalid script key');
    }

    const script = SCRIPTS[scriptKey];
    const scriptPath = path.resolve(__dirname, '../../', script.path);
    const scriptArgs = [...filePaths];

    // Create console window for this task
    const consoleWin = createConsoleWindow();

    // Wait for console window to be ready
    await new Promise(resolve => {
        consoleWin.webContents.once('did-finish-load', () => {
            setTimeout(resolve, 100); // Small delay to ensure preload is ready
        });
    });

    // Send task info to console window
    consoleWin.webContents.send('console-task-info', {
        taskName: script.name,
        fileCount: filePaths.length,
        files: filePaths.map(p => path.basename(p))
    });

    // Log command to console window
    const quotedPaths = filePaths.map(p => `"${p}"`).join(' ');
    const command = `node "${scriptPath}" ${quotedPaths}`.trim();
    consoleWin.webContents.send('console-command', `実行コマンド: node ${path.basename(scriptPath)} ...`);
    consoleWin.webContents.send('console-info', `作業ディレクトリ: ${path.resolve(__dirname, '../../')}`);

    // Also send to main window
    event.sender.send('script-log', `実行コマンド: ${command}\n`);

    return new Promise((resolve, reject) => {
        // Use spawn for real-time output streaming
        // shell: false to properly handle spaces in file paths
        // Use 'node' command (from PATH) instead of process.execPath (which is Electron)
        const childProcess = spawn('node', [scriptPath, ...scriptArgs], {
            cwd: path.resolve(__dirname, '../../'),
            shell: false,
            windowsHide: true,
            env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';

        // Safe send helper — guards against destroyed window
        const safeSend = (channel, data) => {
            if (consoleWin && !consoleWin.isDestroyed()) {
                consoleWin.webContents.send(channel, data);
            }
        };

        // Stream stdout in real-time
        let lineBuffer = '';
        childProcess.stdout.on('data', async (data) => {
            const text = data.toString();
            stdout += text;
            lineBuffer += text;

            // 完結行単位で処理（部分行は次のデータまで保留）
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop();
            
            // Send each line to console window
            for (const line of lines) {
                if (!line.trim()) continue;

                // [CONFIRM] マーカはネイティブダイアログに変換
                if (line.startsWith('[CONFIRM]')) {
                    const raw = line.replace('[CONFIRM]', '').trim().replace(/\\n/g, '\n');
                    const [firstLine, ...rest] = raw.split('\n');
                    const result = await dialog.showMessageBox(consoleWin && !consoleWin.isDestroyed() ? consoleWin : null, {
                        type: 'question',
                        buttons: ['送信する', 'キャンセル'],
                        defaultId: 0,
                        cancelId: 1,
                        title: 'FAX送信確認',
                        message: firstLine,
                        detail: rest.join('\n')
                    });
                    childProcess.stdin.write(result.response === 0 ? 'y\n' : 'n\n');
                    continue;
                }

                // [PROMPT] マーカはテキスト入力ダイアログに変換
                if (line.startsWith('[PROMPT]')) {
                    const raw = line.replace('[PROMPT]', '').trim().replace(/\\n/g, '\n');
                    const parentWin = consoleWin && !consoleWin.isDestroyed() ? consoleWin : null;
                    // Electron には入力ダイアログがないので BrowserWindow で実装
                    const inputValue = await new Promise((resolveInput) => {
                        const inputWin = new BrowserWindow({
                            width: 420,
                            height: 180,
                            parent: parentWin,
                            modal: true,
                            resizable: false,
                            minimizable: false,
                            maximizable: false,
                            webPreferences: {
                                nodeIntegration: false,
                                contextIsolation: true,
                                preload: path.join(__dirname, 'console_preload.js')
                            },
                            backgroundColor: '#1a1a2e',
                            show: false
                        });
                        inputWin.setMenuBarVisibility(false);
                        const escaped = raw.replace(/'/g, '&#39;').replace(/\n/g, '<br>');
                        inputWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{margin:0;padding:20px;font-family:'Segoe UI',system-ui,sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;flex-direction:column;gap:12px}
label{font-size:14px}
input{padding:8px 12px;font-size:16px;border:1px solid #444;border-radius:6px;background:#2a2a3e;color:#e0e0e0;outline:none;width:100%;box-sizing:border-box}
input:focus{border-color:#64b5f6}
.btns{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
button{padding:6px 20px;border:none;border-radius:6px;font-size:14px;cursor:pointer}
.ok{background:#64b5f6;color:#1a1a2e;font-weight:bold}
.cancel{background:#444;color:#e0e0e0}
</style></head><body>
<label>${escaped}</label>
<input id="v" autofocus>
<div class="btns"><button class="cancel" onclick="require=null;window.close()">キャンセル</button><button class="ok" onclick="document.title=document.getElementById('v').value;window.close()">OK</button></div>
<script>document.getElementById('v').addEventListener('keydown',e=>{if(e.key==='Enter'){document.title=document.getElementById('v').value;window.close();}if(e.key==='Escape')window.close();});</script>
</body></html>`)}`);
                        inputWin.once('ready-to-show', () => inputWin.show());
                        inputWin.on('closed', () => {
                            const title = inputWin.getTitle ? null : null; // already closed
                            resolveInput(null);
                        });
                        inputWin.on('page-title-updated', (ev, title) => {
                            ev.preventDefault();
                            resolveInput(title);
                            inputWin.close();
                        });
                    });
                    childProcess.stdin.write((inputValue || '') + '\n');
                    continue;
                }

                // Detect different types of messages
                if (line.includes('エラー') || line.includes('Error') || line.includes('error')) {
                    safeSend('console-error', line);
                } else if (line.includes('警告') || line.includes('Warning') || line.includes('warning')) {
                    safeSend('console-warning', line);
                } else if (line.includes('完了') || line.includes('成功') || line.includes('Success')) {
                    safeSend('console-success', line);
                } else if (line.includes('処理中') || line.includes('開始') || line.includes('...')) {
                    safeSend('console-info', line);
                } else {
                    safeSend('console-log', line);
                }
            }
        });

        // Stream stderr in real-time
        childProcess.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            
            text.split('\n').forEach(line => {
                if (line.trim()) {
                    safeSend('console-error', line);
                }
            });
        });

        childProcess.on('close', (code) => {
            // Auto-close logic
            const setAutoClose = () => {
                if (!consoleWin.isDestroyed()) {
                    consoleWin.webContents.send('console-info', 'ℹ️ このウィンドウは10分後に自動的に閉じます');
                    setTimeout(() => {
                        if (!consoleWin.isDestroyed()) {
                            consoleWin.close();
                        }
                    }, 10 * 60 * 1000); // 10 minutes
                }
            };

            if (code === 0) {
                safeSend('console-success', '─'.repeat(50));
                safeSend('console-success', '✅ 処理が正常に完了しました');
                safeSend('console-complete', true);
                setAutoClose();
                resolve({ 
                    success: true, 
                    output: stdout 
                });
            } else {
                safeSend('console-error', '─'.repeat(50));
                safeSend('console-error', `❌ 処理がエラーで終了しました (コード: ${code})`);
                safeSend('console-complete', false);
                setAutoClose();
                resolve({ 
                    success: false, 
                    output: stdout, 
                    error: stderr, 
                    code: code 
                });
            }
        });

        childProcess.on('error', (error) => {
            safeSend('console-error', `プロセスエラー: ${error.message}`);
            safeSend('console-complete', false);
            resolve({ 
                success: false, 
                output: stdout, 
                error: error.message, 
                code: -1 
            });
        });
    });
});
