import * as fs from 'fs';
import * as path from 'path';
import { hasTargetFiles } from './scanner';
import type { InstructionEntry } from './types';
import { compareInstructionNames, compareInstructionPaths, isTargetTextFile, normalizeArchivePath } from './utils';

/**
 * 実行場所から上位ディレクトリへたどり、プロジェクトルートを探す。
 * GUI / CLI / テストなど起動位置が変わっても `instructions/` を見つけられるようにしている。
 */
export function findProjectRoot(startDir: string) {
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

/**
 * 複数の候補ディレクトリから、重複のないプロジェクトルート一覧を作る。
 * `process.cwd()` と `__dirname` が同じプロジェクトを指すことがあるため Set で除重する。
 */
export function resolveProjectRoots(searchRoots: string[] = [process.cwd(), __dirname]) {
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

/**
 * 対象ディレクトリ配下の `.md` / `.txt` を再帰的に集める。
 * ZIP 内や README 内で OS 差が出ないよう、返す相対パスは `/` 区切りに統一する。
 */
function collectTargetFilesRecursively(dir: string, baseDir = dir) {
    let files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // README と ZIP の内容が毎回同じ順序になるよう、ディレクトリ優先で安定ソートする。
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
            files.push(normalizeArchivePath(path.relative(baseDir, fullPath)));
        }
    }

    return files;
}

/**
 * `instructions/` フォルダから、ZIP に同梱する指示書一覧を作る。
 * 対象ファイルがない場合は空配列にして、ユーザー資料だけの ZIP として処理を続ける。
 */
export function buildInstructionEntriesFromInstructionsDir(instructionsDir: string): InstructionEntry[] {
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

/**
 * 利用可能な指示書セットを読み込む。
 * 先に見つかったプロジェクトルートの `instructions/` を採用し、見つからない場合は同梱なしにする。
 */
export function loadInstructionEntries(searchRoots: string[] = [process.cwd(), __dirname]) {
    const projectRoots = resolveProjectRoots(searchRoots);

    for (const projectRoot of projectRoots) {
        const instructionEntries = buildInstructionEntriesFromInstructionsDir(path.join(projectRoot, 'instructions'));
        if (instructionEntries.length > 0) {
            return instructionEntries;
        }
    }

    return [];
}
