const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Store console windows
let consoleWindows = new Map();

function createWindow() {
    const win = new BrowserWindow({
        width: 600,
        height: 600,
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

function createConsoleWindow(taskName, fileCount) {
    const consoleWin = new BrowserWindow({
        width: 800,
        height: 500,
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
    'ocr_general': { path: 'src/ocr_general_doc.js', name: '一般文書OCR' },
    'ocr_court': { path: 'src/ocr_court_doc.js', name: '裁判文書OCR' },
    'ocr_merge': { path: 'src/ocr_merge_pages.js', name: 'OCRページ結合' },
    'renumber': { path: 'src/renumber_markdown.js', name: 'Markdown番号振直' },
    'ai_archive': { path: 'src/archive_for_ai.js', name: 'AI分析用アーカイブ作成' },
    'stamp': { path: 'src/stamp_evidence_number.js', name: '号証スタンプ' },
    'fax_pdf': { path: 'src/fax_prepare_pdf.js', name: 'FAX送信用PDF変換' }
};

ipcMain.handle('execute-script', async (event, { scriptKey, filePaths }) => {
    if (!SCRIPTS[scriptKey]) {
        throw new Error('Invalid script key');
    }

    const script = SCRIPTS[scriptKey];
    const scriptPath = path.resolve(__dirname, '../../', script.path);
    
    // Create console window for this task
    const consoleWin = createConsoleWindow(script.name, filePaths.length);
    
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
    const command = `node "${scriptPath}" ${quotedPaths}`;
    consoleWin.webContents.send('console-command', `実行コマンド: node ${path.basename(scriptPath)} ...`);
    consoleWin.webContents.send('console-info', `作業ディレクトリ: ${path.resolve(__dirname, '../../')}`);
    
    // Also send to main window
    event.sender.send('script-log', `実行コマンド: ${command}\n`);

    return new Promise((resolve, reject) => {
        // Use spawn for real-time output streaming
        // shell: false to properly handle spaces in file paths
        // Use 'node' command (from PATH) instead of process.execPath (which is Electron)
        const childProcess = spawn('node', [scriptPath, ...filePaths], {
            cwd: path.resolve(__dirname, '../../'),
            shell: false,
            windowsHide: true,
            env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';

        // Stream stdout in real-time
        childProcess.stdout.on('data', (data) => {
            const text = data.toString();
            stdout += text;
            
            // Send each line to console window
            text.split('\n').forEach(line => {
                if (line.trim()) {
                    // Detect different types of messages
                    if (line.includes('エラー') || line.includes('Error') || line.includes('error')) {
                        consoleWin.webContents.send('console-error', line);
                    } else if (line.includes('警告') || line.includes('Warning') || line.includes('warning')) {
                        consoleWin.webContents.send('console-warning', line);
                    } else if (line.includes('完了') || line.includes('成功') || line.includes('Success')) {
                        consoleWin.webContents.send('console-success', line);
                    } else if (line.includes('処理中') || line.includes('開始') || line.includes('...')) {
                        consoleWin.webContents.send('console-info', line);
                    } else {
                        consoleWin.webContents.send('console-log', line);
                    }
                }
            });
        });

        // Stream stderr in real-time
        childProcess.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            
            text.split('\n').forEach(line => {
                if (line.trim()) {
                    consoleWin.webContents.send('console-error', line);
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
                consoleWin.webContents.send('console-success', '─'.repeat(50));
                consoleWin.webContents.send('console-success', '✅ 処理が正常に完了しました');
                consoleWin.webContents.send('console-complete', true);
                setAutoClose();
                resolve({ 
                    success: true, 
                    output: stdout 
                });
            } else {
                consoleWin.webContents.send('console-error', '─'.repeat(50));
                consoleWin.webContents.send('console-error', `❌ 処理がエラーで終了しました (コード: ${code})`);
                consoleWin.webContents.send('console-complete', false);
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
            consoleWin.webContents.send('console-error', `プロセスエラー: ${error.message}`);
            consoleWin.webContents.send('console-complete', false);
            resolve({ 
                success: false, 
                output: stdout, 
                error: error.message, 
                code: -1 
            });
        });
    });
});
