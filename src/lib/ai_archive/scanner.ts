import * as fs from 'fs';
import * as path from 'path';
import { CASE_DOCUMENTS_ROOT, MAX_SKIPPED_FILES_IN_WARNING } from './constants';
import { buildFileWarnings, extractDateCandidates, extractEvidenceNumber, inferDocumentKind } from './inference';
import type { ArchiveWarning, CaseArchiveScan, CaseFileEntry, SkippedFileEntry } from './types';
import {
    compareInstructionNames,
    compareInstructionPaths,
    countLines,
    getUtf8Text,
    isTargetTextFile,
    normalizeArchivePath,
} from './utils';

function getSortedDirectoryEntries(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return compareInstructionNames(a.name, b.name);
    });

    return entries;
}

function buildCaseFileEntry(relativePath: string, fullPath: string, caseRoot = CASE_DOCUMENTS_ROOT): CaseFileEntry {
    const content = fs.readFileSync(fullPath);
    const text = getUtf8Text(content);
    const normalizedRelativePath = normalizeArchivePath(relativePath);
    const archivePath = `${caseRoot}/${normalizedRelativePath}`;

    return {
        relativePath: normalizedRelativePath,
        archivePath,
        displayPath: archivePath,
        content,
        extension: path.extname(relativePath).toLowerCase(),
        sizeBytes: content.length,
        characterCount: text.length,
        lineCount: countLines(text),
        documentKind: inferDocumentKind(normalizedRelativePath, text),
        evidenceNumber: extractEvidenceNumber(normalizedRelativePath, text),
        dateCandidates: extractDateCandidates(normalizedRelativePath, text),
        warnings: buildFileWarnings(normalizedRelativePath, content, text),
    };
}

function buildArchiveWarnings(caseFiles: CaseFileEntry[], skippedFiles: SkippedFileEntry[]) {
    const warnings: ArchiveWarning[] = [];

    for (const file of caseFiles) {
        for (const message of file.warnings) {
            warnings.push({
                path: file.displayPath,
                severity: 'warning',
                message,
            });
        }
    }

    const filesByBasename = new Map<string, CaseFileEntry[]>();
    for (const file of caseFiles) {
        const basename = path.basename(file.relativePath).toLowerCase();
        const existingFiles = filesByBasename.get(basename) || [];
        existingFiles.push(file);
        filesByBasename.set(basename, existingFiles);
    }

    for (const files of filesByBasename.values()) {
        if (files.length <= 1) continue;

        warnings.push({
            path: files.map(file => file.displayPath).join(', '),
            severity: 'info',
            message: '同じファイル名の資料が複数あります。AI に参照させるときはパス全体で区別してください。',
        });
    }

    if (skippedFiles.length > 0) {
        const examples = skippedFiles
            .slice(0, MAX_SKIPPED_FILES_IN_WARNING)
            .map(file => file.relativePath)
            .join(', ');
        const suffix = skippedFiles.length > MAX_SKIPPED_FILES_IN_WARNING
            ? ` ほか ${skippedFiles.length - MAX_SKIPPED_FILES_IN_WARNING} 件`
            : '';

        warnings.push({
            path: '(archive)',
            severity: 'info',
            message: `.md / .txt 以外のファイル ${skippedFiles.length} 件はZIPに含めていません: ${examples}${suffix}`,
        });
    }

    return warnings;
}

/**
 * 事件資料フォルダを読み取り、ZIP へ入れる本文資料と、除外したファイルの一覧を作る。
 * ここで基本メタデータも作っておくと、README / CASE_INDEX / manifest で同じ情報を使い回せる。
 */
export function scanCaseDirectory(targetDir: string, caseRoot = CASE_DOCUMENTS_ROOT): CaseArchiveScan {
    const caseFiles: CaseFileEntry[] = [];
    const skippedFiles: SkippedFileEntry[] = [];

    function scan(currentDir: string) {
        const entries = getSortedDirectoryEntries(currentDir);

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relativePath = normalizeArchivePath(path.relative(targetDir, fullPath));

            if (entry.isDirectory()) {
                scan(fullPath);
                continue;
            }

            const stat = fs.statSync(fullPath);
            if (isTargetTextFile(entry.name)) {
                caseFiles.push(buildCaseFileEntry(relativePath, fullPath, caseRoot));
            } else {
                skippedFiles.push({
                    relativePath,
                    extension: path.extname(entry.name).toLowerCase(),
                    sizeBytes: stat.size,
                    reason: '.md / .txt 以外のファイルはAIアーカイブの本文資料から除外します。',
                });
            }
        }
    }

    scan(targetDir);
    caseFiles.sort((a, b) => compareInstructionPaths(a.relativePath, b.relativePath));
    skippedFiles.sort((a, b) => compareInstructionPaths(a.relativePath, b.relativePath));

    return {
        caseRoot,
        caseFiles,
        skippedFiles,
        warnings: buildArchiveWarnings(caseFiles, skippedFiles),
    };
}

/**
 * ユーザーが指定した事件資料フォルダのツリー表示を作る。
 * `.md` / `.txt` を含まないフォルダは README から省き、AI が読むべき資料だけを見せる。
 */
export function getDirectoryStructure(dir: string, baseDir: string, indent = "") {
    let structure = "";
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // フォルダを先に、ファイルを後にソート
    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            // ディレクトリ内の対象ファイルをチェック
            const hasTarget = hasTargetFiles(fullPath);
            if (hasTarget) {
                structure += `${indent}📁 ${entry.name}/\n`;
                structure += getDirectoryStructure(fullPath, baseDir, indent + "  ");
            }
        } else if (isTargetTextFile(entry.name)) {
            structure += `${indent}📄 ${entry.name}\n`;
        }
    }
    return structure;
}

/**
 * 対象ディレクトリのどこかに `.md` / `.txt` があるかを調べる。
 * 空フォルダや画像だけのフォルダを ZIP / README に出さないための事前判定に使う。
 */
export function hasTargetFiles(dir: string): boolean {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (hasTargetFiles(path.join(dir, entry.name))) return true;
        } else if (isTargetTextFile(entry.name)) {
            return true;
        }
    }
    return false;
}
