const fs = require('fs');
const path = require('path');

/**
 * src/base/court_doc_rules.md の中の空の Markdown ブロックに
 * src/base/sample.md および src/templates/*.md の内容を挿入し、
 * instructions/ フォルダに保存するスクリプト。
 */
function findProjectRoot(startDir) {
    let currentDir = path.resolve(startDir);

    while (true) {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const baseRulesPath = path.join(currentDir, 'src', 'base', 'court_doc_rules.md');
        if (fs.existsSync(packageJsonPath) && fs.existsSync(baseRulesPath)) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            throw new Error('プロジェクトルートを特定できませんでした。');
        }
        currentDir = parentDir;
    }
}

function setup() {
    const projectRoot = findProjectRoot(__dirname);
    const baseDir = path.join(projectRoot, 'src', 'base');
    const templatesDir = path.join(projectRoot, 'src', 'templates');
    const instructionPath = path.join(baseDir, 'court_doc_rules.md');
    const outputDir = path.join(projectRoot, 'instructions');
    const staleDistOutputDir = path.join(projectRoot, 'dist', 'instructions');

    if (!fs.existsSync(instructionPath)) {
        console.error(`Error: ${instructionPath} が見つかりません。`);
        return;
    }

    const instructionContent = fs.readFileSync(instructionPath, 'utf-8');
    const placeholder = /```markdown\r?\n```/;

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    if (fs.existsSync(staleDistOutputDir)) {
        try {
            fs.rmSync(staleDistOutputDir, { recursive: true, force: true });
            console.log(`情報: 重複していた ${staleDistOutputDir} を削除しました。`);
        } catch (err) {
            console.warn(`警告: ${staleDistOutputDir} の削除に失敗しました: ${err}`);
        }
    }

    // 処理対象のファイルリストを作成
    const filesToProcess = [];
    
    // sample.md を追加
    const samplePath = path.join(baseDir, 'sample.md');
    if (fs.existsSync(samplePath)) {
        filesToProcess.push({ path: samplePath, name: 'sample.md' });
    }

    // src/templates 内の md ファイルを追加
    if (fs.existsSync(templatesDir)) {
        const templateFiles = fs.readdirSync(templatesDir)
            .filter(f => f.endsWith('.md'))
            .map(f => ({ path: path.join(templatesDir, f), name: f }));
        filesToProcess.push(...templateFiles);
    }

    for (const file of filesToProcess) {
        try {
            const content = fs.readFileSync(file.path, 'utf-8');
            const replacement = `\`\`\`markdown\n${content.trim()}\n\`\`\``;
            const finalContent = instructionContent.replace(placeholder, replacement);
            const outputPath = path.join(outputDir, file.name);

            fs.writeFileSync(outputPath, finalContent, 'utf-8');
            console.log(`成功: ${outputPath} を作成しました。`);
        } catch (err) {
            console.error(`エラー (${file.name}): ${err}`);
        }
    }
}

setup();
