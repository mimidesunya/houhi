import type { CaseArchiveScan, InstructionEntry } from './types';

export function buildArchiveManifest(caseName: string, scan: CaseArchiveScan, instructionEntries: InstructionEntry[]) {
    return {
        schemaVersion: 1,
        archiveType: 'houhi-ai-case-archive',
        generatedAt: new Date().toISOString(),
        caseName,
        roots: {
            caseDocuments: `${scan.caseRoot}/`,
            draftingInstructions: instructionEntries.length > 0 ? 'instructions/' : null,
        },
        entrypoints: [
            'START_HERE.md',
            'CASE_INDEX.md',
            'README.md',
            ...(scan.warnings.length > 0 ? ['WARNINGS.md'] : []),
        ],
        counts: {
            caseFiles: scan.caseFiles.length,
            instructionFiles: instructionEntries.length,
            skippedFiles: scan.skippedFiles.length,
            warnings: scan.warnings.length,
        },
        files: scan.caseFiles.map(file => ({
            path: file.displayPath,
            sourceRelativePath: file.relativePath,
            role: 'case_document',
            documentKind: file.documentKind,
            evidenceNumber: file.evidenceNumber,
            dateCandidates: file.dateCandidates,
            extension: file.extension,
            sizeBytes: file.sizeBytes,
            characterCount: file.characterCount,
            lineCount: file.lineCount,
            warnings: file.warnings,
        })),
        instructions: instructionEntries.map(entry => ({
            path: entry.displayPath,
            role: entry.isWorkflowGuide
                ? 'drafting_workflow_guide'
                : entry.isCommonRules
                    ? 'common_drafting_rules'
                    : 'drafting_instruction',
            sizeBytes: entry.content.length,
        })),
        skippedFiles: scan.skippedFiles,
        warnings: scan.warnings,
    };
}
