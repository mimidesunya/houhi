import * as path from 'path';
const AdmZip = require('adm-zip');

import { loadInstructionEntries } from './instructions';
import { buildArchiveManifest } from './manifest';
import { buildArchiveReadme, buildCaseIndex, buildStartHere, buildWarningsMarkdown } from './renderers';
import { getDirectoryStructure, scanCaseDirectory } from './scanner';
import type { ArchiveWriteResult } from './types';

export function writeAiArchive(targetDir: string): ArchiveWriteResult | null {
    const parentDir = path.dirname(targetDir);
    const dirName = path.basename(targetDir);
    const zipPath = path.join(parentDir, `${dirName}.zip`);
    const zip = new AdmZip();
    const scan = scanCaseDirectory(targetDir);

    if (scan.caseFiles.length === 0) {
        return null;
    }

    for (const caseFile of scan.caseFiles) {
        zip.addFile(caseFile.archivePath, caseFile.content);
    }

    // プロジェクト内の起案指示書を同梱し、AI が ZIP だけで書面ルールを参照できるようにする。
    const instructionEntries = loadInstructionEntries();
    for (const instructionEntry of instructionEntries) {
        zip.addFile(instructionEntry.archivePath, instructionEntry.content);
    }

    // ZIP を受け取った AI への案内板として、読み方・資料構成・機械可読索引を追加する。
    const structure = getDirectoryStructure(targetDir, targetDir);
    const readmeContent = buildArchiveReadme(dirName, structure, instructionEntries, scan);
    const startHereContent = buildStartHere(dirName, scan, instructionEntries);
    const caseIndexContent = buildCaseIndex(dirName, scan);
    const manifest = buildArchiveManifest(dirName, scan, instructionEntries);

    zip.addFile("START_HERE.md", Buffer.from(startHereContent, "utf-8"));
    zip.addFile("CASE_INDEX.md", Buffer.from(caseIndexContent, "utf-8"));
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));
    zip.addFile("README.md", Buffer.from(readmeContent, "utf-8"));

    if (scan.warnings.length > 0) {
        zip.addFile("WARNINGS.md", Buffer.from(buildWarningsMarkdown(scan.warnings), "utf-8"));
    }

    zip.writeZip(zipPath);

    return {
        zipPath,
        dirName,
        caseFileCount: scan.caseFiles.length,
        skippedFileCount: scan.skippedFiles.length,
        warningCount: scan.warnings.length,
    };
}
