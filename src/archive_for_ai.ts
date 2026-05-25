/**
 * AIアーカイブ作成ツール。
 *
 * 指定ディレクトリ配下の `.md` / `.txt` を再帰的に収集し、
 * `case/` 配下にディレクトリ構造を保った ZIP を作成します。
 * ZIP のルートには、AI が最初に読む `START_HERE.md`、収録ファイル構成を説明する
 * `README.md`、事件資料の目録 `CASE_INDEX.md`、機械可読の `manifest.json` を自動生成します。
 * ユーザーから具体的な指示がない場合でも、AI が現状整理・次の手の提案・作業内容の確認から
 * 始められるように `START_HERE.md` へ対話手順を入れます。
 * `houhi-drafting-kit.zip` から起案指示書を展開同梱し、AI が書面種別ごとの
 * 生成ルールを参照できるようにします。
 * 作成後は、ChatGPT へアップロードするときに添える指示文もコンソールへ表示します。
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
import * as fs from 'fs';
import * as path from 'path';

import { writeAiArchive } from './lib/ai_archive/archive_writer';

export { writeAiArchive } from './lib/ai_archive/archive_writer';
export { buildInstructionEntriesFromInstructionsDir, buildInstructionEntriesFromInstructionsZip, findProjectRoot, loadInstructionEntries, resolveProjectRoots } from './lib/ai_archive/instructions';
export { buildArchiveManifest } from './lib/ai_archive/manifest';
export { buildArchiveReadme, buildCaseIndex, buildInstructionStructure, buildStartHere, buildWarningsMarkdown } from './lib/ai_archive/renderers';
export { getDirectoryStructure, hasTargetFiles, scanCaseDirectory } from './lib/ai_archive/scanner';
export type { ArchiveWarning, ArchiveWriteResult, CaseArchiveScan, CaseFileEntry, InstructionEntry, SkippedFileEntry } from './lib/ai_archive/types';

/**
 * ZIP を添付しただけでは ChatGPT が中身を読み始めないことがあるため、
 * 作成直後にそのまま送れる追加指示を表示する。
 */
function printChatGptUploadGuide(zipPath: string) {
    const zipName = path.basename(zipPath);

    console.log('');
    console.log('[案内] ChatGPTで使う場合:');
    console.log(`1. ${zipName} をChatGPTにアップロードします。`);
    console.log('2. アップロード時に、次の指示文もChatGPTに送ってください。');
    console.log('---');
    console.log(`添付したAIアーカイブZIP（${zipName}）を読み込み、まず START_HERE.md と CASE_INDEX.md を確認してください。このメッセージで「訴状を起案して」「時系列を作って」などの具体的な依頼がある場合は、その依頼を優先してください。具体的な依頼がまだない場合は、現在読み取れる状況を根拠ファイルのパス付きで要約し、次に取れる手を提案したうえで、何をしてほしいか私に質問してください。`);
    console.log('---');
}

/**
 * CLI / GUI から呼ばれるメイン処理。
 * 渡された各ディレクトリについて、本文資料と同梱指示書をまとめた AI 分析用 ZIP を作る。
 */
export async function main() {
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

        const dirName = path.basename(targetDir);

        console.log(`[処理] スキャン中: ${targetDir}`);

        const result = writeAiArchive(targetDir);
        if (!result) {
            console.warn(`[警告] ${dirName} 内に .md / .txt ファイルが見つかりませんでした`);
            continue;
        }

        console.log(`[情報] ${result.caseFileCount} 個のファイルを収録しました。`);
        if (result.skippedFileCount > 0) {
            console.log(`[情報] .md / .txt 以外の ${result.skippedFileCount} 個のファイルは除外しました。`);
        }
        console.log(`[成功] 作成されました: ${result.zipPath}`);
        printChatGptUploadGuide(result.zipPath);
    }
    console.log("\nすべての処理が完了しました。");
}

if (require.main === module) {
    main();
}
