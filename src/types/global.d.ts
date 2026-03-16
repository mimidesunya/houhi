declare module 'adm-zip';
declare module 'pdfjs-dist/legacy/build/pdf.js';
declare module 'canvas';

declare global {
    type ScriptKey =
        | 'pdf'
        | 'renumber'
        | 'ai_archive'
        | 'stamp'
        | 'fax_send';

    interface ScriptExecutionResult {
        success: boolean;
        output?: string;
        error?: string;
        code?: number;
    }

    interface ConsoleTaskInfo {
        taskName: string;
        fileCount: number;
        files: string[];
    }

    interface ElectronAPI {
        executeScript(
            scriptKey: ScriptKey,
            filePaths: string[]
        ): Promise<ScriptExecutionResult>;
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
