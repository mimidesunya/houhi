import { CASE_DOCUMENTS_ROOT, MAX_SKIPPED_FILES_IN_WARNING } from '../lib/ai_archive/constants';
import { buildFileWarnings, extractDateCandidates, extractEvidenceNumber, inferDocumentKind } from '../lib/ai_archive/inference';
import { buildArchiveManifest } from '../lib/ai_archive/manifest';
import { buildArchiveReadme, buildCaseIndex, buildStartHere, buildWarningsMarkdown } from '../lib/ai_archive/renderers';
import type { ArchiveWarning, CaseArchiveScan, CaseFileEntry, InstructionEntry, SkippedFileEntry } from '../lib/ai_archive/types';
import { compareInstructionPaths, countLines, getPathBasename, getPathExtname, isTargetTextFile } from '../lib/ai_archive/utils';
import { buildStoredZip } from './zip';

type ArchiveInstructionData = {
    displayPath: string;
    content: string;
    isCommonRules: boolean;
    isWorkflowGuide: boolean;
};

type ArchiveWebData = {
    generatedAt: string;
    instructions: ArchiveInstructionData[];
};

type SelectedInputFile = {
    file: File;
    relativePath: string;
};

type PreparedInputFile = {
    file: File;
    relativePath: string;
};

type ZipEntry = {
    path: string;
    data: Uint8Array;
};

type WebkitFileSystemEntry = {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    fullPath: string;
};

type WebkitFileSystemFileEntry = WebkitFileSystemEntry & {
    file(successCallback: (file: File) => void, errorCallback?: (err: DOMException) => void): void;
};

type WebkitFileSystemDirectoryEntry = WebkitFileSystemEntry & {
    createReader(): {
        readEntries(successCallback: (entries: WebkitFileSystemEntry[]) => void, errorCallback?: (err: DOMException) => void): void;
    };
};

const archiveData = (window as any).HOUHI_ARCHIVE_DATA as ArchiveWebData;
const encoder = new TextEncoder();

const directoryInput = document.getElementById('directoryInput') as HTMLInputElement;
const fileInput = document.getElementById('archiveFileInput') as HTMLInputElement;
const dropZone = document.getElementById('archiveDropZone') as HTMLElement;
const chooseDirectoryButton = document.getElementById('chooseDirectoryButton') as HTMLButtonElement;
const chooseFilesButton = document.getElementById('chooseFilesButton') as HTMLButtonElement;
const createArchiveButton = document.getElementById('createArchiveButton') as HTMLButtonElement;
const copyArchiveGuideButton = document.getElementById('copyArchiveGuideButton') as HTMLButtonElement;
const archiveStatus = document.getElementById('archiveStatus') as HTMLElement;
const fileSummary = document.getElementById('fileSummary') as HTMLElement;
const archiveGuideOutput = document.getElementById('archiveGuideOutput') as HTMLTextAreaElement;
const archiveLinks = document.getElementById('archiveLinks') as HTMLElement;

let selectedFiles: SelectedInputFile[] = [];
let latestGuide = '';

function setStatus(message: string) {
    archiveStatus.textContent = message;
}

function setLinksVisible(visible: boolean) {
    archiveLinks.hidden = !visible;
}

function sanitizePath(value: string) {
    const normalized = value
        .replace(/\\/g, '/')
        .replace(/^[a-zA-Z]:\//, '')
        .replace(/^\/+/, '');
    const parts = normalized
        .split('/')
        .map(part => part.trim())
        .filter(part => part.length > 0 && part !== '.' && part !== '..');

    return parts.join('/');
}

function getInputRelativePath(file: File, fallbackIndex: number) {
    const relativePath = sanitizePath((file as any).webkitRelativePath || file.name);
    return relativePath || `file-${fallbackIndex + 1}.txt`;
}

function getCommonRoot(paths: string[]) {
    if (paths.length === 0) {
        return null;
    }

    const firstParts = paths[0].split('/');
    if (firstParts.length < 2) {
        return null;
    }

    const root = firstParts[0];
    const allHaveRoot = paths.every(path => {
        const parts = path.split('/');
        return parts.length >= 2 && parts[0] === root;
    });

    return allHaveRoot ? root : null;
}

function prepareFiles(files: SelectedInputFile[]) {
    const sanitized = files.map((entry, index) => ({
        file: entry.file,
        relativePath: sanitizePath(entry.relativePath) || getInputRelativePath(entry.file, index),
    }));
    const commonRoot = getCommonRoot(sanitized.map(entry => entry.relativePath));
    const prepared = sanitized.map(entry => {
        const relativePath = commonRoot
            ? entry.relativePath.slice(commonRoot.length + 1)
            : entry.relativePath;
        return {
            file: entry.file,
            relativePath: relativePath || getInputRelativePath(entry.file, 0),
        };
    });

    return {
        caseName: commonRoot || 'ai-archive',
        files: prepared,
    };
}

function getSelectedFileStats(files: SelectedInputFile[]) {
    const prepared = prepareFiles(files).files;
    return {
        targetCount: prepared.filter(entry => isTargetTextFile(entry.relativePath)).length,
        skippedCount: prepared.filter(entry => !isTargetTextFile(entry.relativePath)).length,
    };
}

function updateSelectedFiles(files: SelectedInputFile[]) {
    selectedFiles = files.sort((a, b) => compareInstructionPaths(a.relativePath, b.relativePath));
    const stats = getSelectedFileStats(selectedFiles);

    fileSummary.textContent = selectedFiles.length === 0
        ? '.md / .txt を含むフォルダまたはファイルを選択してください。'
        : `${selectedFiles.length}件を選択中。収録対象 ${stats.targetCount}件、除外 ${stats.skippedCount}件。`;
    createArchiveButton.disabled = stats.targetCount === 0;
    setStatus(stats.targetCount === 0 ? '対象ファイルなし' : '作成できます');
    setLinksVisible(false);
}

function makeArchiveWarning(caseFiles: CaseFileEntry[], skippedFiles: SkippedFileEntry[]) {
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
        const basename = getPathBasename(file.relativePath).toLowerCase();
        const group = filesByBasename.get(basename) || [];
        group.push(file);
        filesByBasename.set(basename, group);
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

function addTreeNode(tree: Record<string, any>, relativePath: string) {
    const parts = relativePath.split('/').filter(Boolean);
    let node = tree;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        if (isLast) {
            node[part] = null;
        } else {
            node[part] = node[part] || {};
            node = node[part];
        }
    }
}

function renderTree(node: Record<string, any>, indent = '') {
    const names = Object.keys(node).sort(compareInstructionPaths);
    let output = '';

    for (const name of names) {
        const child = node[name];
        if (child === null) {
            output += `${indent}📄 ${name}\n`;
        } else {
            output += `${indent}📁 ${name}/\n`;
            output += renderTree(child, `${indent}  `);
        }
    }

    return output;
}

function buildDirectoryStructure(caseFiles: CaseFileEntry[]) {
    const tree: Record<string, any> = {};

    for (const file of caseFiles) {
        addTreeNode(tree, file.relativePath);
    }

    return renderTree(tree);
}

async function buildScan(preparedFiles: PreparedInputFile[]): Promise<CaseArchiveScan> {
    const caseFiles: CaseFileEntry[] = [];
    const skippedFiles: SkippedFileEntry[] = [];

    for (const entry of preparedFiles) {
        const relativePath = sanitizePath(entry.relativePath);

        if (!isTargetTextFile(relativePath)) {
            skippedFiles.push({
                relativePath,
                extension: getPathExtname(relativePath).toLowerCase(),
                sizeBytes: entry.file.size,
                reason: '.md / .txt 以外のファイルはAIアーカイブの本文資料から除外します。',
            });
            continue;
        }

        const text = await entry.file.text();
        const content = encoder.encode(text);
        const archivePath = `${CASE_DOCUMENTS_ROOT}/${relativePath}`;

        caseFiles.push({
            relativePath,
            archivePath,
            displayPath: archivePath,
            content: content as any,
            extension: getPathExtname(relativePath).toLowerCase(),
            sizeBytes: content.length,
            characterCount: text.length,
            lineCount: countLines(text),
            documentKind: inferDocumentKind(relativePath, text),
            evidenceNumber: extractEvidenceNumber(relativePath, text),
            dateCandidates: extractDateCandidates(relativePath, text),
            warnings: buildFileWarnings(relativePath, content as any, text),
        });
    }

    caseFiles.sort((a, b) => compareInstructionPaths(a.relativePath, b.relativePath));
    skippedFiles.sort((a, b) => compareInstructionPaths(a.relativePath, b.relativePath));

    return {
        caseRoot: CASE_DOCUMENTS_ROOT,
        caseFiles,
        skippedFiles,
        warnings: makeArchiveWarning(caseFiles, skippedFiles),
    };
}

function buildInstructionEntries() {
    return archiveData.instructions.map(entry => ({
        archivePath: entry.displayPath,
        displayPath: entry.displayPath,
        content: encoder.encode(entry.content) as any,
        isCommonRules: entry.isCommonRules,
        isWorkflowGuide: entry.isWorkflowGuide,
    } satisfies InstructionEntry));
}

function ensureUniqueEntries(entries: ZipEntry[]) {
    const seen = new Map<string, number>();

    return entries.map(entry => {
        const count = seen.get(entry.path) || 0;
        seen.set(entry.path, count + 1);

        if (count === 0) {
            return entry;
        }

        const dotIndex = entry.path.lastIndexOf('.');
        const uniquePath = dotIndex > 0
            ? `${entry.path.slice(0, dotIndex)}-${count + 1}${entry.path.slice(dotIndex)}`
            : `${entry.path}-${count + 1}`;
        return { ...entry, path: uniquePath };
    });
}

function buildUploadGuide(zipName: string) {
    return `添付したAIアーカイブZIP（${zipName}）を読み込み、まず START_HERE.md と CASE_INDEX.md を確認してください。このメッセージで「訴状を起案して」「時系列を作って」などの具体的な依頼がある場合は、その依頼を優先してください。具体的な依頼がまだない場合は、現在読み取れる状況を根拠ファイルのパス付きで要約し、次に取れる手を提案したうえで、何をしてほしいか私に質問してください。`;
}

function downloadZip(zipName: string, bytes: Uint8Array) {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = zipName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function createArchive() {
    if (selectedFiles.length === 0) {
        return;
    }

    createArchiveButton.disabled = true;
    copyArchiveGuideButton.disabled = true;
    setStatus('作成中...');
    setLinksVisible(false);

    try {
        const prepared = prepareFiles(selectedFiles);
        const scan = await buildScan(prepared.files);

        if (scan.caseFiles.length === 0) {
            setStatus('対象ファイルなし');
            return;
        }

        const instructionEntries = buildInstructionEntries();
        const structure = buildDirectoryStructure(scan.caseFiles);
        const caseName = prepared.caseName || 'ai-archive';
        const zipName = `${caseName}.zip`;
        const entries: ZipEntry[] = [
            ...scan.caseFiles.map(file => ({
                path: file.archivePath,
                data: file.content as any as Uint8Array,
            })),
            ...instructionEntries.map(entry => ({
                path: entry.archivePath,
                data: entry.content as any as Uint8Array,
            })),
            {
                path: 'START_HERE.md',
                data: encoder.encode(buildStartHere(caseName, scan, instructionEntries)),
            },
            {
                path: 'CASE_INDEX.md',
                data: encoder.encode(buildCaseIndex(caseName, scan)),
            },
            {
                path: 'manifest.json',
                data: encoder.encode(JSON.stringify(buildArchiveManifest(caseName, scan, instructionEntries), null, 2)),
            },
            {
                path: 'README.md',
                data: encoder.encode(buildArchiveReadme(caseName, structure, instructionEntries, scan)),
            },
        ];

        if (scan.warnings.length > 0) {
            entries.push({
                path: 'WARNINGS.md',
                data: encoder.encode(buildWarningsMarkdown(scan.warnings)),
            });
        }

        const zipBytes = buildStoredZip(ensureUniqueEntries(entries));
        downloadZip(zipName, zipBytes);

        latestGuide = buildUploadGuide(zipName);
        archiveGuideOutput.value = latestGuide;
        copyArchiveGuideButton.disabled = false;
        setStatus(`作成しました。収録 ${scan.caseFiles.length}件、除外 ${scan.skippedFiles.length}件。`);
        setLinksVisible(true);
    } catch (err) {
        console.error(err);
        setStatus('作成に失敗しました。ファイルを確認してください。');
    } finally {
        const stats = getSelectedFileStats(selectedFiles);
        createArchiveButton.disabled = stats.targetCount === 0;
    }
}

async function copyGuide() {
    if (!latestGuide) {
        archiveGuideOutput.select();
        latestGuide = archiveGuideOutput.value;
    }

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(latestGuide);
        } else {
            archiveGuideOutput.focus();
            archiveGuideOutput.select();
            document.execCommand('copy');
        }
        setStatus('指示文をコピーしました');
        setLinksVisible(true);
    } catch (err) {
        console.error(err);
        setStatus('コピーできませんでした。本文を選択してコピーしてください。');
    }
}

function filesFromInput(fileList: FileList | null) {
    return Array.from(fileList || []).map((file, index) => ({
        file,
        relativePath: getInputRelativePath(file, index),
    }));
}

function readDirectoryEntries(reader: ReturnType<WebkitFileSystemDirectoryEntry['createReader']>) {
    return new Promise<WebkitFileSystemEntry[]>((resolve, reject) => {
        const entries: WebkitFileSystemEntry[] = [];

        function readBatch() {
            reader.readEntries(batch => {
                if (batch.length === 0) {
                    resolve(entries);
                    return;
                }

                entries.push(...batch);
                readBatch();
            }, reject);
        }

        readBatch();
    });
}

async function collectEntryFiles(entry: WebkitFileSystemEntry): Promise<SelectedInputFile[]> {
    if (entry.isFile) {
        const fileEntry = entry as WebkitFileSystemFileEntry;
        const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
        return [{
            file,
            relativePath: sanitizePath(entry.fullPath || entry.name) || file.name,
        }];
    }

    if (entry.isDirectory) {
        const directoryEntry = entry as WebkitFileSystemDirectoryEntry;
        const children = await readDirectoryEntries(directoryEntry.createReader());
        const nested = await Promise.all(children.map(collectEntryFiles));
        return nested.flat();
    }

    return [];
}

async function filesFromDrop(dataTransfer: DataTransfer) {
    const entries = Array.from(dataTransfer.items || [])
        .filter(item => item.kind === 'file')
        .map(item => {
            const getEntry = (item as any).webkitGetAsEntry;
            return typeof getEntry === 'function' ? getEntry.call(item) as WebkitFileSystemEntry | null : null;
        })
        .filter((entry): entry is WebkitFileSystemEntry => entry != null);

    if (entries.length > 0) {
        const nested = await Promise.all(entries.map(collectEntryFiles));
        return nested.flat();
    }

    return filesFromInput(dataTransfer.files);
}

chooseDirectoryButton.addEventListener('click', () => directoryInput.click());
chooseFilesButton.addEventListener('click', () => fileInput.click());
createArchiveButton.addEventListener('click', createArchive);
copyArchiveGuideButton.addEventListener('click', copyGuide);

directoryInput.addEventListener('change', () => updateSelectedFiles(filesFromInput(directoryInput.files)));
fileInput.addEventListener('change', () => updateSelectedFiles(filesFromInput(fileInput.files)));

dropZone.addEventListener('click', () => directoryInput.click());
dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async event => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    setStatus('読み込み中...');
    updateSelectedFiles(await filesFromDrop(event.dataTransfer as DataTransfer));
});

archiveGuideOutput.value = 'ZIPを作成すると、Chat AIへ貼り付ける指示文がここに表示されます。';
createArchiveButton.disabled = true;
copyArchiveGuideButton.disabled = true;
setLinksVisible(false);
updateSelectedFiles([]);
