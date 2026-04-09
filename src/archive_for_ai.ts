/**
 * AIアーカイブ作成ツール。
 *
 * 指定ディレクトリ配下の `.md` / `.txt` を再帰的に収集し、
 * ディレクトリ構造を保った ZIP を作成します。
 * ZIP のルートには、収録ファイル構成を説明する `README.md` を自動生成します。
 * `instructions/` 配下の全テンプレートを同梱し、AI が書面種別ごとの
 * 生成ルールを参照できるようにします。
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

type InstructionEntry = {
    archivePath: string;
    displayPath: string;
    content: Buffer;
    isCommonRules: boolean;
};

function isTargetTextFile(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.md' || ext === '.txt';
}

function compareInstructionNames(a: string, b: string) {
    if (a === 'sample.md') return -1;
    if (b === 'sample.md') return 1;
    return a.localeCompare(b, 'ja');
}

function compareInstructionPaths(a: string, b: string) {
    const aParts = a.split('/');
    const bParts = b.split('/');
    const maxLength = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLength; i++) {
        const aPart = aParts[i];
        const bPart = bParts[i];

        if (aPart == null) return -1;
        if (bPart == null) return 1;
        if (aPart === bPart) continue;

        return compareInstructionNames(aPart, bPart);
    }

    return 0;
}

function findProjectRoot(startDir: string) {
    let currentDir = path.resolve(startDir);

    while (true) {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const instructionsDir = path.join(currentDir, 'instructions');

        if (fs.existsSync(packageJsonPath) && fs.existsSync(instructionsDir)) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return null;
        }

        currentDir = parentDir;
    }
}

function resolveProjectRoots(searchRoots: string[] = [process.cwd(), __dirname]) {
    const resolvedRoots: string[] = [];
    const seen = new Set<string>();

    for (const searchRoot of searchRoots) {
        const projectRoot = findProjectRoot(searchRoot);
        if (!projectRoot) continue;

        const normalizedRoot = path.resolve(projectRoot);
        if (seen.has(normalizedRoot)) continue;

        seen.add(normalizedRoot);
        resolvedRoots.push(normalizedRoot);
    }

    return resolvedRoots;
}

function collectTargetFilesRecursively(dir: string, baseDir = dir) {
    let files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return compareInstructionNames(a.name, b.name);
    });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(collectTargetFilesRecursively(fullPath, baseDir));
            continue;
        }

        if (isTargetTextFile(entry.name)) {
            files.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
        }
    }

    return files;
}

function buildInstructionEntriesFromInstructionsDir(instructionsDir: string): InstructionEntry[] {
    if (!fs.existsSync(instructionsDir) || !hasTargetFiles(instructionsDir)) {
        return [];
    }

    const relativePaths = collectTargetFilesRecursively(instructionsDir).sort(compareInstructionPaths);
    return relativePaths.map(relPath => {
        const fullPath = path.join(instructionsDir, ...relPath.split('/'));
        return {
            archivePath: `instructions/${relPath}`,
            displayPath: `instructions/${relPath}`,
            content: fs.readFileSync(fullPath),
            isCommonRules: path.basename(relPath).toLowerCase() === 'sample.md',
        };
    });
}

function loadInstructionEntries(searchRoots: string[] = [process.cwd(), __dirname]) {
    const projectRoots = resolveProjectRoots(searchRoots);

    for (const projectRoot of projectRoots) {
        const instructionEntries = buildInstructionEntriesFromInstructionsDir(path.join(projectRoot, 'instructions'));
        if (instructionEntries.length > 0) {
            return instructionEntries;
        }
    }

    return [];
}

function buildInstructionStructure(instructionEntries: InstructionEntry[]) {
    if (instructionEntries.length === 0) {
        return "";
    }

    const tree = {};
    for (const entry of instructionEntries) {
        const relativePath = entry.displayPath.replace(/^instructions\//, '');
        const parts = relativePath.split('/');
        let currentNode = tree;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLastPart = i === parts.length - 1;

            if (isLastPart) {
                currentNode[part] = null;
            } else {
                currentNode[part] = currentNode[part] || {};
                currentNode = currentNode[part];
            }
        }
    }

    function renderTree(node, indent = "  ") {
        let structure = "";
        const entries = Object.keys(node).sort((a, b) => {
            const aIsDirectory = node[a] !== null;
            const bIsDirectory = node[b] !== null;
            if (aIsDirectory && !bIsDirectory) return -1;
            if (!aIsDirectory && bIsDirectory) return 1;
            return compareInstructionNames(a, b);
        });

        for (const entryName of entries) {
            const childNode = node[entryName];
            if (childNode === null) {
                structure += `${indent}📄 ${entryName}\n`;
            } else {
                structure += `${indent}📁 ${entryName}/\n`;
                structure += renderTree(childNode, indent + "  ");
            }
        }

        return structure;
    }

    return `📁 instructions/\n${renderTree(tree)}`;
}

function buildArchiveReadme(dirName: string, structure: string, instructionEntries: InstructionEntry[]) {
    const hasInstructions = instructionEntries.length > 0;
    const instructionsStructure = buildInstructionStructure(instructionEntries);

    let readmeContent = `# Project Archive for AI Analysis

This archive contains ${hasInstructions ? 'two categories' : 'one category'} of files:

- **\`${dirName}/\`** — The user's actual case documents (briefs, evidence lists, transcripts, etc.).
  These are the files you should read, analyze, and use as source material.
`;

    if (hasInstructions) {
        readmeContent += `- **\`instructions/\`** — Bundled drafting instructions.
  You may use these files as reference material when preparing court documents. Follow the matching instruction file for structure, formatting, and standard phrasing.
`;
    }

    readmeContent += `
## Directory Structure

\`\`\`
${dirName}/
${structure}${instructionsStructure}\`\`\`
`;

    if (hasInstructions) {
        const instructionList = instructionEntries
            .map(entry => {
                const description = entry.isCommonRules
                    ? 'Common Markdown rules for all document types.'
                    : 'Reference instruction for the corresponding document type.';
                return `- \`${entry.displayPath}\` — ${description}`;
            })
            .join('\n');

        const hasCommonRules = instructionEntries.some(entry => entry.isCommonRules);

        readmeContent += `
## Drafting Instructions

The files in \`instructions/\` are included so they can be used as reference material when drafting court documents.
Use the materials in \`${dirName}/\` for the facts of this case, and use the matching files in \`instructions/\` for writing guidance.

${hasCommonRules ? 'Start with `instructions/sample.md`, then use the document-type instruction that best matches the filing you want to prepare.\n\n' : ''}Available instruction files:
${instructionList}
`;
    }

    readmeContent += `
---
Generated by Saiban System Archive Tool
`;

    return readmeContent;
}

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

        const instructionEntries = loadInstructionEntries();
        for (const instructionEntry of instructionEntries) {
            zip.addFile(instructionEntry.archivePath, instructionEntry.content);
        }

        // README.md の作成
        const structure = getDirectoryStructure(targetDir, targetDir);
        const readmeContent = buildArchiveReadme(dirName, structure, instructionEntries);
        zip.addFile("README.md", Buffer.from(readmeContent, "utf-8"));

        console.log(`[情報] ${fileCount} 個のファイルが見つかりました。ZIP を作成中...`);
        zip.writeZip(zipPath);
        console.log(`[成功] 作成されました: ${zipPath}`);
    }
    console.log("\nすべての処理が完了しました。");
}

if (require.main === module) {
    main();
}

module.exports = {
    buildArchiveReadme,
    findProjectRoot,
    getDirectoryStructure,
    hasTargetFiles,
    loadInstructionEntries,
};
