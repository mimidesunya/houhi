/**
 * AIアーカイブ作成ツール。
 *
 * 指定ディレクトリ配下の `.md` / `.txt` を再帰的に収集し、
 * `case/` 配下にディレクトリ構造を保った ZIP を作成します。
 * ZIP のルートには、AI が最初に読む `START_HERE.md`、収録ファイル構成を説明する
 * `README.md`、事件資料の目録 `CASE_INDEX.md`、機械可読の `manifest.json` を自動生成します。
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
import * as fs from 'fs';
import * as path from 'path';

import { writeAiArchive } from './lib/ai_archive/archive_writer';

export { writeAiArchive } from './lib/ai_archive/archive_writer';
export { buildInstructionEntriesFromInstructionsDir, findProjectRoot, loadInstructionEntries, resolveProjectRoots } from './lib/ai_archive/instructions';
export { buildArchiveManifest } from './lib/ai_archive/manifest';
export { buildArchiveReadme, buildCaseIndex, buildInstructionStructure, buildStartHere, buildWarningsMarkdown } from './lib/ai_archive/renderers';
export { getDirectoryStructure, hasTargetFiles, scanCaseDirectory } from './lib/ai_archive/scanner';
export type { ArchiveWarning, ArchiveWriteResult, CaseArchiveScan, CaseFileEntry, InstructionEntry, SkippedFileEntry } from './lib/ai_archive/types';

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
    }
    console.log("\nすべての処理が完了しました。");
}

if (require.main === module) {
    main();
}
