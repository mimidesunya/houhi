const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('./gemini_client');

/**
 * Executes ndlocr-lite on a given image file or directory.
 * @param {string} sourcePath Path to an image file or a directory containing images.
 * @param {string} destDir Path to the output directory where ndlocr will save results.
 * @param {boolean} isDir True if sourcePath is a directory.
 */
function runNdlocr(sourcePath, destDir, isDir = false) {
    return new Promise((resolve, reject) => {
        const config = loadConfig();
        if (!config || !config.ndlocrLite) {
            return reject(new Error('config.json に ndlocrLite の設定がありません。'));
        }

        const pythonPath = config.ndlocrLite.pythonPath || 'python';
        const repoPath = config.ndlocrLite.repoPath;

        if (!repoPath || !fs.existsSync(repoPath)) {
            return reject(new Error(`ndlocr-lite のリポジトリが見つかりません。設定を確認してください: ${repoPath}`));
        }

        const ocrPyPath = path.join(repoPath, 'src', 'ocr.py');
        if (!fs.existsSync(ocrPyPath)) {
            return reject(new Error(`ocr.py が見つかりません: ${ocrPyPath}`));
        }

        const args = [ocrPyPath];
        if (isDir) {
            args.push('--sourcedir', sourcePath);
        } else {
            args.push('--sourceimg', sourcePath);
        }
        args.push('--output', destDir);

        console.log(`[ndlocr] 実行: ${pythonPath} ${args.join(' ')}`);

        const child = spawn(pythonPath, args, {
            cwd: path.join(repoPath, 'src'),
            shell: false,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            const str = data.toString();
            stdout += str;
            // Ndlocr outputs progress, so we can log it if needed
            str.split('\n').forEach(line => {
                if (line.trim()) console.log(`[ndlocr] ${line.trim()}`);
            });
        });

        child.stderr.on('data', (data) => {
            const str = data.toString();
            stderr += str;
            str.split('\n').forEach(line => {
                if (line.trim()) console.warn(`[ndlocr-err] ${line.trim()}`);
            });
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`ndlocr-lite exited with code ${code}: ${stderr}`));
            }
        });

        child.on('error', (err) => {
            reject(new Error(`Failed to start python process: ${err.message}`));
        });
    });
}

module.exports = {
    runNdlocr
};
