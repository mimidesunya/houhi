const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfigForEditor, saveConfigFromEditor } = require('../lib/config_editor');

let settingsWindow = null;
const DRAFTING_KIT_FILE_NAME = 'houhi-drafting-kit.zip';

function findUpward(startDir, fileName) {
    let currentDir = path.resolve(startDir);

    while (true) {
        const candidatePath = path.join(currentDir, fileName);
        if (fs.existsSync(candidatePath)) {
            return candidatePath;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return null;
        }
        currentDir = parentDir;
    }
}

function findProjectRootFallback(searchRoots) {
    for (const searchRoot of searchRoots) {
        let currentDir = path.resolve(searchRoot);

        while (true) {
            if (
                fs.existsSync(path.join(currentDir, 'package.json')) ||
                fs.existsSync(path.join(currentDir, 'config.template.json'))
            ) {
                return currentDir;
            }

            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
    }

    return process.cwd();
}

function resolveDraftingKitInfo() {
    const searchRoots = [
        process.cwd(),
        __dirname,
        path.resolve(__dirname, '../../..'),
        path.dirname(process.execPath),
    ].filter(Boolean);

    for (const searchRoot of searchRoots) {
        const zipPath = findUpward(searchRoot, DRAFTING_KIT_FILE_NAME);
        if (zipPath) {
            return {
                exists: true,
                zipPath,
                folderPath: path.dirname(zipPath),
                fileName: DRAFTING_KIT_FILE_NAME,
                openError: null,
            };
        }
    }

    const folderPath = findProjectRootFallback(searchRoots);
    return {
        exists: false,
        zipPath: path.join(folderPath, DRAFTING_KIT_FILE_NAME),
        folderPath,
        fileName: DRAFTING_KIT_FILE_NAME,
        openError: null,
    };
}

function resolveAppIconPath() {
    const candidates = [
        path.resolve(__dirname, '../../../platforms/windows/launcher/app.ico'),
        path.resolve(process.cwd(), 'platforms', 'windows', 'launcher', 'app.ico')
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

function createSettingsWindow(parentWin = null) {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return settingsWindow;
    }

    settingsWindow = new BrowserWindow({
        width: 720,
        height: 820,
        minWidth: 640,
        minHeight: 680,
        parent: parentWin || undefined,
        icon: appIconPath,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#141a21',
            symbolColor: '#64b5f6'
        },
        backgroundColor: '#171d24',
        show: false
    });

    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
    settingsWindow.once('ready-to-show', () => {
        settingsWindow.show();
    });
    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });

    return settingsWindow;
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
    'ai_archive': { path: 'src/archive_for_ai.js', name: 'AI分析用アーカイブ作成' },
    'stamp': { path: 'src/stamp_evidence_number.js', name: '号証スタンプ' },
    'fax_send': { path: 'src/fax_send.js', name: 'mfax FAX送信' },
    'transcribe_audio': { path: 'src/transcribe_audio.js', name: '音声認識' }
};

ipcMain.handle('execute-script', async (event, { scriptKey, filePaths, options }) => {
    if (!SCRIPTS[scriptKey]) {
        throw new Error('Invalid script key');
    }

    const script = SCRIPTS[scriptKey];
    const scriptPath = path.resolve(__dirname, '../../', script.path);
    const extraArgs = Array.isArray(options) ? options : [];
    const scriptArgs = [...extraArgs, ...filePaths];

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
    const quotedOptions = extraArgs.map(arg => `"${arg}"`).join(' ');
    const quotedPaths = filePaths.map(p => `"${p}"`).join(' ');
    const command = `node "${scriptPath}" ${quotedOptions} ${quotedPaths}`.trim();
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
        let activePreviewWin = null;
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

                // [REGEN_DONE] マーカ: プレビューウィンドウの画像を更新
                if (line.startsWith('[REGEN_DONE]') && activePreviewWin && !activePreviewWin.isDestroyed()) {
                    const pageNum = parseInt(line.replace('[REGEN_DONE]', '').trim());
                    activePreviewWin.webContents.executeJavaScript(`reloadPage(${pageNum})`);
                    continue;
                }

                // [PREVIEW] マーカはプレビューウィンドウに変換
                if (line.startsWith('[PREVIEW]')) {
                    const raw = line.replace('[PREVIEW]', '').trim();
                    const previewData = JSON.parse(raw);
                    const previewDir = path.dirname(previewData.images[0]);
                    const ditherStatus = previewData.ditherStatus || [];

                    const faxJsonEsc = JSON.stringify(previewData.faxNumbers).replace(/\\/g,'\\\\').replace(/'/g,"\\'");

                    const imgHtml = previewData.images.map((imgPath, i) => {
                        const dithered = ditherStatus[i] ? 'true' : 'false';
                        const btnLabel = ditherStatus[i] ? 'ディザリング: ON' : 'ディザリング: OFF';
                        return `<div class="page"><div class="page-header"><span>ページ ${i+1}</span><button class="btn-dither${ditherStatus[i] ? ' active' : ''}" id="dither-${i+1}" data-dithered="${dithered}" onclick="toggleDither(${i+1})">${btnLabel}</button></div><img id="img-${i+1}" src="${path.basename(imgPath)}" /></div>`;
                    }).join('');

                    const previewHtmlContent = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{margin:0;padding:0;background:#1a1a2e;color:#e0e0e0;font-family:'Segoe UI',system-ui,sans-serif}
.header{position:sticky;top:0;background:#1a1a2e;padding:16px 20px;border-bottom:1px solid #333;z-index:10}
h2{margin:0 0 12px 0;font-size:18px;color:#64b5f6}
.fax-section{margin-bottom:8px}
.fax-row{display:flex;gap:8px;align-items:center;margin:4px 0;font-size:13px}
.fax-row input{background:#2a2a3e;border:1px solid #444;border-radius:4px;padding:4px 8px;color:#e0e0e0;font-size:13px}
.fax-row .fax-meta{min-width:140px;max-width:280px;color:#b0bec5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fax-row input.fax-number-input{width:160px;font-family:monospace}
.fax-row .fax-remove{background:#c62828;color:white;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px}
.fax-row .fax-remove:hover{background:#e53935}
.fax-add{background:#1565c0;color:white;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:12px;margin-top:4px}
.fax-add:hover{background:#1976d2}
.fax-error{color:#ef5350;font-size:12px;margin-top:4px;display:none}
.pages{padding:16px;padding-bottom:80px}
.page{margin-bottom:16px;background:#222;border-radius:8px;overflow:hidden}
.page-header{padding:8px 12px;background:#2a2a3e;font-size:13px;color:#888;display:flex;justify-content:space-between;align-items:center}
.page img{width:100%;display:block}
.btn-dither{padding:4px 12px;border:1px solid #555;border-radius:4px;font-size:12px;cursor:pointer;background:#333;color:#aaa;transition:all .2s}
.btn-dither.active{background:#2e7d32;border-color:#4caf50;color:#fff}
.btn-dither:hover:not(:disabled){background:#444}
.btn-dither.active:hover:not(:disabled){background:#388e3c}
.btn-dither:disabled{opacity:0.5;cursor:wait}
.footer{position:fixed;bottom:0;left:0;right:0;background:#1a1a2e;border-top:1px solid #333;padding:12px 20px;display:flex;justify-content:flex-end;gap:10px}
button{padding:8px 24px;border:none;border-radius:6px;font-size:14px;cursor:pointer}
.btn-send{background:#4caf50;color:white;font-weight:bold}.btn-send:hover{background:#45a049}
.btn-cancel{background:#444;color:#e0e0e0}.btn-cancel:hover{background:#555}
</style></head><body>
<div class="header">
<h2>FAX送信プレビュー</h2>
<div class="fax-section">
<div id="fax-list"></div>
<button class="fax-add" onclick="addFaxRow('','','')">＋ 宛先を追加</button>
<div class="fax-error" id="fax-error">FAX番号を1件以上入力してください。</div>
</div>
</div>
<div class="pages">${imgHtml}</div>
<div class="footer">
<button class="btn-cancel" onclick="document.title='__CANCEL__'">キャンセル</button>
<button class="btn-send" onclick="confirmSend()">送信する</button>
</div>
<script>
var faxData = JSON.parse('${faxJsonEsc}');
function renderFaxList(){
  var el=document.getElementById('fax-list');
  el.innerHTML='';
  faxData.forEach(function(f,i){
    var row=document.createElement('div');row.className='fax-row';
    row.innerHTML='<span>'+(i+1)+'.</span>'
      +'<span class="fax-meta" title="'+escAttr(faxMetaText(f))+'">'+escHtml(faxMetaText(f))+'</span>'
      +'<input class="fax-number-input" placeholder="FAX番号" value="'+escAttr(f.number)+'" onchange="faxData['+i+'].number=this.value">'
      +'<button class="fax-remove" onclick="removeFax('+i+')">✕</button>';
    el.appendChild(row);
  });
}
function faxMetaText(f){
  var parts=[];
  if(f.label){parts.push('['+f.label+']');}
  if(f.name){parts.push(f.name);}
  return parts.length>0 ? parts.join(' ') : '手入力';
}
function escAttr(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function addFaxRow(label,name,number){faxData.push({label:label||'',name:name||'',number:number||''});renderFaxList();document.getElementById('fax-error').style.display='none';}
function removeFax(i){faxData.splice(i,1);renderFaxList();}
function confirmSend(){
  var valid=[];
  for(var i=0;i<faxData.length;i++){
    var num=faxData[i].number.replace(/[^0-9]/g,'');
    if(num.length>=10){valid.push({label:faxData[i].label,name:faxData[i].name,number:num});}
  }
  if(valid.length===0){document.getElementById('fax-error').style.display='block';return;}
  document.title='__CONFIRM_FAX_'+JSON.stringify(valid)+'__';
}
renderFaxList();
if(faxData.length===0){addFaxRow('','','');}
function toggleDither(n){var b=document.getElementById('dither-'+n);var d=b.dataset.dithered==='true';var m=d?'nodither':'dither';b.disabled=true;b.textContent='処理中...';document.title='__REGEN_'+n+'_'+m+'__';}
function reloadPage(n){var img=document.getElementById('img-'+n);img.src=img.src.split('?')[0]+'?t='+Date.now();var b=document.getElementById('dither-'+n);var was=b.dataset.dithered==='true';b.dataset.dithered=was?'false':'true';b.textContent=was?'ディザリング: OFF':'ディザリング: ON';if(was){b.classList.remove('active')}else{b.classList.add('active')}b.disabled=false;}
</script>
</body></html>`;

                    const previewHtmlPath = path.join(previewDir, '_preview.html');
                    fs.writeFileSync(previewHtmlPath, previewHtmlContent, 'utf-8');

                    const parentWin = consoleWin && !consoleWin.isDestroyed() ? consoleWin : null;
                    const previewWin = new BrowserWindow({
                        width: 720,
                        height: 860,
                        parent: parentWin,
                        modal: true,
                        webPreferences: { nodeIntegration: false, contextIsolation: true },
                        backgroundColor: '#1a1a2e',
                        show: false
                    });
                    activePreviewWin = previewWin;
                    previewWin.setMenuBarVisibility(false);
                    previewWin.loadFile(previewHtmlPath);
                    previewWin.once('ready-to-show', () => previewWin.show());

                    let confirmedFaxJson = '';
                    previewWin.on('page-title-updated', (ev, title) => {
                        ev.preventDefault();
                        const confirmFaxMatch = title.match(/^__CONFIRM_FAX_(.+)__$/);
                        if (confirmFaxMatch) {
                            confirmedFaxJson = confirmFaxMatch[1];
                            activePreviewWin = null;
                            previewWin.close();
                            return;
                        }
                        if (title === '__CANCEL__') {
                            activePreviewWin = null;
                            previewWin.close();
                            return;
                        }
                        const regenMatch = title.match(/^__REGEN_(\d+)_(dither|nodither)__$/);
                        if (regenMatch) {
                            childProcess.stdin.write(`REGEN ${regenMatch[1]} ${regenMatch[2]}\n`);
                        }
                    });

                    await new Promise(resolve => {
                        previewWin.on('closed', resolve);
                    });

                    if (confirmedFaxJson) {
                        childProcess.stdin.write(`CONFIRM_FAX ${confirmedFaxJson}\n`);
                    } else {
                        childProcess.stdin.write('n\n');
                    }
                    continue;
                }

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

ipcMain.handle('open-config-settings', (event) => {
    createSettingsWindow(BrowserWindow.fromWebContents(event.sender));
    return true;
});

ipcMain.handle('open-drafting-kit-folder', async () => {
    const kitInfo = resolveDraftingKitInfo();

    if (kitInfo.exists) {
        shell.showItemInFolder(kitInfo.zipPath);
        return kitInfo;
    }

    const openError = await shell.openPath(kitInfo.folderPath);
    return {
        ...kitInfo,
        openError: openError || null,
    };
});

ipcMain.handle('config:get', () => {
    return loadConfigForEditor();
});

ipcMain.handle('config:save', (_event, config) => {
    return saveConfigFromEditor(config);
});
