import type { InstructionEntry } from './types';
import { compareInstructionNames } from './utils';

/**
 * README に載せる `instructions/` のツリー表示を生成する。
 * いったんオブジェクトの木にしてから描画することで、階層が増えても表示を崩さずに済む。
 */
export function buildInstructionStructure(instructionEntries: InstructionEntry[]) {
    if (instructionEntries.length === 0) {
        return "";
    }

    // 例: { "行政": { "開示請求.md": null }, "sample.md": null } のような木を作る。
    const tree: Record<string, any> = {};
    for (const entry of instructionEntries) {
        const relativePath = entry.displayPath.replace(/^instructions\//, '');
        const parts = relativePath.split('/');
        let currentNode = tree;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLastPart = i === parts.length - 1;

            if (isLastPart) {
                currentNode[part] = null;
            } else {
                currentNode[part] = currentNode[part] || {};
                currentNode = currentNode[part];
            }
        }
    }

    // ディレクトリは 📁、ファイルは 📄 として、AI と人間のどちらにも読みやすい目次にする。
    function renderTree(node: Record<string, any>, indent = "  ") {
        let structure = "";
        const entries = Object.keys(node).sort((a, b) => {
            const aIsDirectory = node[a] !== null;
            const bIsDirectory = node[b] !== null;
            if (aIsDirectory && !bIsDirectory) return -1;
            if (!aIsDirectory && bIsDirectory) return 1;
            return compareInstructionNames(a, b);
        });

        for (const entryName of entries) {
            const childNode = node[entryName];
            if (childNode === null) {
                structure += `${indent}📄 ${entryName}\n`;
            } else {
                structure += `${indent}📁 ${entryName}/\n`;
                structure += renderTree(childNode, indent + "  ");
            }
        }

        return structure;
    }

    return `📁 instructions/\n${renderTree(tree)}`;
}
