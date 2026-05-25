export type InstructionEntry = {
    /** ZIP 内での保存先。AI に渡すときも `instructions/` 配下として見えるようにする。 */
    archivePath: string;
    /** README に表示するためのパス。現在は archivePath と同じ形式で扱う。 */
    displayPath: string;
    /** ZIP へそのまま追加するファイル内容。文字コードを変換しないため Buffer で保持する。 */
    content: Buffer;
    /** `sample.md` は全文書共通ルールとして、README 上で特別に案内する。 */
    isCommonRules: boolean;
};

export type CaseFileEntry = {
    /** 元ディレクトリから見た相対パス。ユーザーの手元の構造を説明するときに使う。 */
    relativePath: string;
    /** ZIP 内での保存先。事件資料はすべて `case/` 配下に入れる。 */
    archivePath: string;
    /** README や目録で見せるパス。現在は archivePath と同じ形式で扱う。 */
    displayPath: string;
    /** ZIP へ追加する本文。文字コード変換はせず、読み取り結果を保持する。 */
    content: Buffer;
    /** 拡張子、サイズ、行数など、AI が資料量を見積もるための基本情報。 */
    extension: string;
    sizeBytes: number;
    characterCount: number;
    lineCount: number;
    /** ファイル名や本文冒頭から推定した資料種別。推定なので断定には使わない。 */
    documentKind: string;
    /** 甲1・乙2など、ファイル名や本文冒頭から拾えた証拠番号。 */
    evidenceNumber: string | null;
    /** ファイル名や本文冒頭から拾えた日付候補。 */
    dateCandidates: string[];
    /** このファイルだけに関する注意点。 */
    warnings: string[];
};

export type SkippedFileEntry = {
    relativePath: string;
    extension: string;
    sizeBytes: number;
    reason: string;
};

export type ArchiveWarning = {
    path: string;
    severity: 'info' | 'warning';
    message: string;
};

export type CaseArchiveScan = {
    caseRoot: string;
    caseFiles: CaseFileEntry[];
    skippedFiles: SkippedFileEntry[];
    warnings: ArchiveWarning[];
};

export type ArchiveWriteResult = {
    zipPath: string;
    dirName: string;
    caseFileCount: number;
    skippedFileCount: number;
    warningCount: number;
};
