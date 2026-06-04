const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const draftingTemplateOrder = [
    '訴訟.訴状.md',
    '訴訟.答弁書.md',
    '訴訟.準備書面.md',
    '訴訟.証拠説明書.md',
    '訴訟.送付書.md',
    '訴訟.期日請書.md',
    '訴訟.事務連絡.md',
    '訴訟.移送申立書.md',
    '訴訟.控訴状.md',
    '訴訟.控訴理由書.md',
    '訴訟.上告状兼上告受理申立書.md',
    '訴訟.上告理由書.md',
    '訴訟.上告受理申立て理由書.md',
    '訴訟.忌避申立書.md',
    '反訳書.md',
    '行政.住民監査請求書.md',
    '行政.審査請求書.md',
    '行政.反論書.md',
    '行政.開示請求.md',
    '行政.個人情報開示請求の取下書.md',
    '刑事.告訴状.md'
];

const draftingTemplateRank = new Map(draftingTemplateOrder.map((name, index) => [name, index]));

function compareTemplateNames(a, b) {
    const rankA = draftingTemplateRank.has(a) ? draftingTemplateRank.get(a) : Number.MAX_SAFE_INTEGER;
    const rankB = draftingTemplateRank.has(b) ? draftingTemplateRank.get(b) : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b, 'ja');
}

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

function buildChatGptStartHere(filesToProcess) {
    const documentTypes = filesToProcess
        .filter(file => file.name !== 'sample.md')
        .map(file => path.basename(file.name, '.md'));

    const documentTypeList = documentTypes
        .map(name => `- ${name}`)
        .join('\n');

    return `# START_HERE - ChatGPTへの指示

あなたは「法匪（HOUHI）」の書面起案アシスタントです。
このZIPには、日本の裁判実務向けMarkdown書面を作るための共通ルールと書面別テンプレートが入っています。

## 最初の応答

ユーザーがZIPと一緒に「訴状を起案してほしい」「証拠説明書を作ってほしい」などの具体的な要望を送っている場合は、その要望を優先してください。
書面種別や目的が読み取れる場合は、改めて「何を作りたいか」だけを質問せず、必要なテンプレートを確認したうえで、不足している情報を具体的に質問してください。

このZIPだけを受け取り、ユーザーから何をしてほしいかが明確に示されていない場合は、まだ書面を作り始めないでください。
その場合は、次のように自己紹介し、ユーザーが何の書面を作りたいかを尋ねてください。

例:
「法匪の書面起案アシスタントです。訴状、答弁書、準備書面、控訴理由書、証拠説明書など、どの書面を作成しますか。事件資料やOCR結果があれば一緒に添付してください。」

## 対話の進め方

1. 最初のメッセージに具体的な要望があれば、それを作業目的として扱ってください。
2. 書面種別が未確定なら、ユーザーに作成したい書面種別を確認してください。
3. 書面種別に対応するMarkdownファイルをこのZIP内から探し、まず共通ルール \`sample.md\` と該当テンプレートを読んでください。
4. 事件資料、OCR結果、当事者情報、裁判所名、事件番号、請求内容、主張したい結論、証拠番号など、書面作成に必要な情報が不足していれば質問してください。
5. 情報が揃うまでは、推測で本文を完成させず、不足点を具体的に聞き返してください。
6. 情報が揃ったら、法匪のMarkdown仕様に従って書面本文を生成してください。
7. 生成後に、そのMarkdownを \`.md\` ファイルとして保存し、法匪の「PDF作成」ツールにドロップすれば裁判所提出用PDFに変換できることを案内してください。

## 追加質問の考え方

- 書面種別が未確定なら、候補を示して選ばせてください。
- 事件資料が不足しているなら、まず資料やOCR結果の添付を求めてください。
- 書面の宛先、当事者、事件番号、日付、請求・申立ての趣旨、理由、証拠番号が必要な書面では、それらを個別に確認してください。
- 法的評価と事実関係は分け、資料から読み取れない事実は断定しないでください。
- ユーザーが急いでいる場合は、未確定部分を \`【要確認】\` として下書きを作るか確認してください。

## 出力形式

- 最終成果物はMarkdownコードブロックで提示してください。
- ファイル名の候補も示してください。例: \`訴訟.訴状.md\`
- Markdown本文以外の説明は、本文の前後に分けて簡潔に書いてください。
- PDF化の案内は最後に短く添えてください。

## 利用できる書面テンプレート

${documentTypeList}
`;
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

    const instructionContent = fs.readFileSync(instructionPath, 'utf-8');
    const placeholder = /```markdown\r?\n```/;

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
            .sort(compareTemplateNames)
            .map(f => ({ path: path.join(templatesDir, f), name: f }));
        filesToProcess.push(...templateFiles);
    }

    const zip = new AdmZip();
    let generatedCount = 0;

    zip.addFile('00_START_HERE.md', Buffer.from(buildChatGptStartHere(filesToProcess), 'utf-8'));

    for (const file of filesToProcess) {
        try {
            const content = fs.readFileSync(file.path, 'utf-8');
            const replacement = `\`\`\`markdown\n${content.trim()}\n\`\`\``;
            const finalContent = instructionContent.replace(placeholder, replacement);

            zip.addFile(file.name, Buffer.from(finalContent, 'utf-8'));
            generatedCount += 1;
        } catch (err) {
            console.error(`エラー (${file.name}): ${err}`);
        }
    }

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
