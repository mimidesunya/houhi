/**
 * Word変換ツール。
 *
 * HOUHI Markdown を、あとから編集できる Word 文書（`.docx`）へ変換します。
 * Word出力は編集用です。裁判所への提出・印刷には、最終確認後にPDFを使用してください。
 *
 * 入力:
 * - `.md`
 * - 引数なしの場合はクリップボード内の Markdown
 *
 * 出力:
 * - 入力ファイルと同じ場所に、同じ基礎名の `.docx` を作成します。
 * - 同名の Word ファイルが既にある場合は上書きせず、`_2`、`_3` の連番を付けます。
 * - クリップボード入力時は `output/` を使用します。
 * - 入力 Markdown と参照画像は変更しません。
 *
 * 補足:
 * - A4、裁判文書用余白、日本語明朝、見出し、表、右寄せ、画像、改ページ、目次を Word 用に変換します。
 * - WordではPDFと改ページ、表幅、目次のページ番号が異なる場合があります。出力後に必ず確認してください。
 * - 起動時のフィールド更新は要求しません。目次を更新する場合は、Wordで `Ctrl+A`、`F9` を押してください。
 * - HTTP、UNC、文書フォルダ外の画像は取得・埋め込みしません。
 *
 * 使い方:
 *   node src/convert_to_word.js <入力ファイルパス(.md) ...>
 *   node src/convert_to_word.js --no-open <入力ファイルパス(.md)>
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const clipboardy = require('clipboardy');
const { convertCourtMarkdownToDocx } = require('./lib/docx_converter');

const BASE_DIR = __dirname;
const PROJECT_ROOT = path.dirname(BASE_DIR);
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

function printUsage() {
    console.log('使い方: node src/convert_to_word.js [--no-open] <入力ファイルパス(.md) ...>');
    console.log('引数なしの場合は、クリップボード内のMarkdownをWordへ変換します。');
}

function parseArgs(args: string[]) {
    const files: string[] = [];
    let openOutput = true;

    for (const arg of args) {
        if (arg === '--help' || arg === '-h') return { files, openOutput, help: true };
        if (arg === '--no-open') {
            openOutput = false;
            continue;
        }
        if (arg.startsWith('-')) throw new Error(`不明なオプションです: ${arg}`);
        files.push(arg);
    }
    return { files, openOutput, help: false };
}

function sanitizeFilePart(value: string, fallback = '裁判文書') {
    const sanitized = String(value || '').replace(/[\\/*?:"<>|]/g, '').trim();
    return sanitized || fallback;
}

function extractTitle(markdown: string) {
    const match = String(markdown || '').match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : '裁判文書';
}

function openOutputFile(outputPath: string) {
    const command = process.platform === 'win32'
        ? 'explorer.exe'
        : process.platform === 'darwin'
            ? 'open'
            : 'xdg-open';
    try {
        const child = spawn(command, [outputPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            shell: false
        });
        child.on('error', error => console.error(`Wordファイルを開けませんでした: ${error.message}`));
        child.unref();
    } catch (error) {
        console.error(`Wordファイルを開けませんでした: ${error instanceof Error ? error.message : error}`);
    }
}

async function convertMarkdownText(
    markdown: string,
    desiredOutputPath: string,
    resourceDir: string,
    openOutput = true
) {
    const title = extractTitle(markdown);
    const result = await convertCourtMarkdownToDocx(markdown, desiredOutputPath, resourceDir, title);
    for (const warning of result.warnings) {
        console.warn(`【要確認】${warning.message}`);
    }
    console.log(`Wordファイルを作成しました: ${result.outputPath}`);
    console.log('提出前にWordで改ページ、文字位置、表の幅を確認してください。');
    if (openOutput) openOutputFile(result.outputPath);
    return result;
}

async function processMarkdownFile(inputPath: string, openOutput = true) {
    const absolutePath = path.resolve(inputPath);
    if (!fs.existsSync(absolutePath)) throw new Error(`入力ファイルが見つかりません: ${absolutePath}`);
    if (!fs.statSync(absolutePath).isFile()) throw new Error(`ファイルを指定してください: ${absolutePath}`);
    if (path.extname(absolutePath).toLowerCase() !== '.md') {
        throw new Error(`Word出力には .md ファイルを指定してください: ${absolutePath}`);
    }

    const markdown = fs.readFileSync(absolutePath, 'utf-8');
    const desiredOutputPath = path.join(
        path.dirname(absolutePath),
        `${path.basename(absolutePath, path.extname(absolutePath))}.docx`
    );
    return convertMarkdownText(markdown, desiredOutputPath, path.dirname(absolutePath), openOutput);
}

async function processClipboard(openOutput = true) {
    const markdown = clipboardy.readSync();
    if (!markdown || !markdown.trim()) throw new Error('クリップボードにMarkdownがありません。');
    fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
    const title = sanitizeFilePart(extractTitle(markdown));
    const date = new Date().toISOString().slice(0, 10);
    const desiredOutputPath = path.join(DEFAULT_OUTPUT_DIR, `${date}-${title}.docx`);
    return convertMarkdownText(markdown, desiredOutputPath, DEFAULT_OUTPUT_DIR, openOutput);
}

async function main() {
    let parsed;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`エラー: ${error instanceof Error ? error.message : error}`);
        printUsage();
        process.exitCode = 1;
        return;
    }

    if (parsed.help) {
        printUsage();
        return;
    }

    let failed = false;
    if (parsed.files.length === 0) {
        try {
            await processClipboard(parsed.openOutput);
        } catch (error) {
            failed = true;
            console.error(`エラー: ${error instanceof Error ? error.message : error}`);
        }
    } else {
        for (const file of parsed.files) {
            try {
                await processMarkdownFile(file, parsed.openOutput);
            } catch (error) {
                failed = true;
                console.error(`エラー: ${error instanceof Error ? error.message : error}`);
            }
        }
    }

    if (failed) process.exitCode = 1;
}

if (require.main === module) {
    main();
}

module.exports = {
    extractTitle,
    main,
    openOutputFile,
    parseArgs,
    processClipboard,
    processMarkdownFile,
    sanitizeFilePart
};
