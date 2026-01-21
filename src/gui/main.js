const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { exec } = require('child_process');

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
    'ai_draft': { path: 'src/ai_generate_markdown.js', name: '裁判文書AI起案' },
    'ai_archive': { path: 'src/archive_for_ai.js', name: 'AI分析用アーカイブ作成' },
    'preview': { path: 'src/preview_template.js', name: 'テンプレートプレビュー' }
};

ipcMain.handle('execute-script', async (event, { scriptKey, filePaths }) => {
    if (!SCRIPTS[scriptKey]) {
        throw new Error('Invalid script key');
    }

    const script = SCRIPTS[scriptKey];
    const scriptPath = path.resolve(__dirname, '../../', script.path);
    
    // Construct command string securely
    // quote paths
    const quotedPaths = filePaths.map(p => `"${p}"`).join(' ');
    // Command: node "scriptPath" "file1" "file2" ...
    const command = `node "${scriptPath}" ${quotedPaths}`;
    
    // Log the command for debugging
    event.sender.send('script-log', `実行コマンド: ${command}\n`);

    return new Promise((resolve, reject) => {
        // Use exec for simple command execution
        const process = exec(command, {
            cwd: path.resolve(__dirname, '../../'),
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }, (error, stdout, stderr) => {
            if (error) {
                resolve({ 
                    success: false, 
                    output: stdout, 
                    error: stderr || error.message, 
                    code: error.code 
                });
            } else {
                resolve({ success: true, output: stdout });
            }
        });
    });
});
