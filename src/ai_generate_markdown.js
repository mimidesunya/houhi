/**
 * Gemini APIを使用して、テキスト入力またはクリップボードの内容から裁判文書のMarkdownを生成するプログラム。
 * 
 * 使い方:
 *   node src/ai_generate_markdown.js [入力テキストファイルパス]
 * 
 * 引数がない場合は、クリップボードからテキストを取得します。
 * 生成されたMarkdownは、入力ファイルと同じディレクトリ（またはoutputフォルダ）に保存されます。
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const clipboardy = require('clipboardy');
const { loadConfig, getApiKey } = require('./lib/gemini_client.js');

// 設定
const BASE_DIR = __dirname;
const PROJECT_ROOT = path.dirname(BASE_DIR);
const INSTRUCTION_PATH = path.join(PROJECT_ROOT, 'instructions', 'sample.md');

// デフォルト値
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

function loadInstruction() {
    if (!fs.existsSync(INSTRUCTION_PATH)) {
        console.warn(`警告: 指示書 ${INSTRUCTION_PATH} が見つかりません。`);
        return "";
    }
    try {
        return fs.readFileSync(INSTRUCTION_PATH, 'utf-8');
    } catch (err) {
        console.error(`指示書の読み込みエラー: ${err}`);
        return "";
    }
}

async function generateMarkdownWithGemini(text, config) {
    const apiKey = getApiKey();
    
    if (!apiKey) {
        console.error("Gemini APIキーが設定されていません。");
        return null;
    }

    const geminiConfig = (config && config.gemini) || {};
    const modelName = geminiConfig.textModel || 'gemini-pro';

    const genAI = new GoogleGenerativeAI(apiKey);
    
    const instruction = loadInstruction();
    if (!instruction) {
        console.error("指示書が空です。");
        return null;
    }

    try {
        console.log("Geminiに問い合わせ中...");
        const model = genAI.getGenerativeModel({ model: modelName });
        
        const prompt = `${instruction}\n\n---\n\nUser Input:\n${text}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let content = response.text();
        
        // レスポンスからMarkdownを抽出（コードブロックを除去）
        if (content.includes("```markdown")) {
            content = content.split("```markdown")[1].split("```")[0].trim();
        } else if (content.includes("```")) {
            content = content.split("```")[1].split("```")[0].trim();
        }
            
        return content;
    } catch (err) {
        console.error(`Gemini APIエラー: ${err}`);
        return null;
    }
}

async function main() {
    let inputText = "";
    let inputPath = "";

    const args = process.argv.slice(2);

    // 1. 入力ソースの決定
    if (args.length > 0 && args[0].trim()) {
        inputPath = path.resolve(args[0]);
        
        if (!fs.existsSync(inputPath)) {
            console.error(`エラー: 入力ファイル ${inputPath} が見つかりません。`);
            return;
        }

        try {
            inputText = fs.readFileSync(inputPath, 'utf-8');
            console.log(`テキストファイルを読み込みました: ${inputPath}`);
        } catch (err) {
            console.error(`ファイル読み込みエラー: ${err}`);
            return;
        }
    } else {
        // 引数がない場合、インタラクティブモード
        console.log("-------------------------------------------------------");
        console.log(" ファイルが指定されていません。");
        console.log(" クリップボードモードで実行します。");
        console.log("-------------------------------------------------------");
        console.log("");
        console.log(" 1. 変換したいテキストをコピーしてください。");
        console.log(" 2. 準備ができたら Enter キーを押してください。");
        console.log("");

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        await new Promise(resolve => rl.question('', resolve));
        rl.close();

        try {
            const clipboardContent = clipboardy.readSync();
            if (clipboardContent) {
                inputText = clipboardContent;
                console.log("クリップボードからテキストを取得しました。");
            } else {
                console.error("クリップボードが空です。");
                return;
            }
        } catch (err) {
            console.error(`クリップボード取得エラー: ${err}`);
            return;
        }
    }

    const config = loadConfig();
    if (!config) return;

    const markdownContent = await generateMarkdownWithGemini(inputText, config);
    if (!markdownContent) {
        console.error("Markdown生成に失敗しました。");
        return;
    }

    const titleMatch = markdownContent.match(/^#\s+(.*)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "裁判文書";

    const safeTitle = title.replace(/[\\/*?:"<>|]/g, "");
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    
    let outputDir = inputPath ? path.dirname(inputPath) : DEFAULT_OUTPUT_DIR;
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseFilename = inputPath ? path.basename(inputPath, path.extname(inputPath)) : `${dateStr}-${safeTitle}`;
    // 元のファイルが .md の場合に上書きされないよう、またAI生成であることを明示するために _ai を付与
    const outputMdPath = path.join(outputDir, `${baseFilename}_ai.md`);

    fs.writeFileSync(outputMdPath, markdownContent, 'utf-8');
    console.log(`Markdownを保存しました: ${outputMdPath}`);
}

main();
