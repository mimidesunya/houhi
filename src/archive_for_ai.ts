/**
 * AIアーカイブ作成ツール。
 *
 * 指定ディレクトリ配下の `.md` / `.txt` を再帰的に収集し、
 * ディレクトリ構造を保った ZIP を作成します。
 * ZIP のルートには、収録ファイル構成を説明する `README.md` を自動生成します。
 * `src/base/sample.md` が存在する場合は、起案参考用として同梱します。
 *
 * 入力:
 * - ディレクトリパスを 1 つ以上指定できます。
 *
 * 出力:
 * - 各入力ディレクトリの親フォルダに `<ディレクトリ名>.zip` を作成します。
 *
 * 補足:
 * - `.md` / `.txt` 以外のファイルは収録しません。
 * - 対象ファイルが 0 件のディレクトリはスキップします。
 *
 * 使い方:
 *   node src/archive_for_ai.js <ディレクトリパス...>
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function getDirectoryStructure(dir, baseDir, indent = "") {
    let structure = "";
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    // フォルダを先に、ファイルを後にソート
    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath);
        
        if (entry.isDirectory()) {
            // ディレクトリ内の対象ファイルをチェック
            const hasTarget = hasTargetFiles(fullPath);
            if (hasTarget) {
                structure += `${indent}📁 ${entry.name}/\n`;
                structure += getDirectoryStructure(fullPath, baseDir, indent + "  ");
            }
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.md' || ext === '.txt') {
                structure += `${indent}📄 ${entry.name}\n`;
            }
        }
    }
    return structure;
}

function hasTargetFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (hasTargetFiles(path.join(dir, entry.name))) return true;
        } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (ext === '.md' || ext === '.txt') return true;
        }
    }
    return false;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log("-------------------------------------------------------");
        console.log(" ディレクトリをドロップしてください。");
        console.log(" .md / .txt を抽出して ZIP にまとめます。");
        console.log("-------------------------------------------------------");
        return;
    }

    for (const arg of args) {
        const targetDir = path.resolve(arg);
        if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
            console.error(`[エラー] ディレクトリではありません: ${targetDir}`);
            continue;
        }

        const parentDir = path.dirname(targetDir);
        const dirName = path.basename(targetDir);
        const zipPath = path.join(parentDir, `${dirName}.zip`);
        const zip = new AdmZip();

        console.log(`[処理] スキャン中: ${targetDir}`);
        
        let fileCount = 0;
        function addFilesRecursively(currentDir) {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                const relPath = path.relative(targetDir, fullPath);
                
                if (entry.isDirectory()) {
                    addFilesRecursively(fullPath);
                } else {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (ext === '.md' || ext === '.txt') {
                        const zipInternalPath = path.dirname(relPath);
                        // rootの場合は空文字列にする
                        const zipPathInZip = zipInternalPath === '.' ? "" : zipInternalPath;
                        zip.addLocalFile(fullPath, zipPathInZip);
                        fileCount++;
                    }
                }
            }
        }

        addFilesRecursively(targetDir);

        if (fileCount === 0) {
            console.warn(`[警告] ${dirName} 内に .md / .txt ファイルが見つかりませんでした`);
            continue;
        }

        // サンプルの読み込み
        const baseDir = path.join(__dirname, 'base');
        const samplePath = path.join(baseDir, 'sample.md');
        
        let hasSample = false;
        if (fs.existsSync(samplePath)) {
            zip.addFile("sample.md", fs.readFileSync(samplePath));
            hasSample = true;
        }

        // README.md の作成
        const structure = getDirectoryStructure(targetDir, targetDir);
        let readmeContent = `# Project Archive for AI Analysis

This archive contains documentation and manuscripts extracted from \`${dirName}\`.
Only \`.md\` and \`.txt\` files are included to keep the context relevant for AI analysis.

## Directory Structure

\`\`\`
${dirName}/
${structure}\`\`\`
`;

        if (hasSample) {
            readmeContent += `
## AI Drafting Reference

The file \`sample.md\` is included in the root of this archive as a concrete example of the target court document format. 
When you are asked to draft or revise a court document based on the files in this archive, please refer to this sample for formatting and structure.
`;
        }

        readmeContent += `
---
Generated by Saiban System Archive Tool
`;
        zip.addFile("README.md", Buffer.from(readmeContent, "utf-8"));

        console.log(`[情報] ${fileCount} 個のファイルが見つかりました。ZIP を作成中...`);
        zip.writeZip(zipPath);
        console.log(`[成功] 作成されました: ${zipPath}`);
    }
    console.log("\nすべての処理が完了しました。");
}

main();
