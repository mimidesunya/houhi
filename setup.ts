const fs = require('fs');
const path = require('path');

/**
 * src/base/court_doc_rules.md の中の空の Markdown ブロックに
 * src/base/sample.md および src/templates/*.md の内容を挿入し、
 * instructions/ フォルダに保存するスクリプト。
 */
function setup() {
    const baseDir = path.join(__dirname, 'src', 'base');
    const templatesDir = path.join(__dirname, 'src', 'templates');
    const instructionPath = path.join(baseDir, 'court_doc_rules.md');
    const outputDir = path.join(__dirname, 'instructions');

    if (!fs.existsSync(instructionPath)) {
        console.error(`Error: ${instructionPath} が見つかりません。`);
        return;
    }

    const instructionContent = fs.readFileSync(instructionPath, 'utf-8');
    const placeholder = /```markdown\r?\n```/;

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
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
