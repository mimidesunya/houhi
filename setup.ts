const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { buildRuleInstructionFiles, buildStartHere } = require('./src/lib/drafting_kit');

/**
 * src/base/court_doc_rules.md の中の空の Markdown ブロックに
 * src/base/sample.md および src/templates/*.md の内容を挿入し、
 * houhi-drafting-kit.zip にまとめるスクリプト。
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

function ensureConfigFile(projectRoot) {
    const configPath = path.join(projectRoot, 'config.json');
    const templatePath = path.join(projectRoot, 'config.template.json');

    if (fs.existsSync(configPath)) {
        console.log(`情報: ${configPath} は既にあります。`);
        return;
    }

    if (!fs.existsSync(templatePath)) {
        console.warn(`警告: ${templatePath} が見つからないため、config.json を作成できませんでした。`);
        return;
    }

    fs.copyFileSync(templatePath, configPath);
    console.log(`成功: ${templatePath} から ${configPath} を作成しました。`);
}

function setup() {
    const projectRoot = findProjectRoot(__dirname);
    const baseDir = path.join(projectRoot, 'src', 'base');
    const templatesDir = path.join(projectRoot, 'src', 'templates');
    const instructionPath = path.join(baseDir, 'court_doc_rules.md');
    const outputZipPath = path.join(projectRoot, 'houhi-drafting-kit.zip');
    const legacyOutputZipPath = path.join(projectRoot, 'instructions.zip');
    const staleDistOutputDir = path.join(projectRoot, 'dist', 'instructions');

    if (!fs.existsSync(instructionPath)) {
        console.error(`Error: ${instructionPath} が見つかりません。`);
        return;
    }

    ensureConfigFile(projectRoot);

    if (fs.existsSync(staleDistOutputDir)) {
        try {
            fs.rmSync(staleDistOutputDir, { recursive: true, force: true });
            console.log(`情報: 重複していた ${staleDistOutputDir} を削除しました。`);
        } catch (err) {
            console.warn(`警告: ${staleDistOutputDir} の削除に失敗しました: ${err}`);
        }
    }

    // 共通の見本（sample.md）とテンプレートを、規則（court_doc_rules.md）に入れて1件ずつの指示にする。
    // 並びは src/lib/template_catalog.ts（Web の起案画面と同じ）
    const samplePath = path.join(baseDir, 'sample.md');
    const templates = fs.existsSync(templatesDir)
        ? fs.readdirSync(templatesDir)
            .filter(f => f.endsWith('.md'))
            .map(f => ({ fileName: f, markdown: fs.readFileSync(path.join(templatesDir, f), 'utf-8') }))
        : [];
    const instructionFiles = buildRuleInstructionFiles({
        rules: fs.readFileSync(instructionPath, 'utf-8'),
        sample: fs.existsSync(samplePath) ? fs.readFileSync(samplePath, 'utf-8') : '',
        templates,
    });

    const zip = new AdmZip();
    zip.addFile('00_START_HERE.md', Buffer.from(buildStartHere(templates.map(t => t.fileName), 'zip'), 'utf-8'));
    for (const file of instructionFiles) {
        zip.addFile(file.name, Buffer.from(file.content, 'utf-8'));
    }
    const generatedCount = instructionFiles.length;

    if (fs.existsSync(legacyOutputZipPath)) {
        try {
            fs.unlinkSync(legacyOutputZipPath);
            console.log(`情報: 旧ファイル名の ${legacyOutputZipPath} を削除しました。`);
        } catch (err) {
            console.warn(`警告: ${legacyOutputZipPath} の削除に失敗しました: ${err}`);
        }
    }

    if (fs.existsSync(outputZipPath)) {
        fs.unlinkSync(outputZipPath);
    }
    zip.writeZip(outputZipPath);
    console.log(`成功: ${generatedCount} 件の指示書を ${outputZipPath} にまとめました。`);
}

setup();
