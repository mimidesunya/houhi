declare module 'adm-zip';
declare module 'pdfjs-dist/legacy/build/pdf.js';
declare module 'canvas';

declare global {
    type ScriptKey =
        | 'pdf'
        | 'ai_archive'
        | 'stamp'
        | 'fax_send'
        | 'transcribe_audio'
        | 'address_label';

    interface ScriptExecutionResult {
        success: boolean;
        output?: string;
        error?: string;
        code?: number;
    }

    interface ConfigEditorLoadResult {
        configPath: string;
        exists: boolean;
        created: boolean;
        createdFromTemplate: boolean;
        templatePath: string | null;
        config: Record<string, any>;
        defaults: Record<string, any>;
        parseError: string | null;
    }

    interface ConfigEditorSaveResult {
        configPath: string;
        config: Record<string, any>;
    }

    interface DraftingKitOpenResult {
        exists: boolean;
        zipPath: string;
        folderPath: string;
        fileName: string;
        openError: string | null;
    }

    interface ConsoleTaskInfo {
        taskName: string;
        fileCount: number;
        files: string[];
    }

    interface ElectronAPI {
        executeScript(
            scriptKey: ScriptKey,
            filePaths: string[],
            options?: string[]
        ): Promise<ScriptExecutionResult>;
        openConfigSettings(): Promise<boolean>;
        openDraftingKitFolder(): Promise<DraftingKitOpenResult>;
        getConfigForEditor(): Promise<ConfigEditorLoadResult>;
        saveConfigFromEditor(config: Record<string, any>): Promise<ConfigEditorSaveResult>;
        onLog(callback: (value: string) => void): void;
        onError(callback: (value: string) => void): void;
        getPathForFile(file: File): string;
    }

    interface ConsoleAPI {
        onLog(callback: (value: string) => void): void;
        onInfo(callback: (value: string) => void): void;
        onSuccess(callback: (value: string) => void): void;
        onError(callback: (value: string) => void): void;
        onWarning(callback: (value: string) => void): void;
        onCommand(callback: (value: string) => void): void;
        onComplete(callback: (success: boolean) => void): void;
        onTaskInfo(callback: (info: ConsoleTaskInfo) => void): void;
    }

    interface Window {
        electronAPI: ElectronAPI;
        consoleAPI: ConsoleAPI;
    }
}

declare module 'copper-cti' {
    export function get_session(...args: any[]): any;
}

export {};
