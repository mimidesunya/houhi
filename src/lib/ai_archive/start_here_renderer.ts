import type { CaseArchiveScan, InstructionEntry } from './types';

export function buildStartHere(caseName: string, scan: CaseArchiveScan, instructionEntries: InstructionEntry[]) {
    const hasInstructions = instructionEntries.length > 0;
    const warningLine = scan.warnings.length > 0
        ? '- `WARNINGS.md` がある場合は、空ファイル・長大ファイル・除外ファイルなどの注意点を先に確認してください。'
        : '- このアーカイブには、読み込み前に確認すべき警告は検出されていません。';

    return `# START_HERE - AIへの読み込み指示

このZIPは、ChatGPTなどのAIが事件資料を読み込み、状況把握・質問回答・書面起案補助を行いやすいように整理したアーカイブです。

## 最初に読む順番

1. \`START_HERE.md\` - このファイルです。アーカイブの読み方を確認してください。
2. \`CASE_INDEX.md\` - 事件資料の一覧、推奨読解順、証拠番号や日付候補を確認してください。
3. \`manifest.json\` - 機械可読の索引です。必要に応じてファイル一覧や警告を確認してください。
4. \`${scan.caseRoot}/\` - 事件の事実関係を示す本文資料です。
${hasInstructions ? `5. \`instructions/\` - 書面を起案するときの形式・文体・Markdownルールです。事件の事実そのものではありません。` : ''}

## 重要な区別

- \`${scan.caseRoot}/\` は、ユーザーが渡した事件資料です。事実認定、経過整理、証拠確認、質問回答ではこのフォルダを主な根拠にしてください。
- \`instructions/\` は、起案時の書式・構成・定型表現の参照資料です。ここに書かれた内容を事件の事実として扱わないでください。
- 回答では、可能な限り根拠ファイルのパスを示してください。例: \`${scan.caseRoot}/訴状.md\`
- 不明な点、資料から読み取れない点、推測が混じる点は、断定せずに質問または留保してください。
- 事実、推測、法的評価、起案上の提案は分けて説明してください。
${warningLine}

## アーカイブ概要

- 元フォルダ名: \`${caseName}\`
- 事件資料ファイル数: ${scan.caseFiles.length}
- 起案指示書ファイル数: ${instructionEntries.length}
- ZIPに含めなかった非対象ファイル数: ${scan.skippedFiles.length}
- 警告・注意点: ${scan.warnings.length}

`;
}
