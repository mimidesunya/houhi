import * as fs from 'fs';
import * as path from 'path';
const AdmZip = require('adm-zip');

import { hasTargetFiles } from './scanner';
import {
    VIRTUAL_TEAM_INSTRUCTION_ARCHIVE_PATH,
    VIRTUAL_TEAM_INSTRUCTION_DOC_PATH_PARTS,
    buildVirtualTeamArchiveInstructionContent,
} from './team_instruction';
import type { InstructionEntry } from './types';
import { compareInstructionNames, compareInstructionPaths, isTargetTextFile, normalizeArchivePath } from './utils';

const INSTRUCTION_ZIP_FILE_NAMES = ['houhi-drafting-kit.zip', 'instructions.zip'];

function findInstructionZipPath(projectRoot: string) {
    for (const fileName of INSTRUCTION_ZIP_FILE_NAMES) {
        const zipPath = path.join(projectRoot, fileName);
        if (fs.existsSync(zipPath)) {
            return zipPath;
        }
    }

    return null;
}

/**
 * 実行場所から上位ディレクトリへたどり、プロジェクトルートを探す。
 * GUI / CLI / テストなど起動位置が変わっても指示書セットを見つけられるようにしている。
 */
export function findProjectRoot(startDir: string) {
    let currentDir = path.resolve(startDir);

    while (true) {
        const packageJsonPath = path.join(currentDir, 'package.json');
        const instructionsDir = path.join(currentDir, 'instructions');
        const instructionsZipPath = findInstructionZipPath(currentDir);
        const virtualTeamInstructionPath = path.join(currentDir, ...VIRTUAL_TEAM_INSTRUCTION_DOC_PATH_PARTS);

        if (fs.existsSync(packageJsonPath) && (instructionsZipPath || fs.existsSync(instructionsDir) || fs.existsSync(virtualTeamInstructionPath))) {
            return currentDir;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            return null;
        }

        currentDir = parentDir;
    }
}

function normalizeInstructionZipEntryName(entryName: string) {
    const normalizedName = normalizeArchivePath(entryName).replace(/^instructions\//, '');
    const parts = normalizedName.split('/');

    if (
        normalizedName.length === 0 ||
        path.isAbsolute(normalizedName) ||
        parts.some(part => part === '..' || part === '')
    ) {
        return null;
    }

    return normalizedName;
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
            isWorkflowGuide: path.basename(relPath).toLowerCase().endsWith('start_here.md'),
            isTeamGuide: false,
        };
    });
}

/**
 * `houhi-drafting-kit.zip` から、AIアーカイブ内の `instructions/` に展開する指示書一覧を作る。
 * ZIP内に `instructions/` フォルダが付いていても、付いていなくても同じ形へ正規化する。
 */
export function buildInstructionEntriesFromInstructionsZip(instructionsZipPath: string): InstructionEntry[] {
    if (!fs.existsSync(instructionsZipPath)) {
        return [];
    }

    const zip = new AdmZip(instructionsZipPath);
    return zip.getEntries()
        .filter(entry => !entry.isDirectory)
        .map(entry => {
            const relativePath = normalizeInstructionZipEntryName(entry.entryName);
            if (!relativePath || !isTargetTextFile(relativePath)) {
                return null;
            }

            return {
                archivePath: `instructions/${relativePath}`,
                displayPath: `instructions/${relativePath}`,
                content: entry.getData(),
                isCommonRules: path.basename(relativePath).toLowerCase() === 'sample.md',
                isWorkflowGuide: path.basename(relativePath).toLowerCase().endsWith('start_here.md'),
                isTeamGuide: false,
            };
        })
        .filter((entry): entry is InstructionEntry => entry !== null)
        .sort((a, b) => compareInstructionPaths(a.displayPath, b.displayPath));
}

export function buildVirtualTeamInstructionEntry(projectRoot: string): InstructionEntry | null {
    const sourcePath = path.join(projectRoot, ...VIRTUAL_TEAM_INSTRUCTION_DOC_PATH_PARTS);
    if (!fs.existsSync(sourcePath)) {
        return null;
    }

    return {
        archivePath: VIRTUAL_TEAM_INSTRUCTION_ARCHIVE_PATH,
        displayPath: VIRTUAL_TEAM_INSTRUCTION_ARCHIVE_PATH,
        content: buildVirtualTeamArchiveInstructionContent(fs.readFileSync(sourcePath)),
        isCommonRules: false,
        isWorkflowGuide: false,
        isTeamGuide: true,
    };
}

function appendVirtualTeamInstructionEntry(instructionEntries: InstructionEntry[], projectRoot: string) {
    if (instructionEntries.some(entry => entry.displayPath === VIRTUAL_TEAM_INSTRUCTION_ARCHIVE_PATH)) {
        return instructionEntries;
    }

    const teamInstructionEntry = buildVirtualTeamInstructionEntry(projectRoot);
    if (!teamInstructionEntry) {
        return instructionEntries;
    }

    return [...instructionEntries, teamInstructionEntry].sort((a, b) => compareInstructionPaths(a.displayPath, b.displayPath));
}

/**
 * 利用可能な指示書セットを読み込む。
 * 先に見つかったプロジェクトルートの `houhi-drafting-kit.zip` を優先し、
 * 旧名 `instructions.zip` と旧来の `instructions/` も互換用に読む。
 */
export function loadInstructionEntries(searchRoots: string[] = [process.cwd(), __dirname]) {
    const projectRoots = resolveProjectRoots(searchRoots);

    for (const projectRoot of projectRoots) {
        const instructionZipPath = findInstructionZipPath(projectRoot);
        if (instructionZipPath) {
            const zippedInstructionEntries = buildInstructionEntriesFromInstructionsZip(instructionZipPath);
            if (zippedInstructionEntries.length > 0) {
                return appendVirtualTeamInstructionEntry(zippedInstructionEntries, projectRoot);
            }
        }

        const instructionEntries = buildInstructionEntriesFromInstructionsDir(path.join(projectRoot, 'instructions'));
        if (instructionEntries.length > 0) {
            return appendVirtualTeamInstructionEntry(instructionEntries, projectRoot);
        }

        const teamInstructionEntry = buildVirtualTeamInstructionEntry(projectRoot);
        if (teamInstructionEntry) {
            return [teamInstructionEntry];
        }
    }

    return [];
}
