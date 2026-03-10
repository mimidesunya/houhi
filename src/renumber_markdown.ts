/**
 * 裁判文書向けMarkdownの項番を階層ごとに振り直すツール。
 * 文書中の既存番号を無視して、出現順に連番を再構成します。
 *
 * 対象階層:
 *   第1 / 1 / (1) / ア / (ア) / a / (a)
 *
 * 入力:
 * - Markdown ファイル 1 件
 *
 * 出力:
 * - 出力パス未指定時は `<元ファイル名>_renumbered<拡張子>` を作成します。
 * - 出力パス指定時はその場所へ保存します。
 *
 * 補足:
 * - `## 第1` のような見出し行も対象にします。
 * - Windows / macOS では、変換後テキストのクリップボードコピーを試みます。
 *
 * 使い方:
 *   node src/renumber_markdown.js <入力ファイル> [出力ファイル]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KATAKANA = [
    'ア', 'イ', 'ウ', 'エ', 'オ',
    'カ', 'キ', 'ク', 'ケ', 'コ',
    'サ', 'シ', 'ス', 'セ', 'ソ',
    'タ', 'チ', 'ツ', 'テ', 'ト',
    'ナ', 'ニ', 'ヌ', 'ネ', 'ノ',
    'ハ', 'ヒ', 'フ', 'ヘ', 'ホ',
    'マ', 'ミ', 'ム', 'メ', 'モ',
    'ヤ', 'ユ', 'ヨ',
    'ラ', 'リ', 'ル', 'レ', 'ロ',
    'ワ', 'ヲ', 'ン'
];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

function getKatakana(n) {
    if (n < 1) return "?";
    const idx = (n - 1) % KATAKANA.length;
    return KATAKANA[idx];
}

function getAlphabet(n) {
    if (n < 1) return "?";
    const idx = (n - 1) % ALPHABET.length;
    return ALPHABET[idx];
}

// Defined patterns for headers
// Each object: { level: number, str: string }
const MARKER_DEFS = [
    { level: 1, str: '第[0-9]+' },
    { level: 2, str: '[0-9]+' },
    { level: 3, str: '\\([0-9]+\\)' },
    { level: 4, str: '[ア-ン]' },
    { level: 5, str: '\\([ア-ン]\\)' },
    { level: 6, str: '[a-z]' },
    { level: 7, str: '\\([a-z]\\)' },
];

// Compile Regexes
const REGEX_LIST = MARKER_DEFS.map(def => {
    // JS Regex: ^(##(?!#)\s*)?(MARKER)([\s\u3000].*)?$
    // Group 1: Optional "## " prefix (heading line) — absent for plain paragraph lines
    // Group 2: Marker (第1, 1, (1), ア, etc.)
    // Group 3: Suffix (rest of line after marker)
    // (?!#) ensures we don't match ### (negative lookahead)
    const patternStr = `^(##(?!#)\\s*)?(${def.str})([\\s\\u3000].*)?$`;
    return {
        level: def.level,
        re: new RegExp(patternStr)
    };
});

function renumberLines(lines) {
    const counters = new Array(8).fill(0);
    const outputLines = [];

    for (let line of lines) {
        let matchedLevel = -1;
        let matchResult = null;

        for (const item of REGEX_LIST) {
            const m = item.re.exec(line);
            if (m) {
                matchedLevel = item.level;
                matchResult = m;
                break;
            }
        }

        if (matchedLevel !== -1) {
            // Update counters
            counters[matchedLevel]++;
            for (let i = matchedLevel + 1; i < 8; i++) {
                counters[i] = 0;
            }

            const currentNum = counters[matchedLevel];
            let newMarker = "";

            switch (matchedLevel) {
                case 1: newMarker = `第${currentNum}`; break;
                case 2: newMarker = `${currentNum}`; break;
                case 3: newMarker = `(${currentNum})`; break;
                case 4: newMarker = getKatakana(currentNum); break;
                case 5: newMarker = `(${getKatakana(currentNum)})`; break;
                case 6: newMarker = getAlphabet(currentNum); break;
                case 7: newMarker = `(${getAlphabet(currentNum)})`; break;
            }

            const prefix = matchResult[1] || "";
            const suffix = matchResult[3] || "";
            
            outputLines.push(`${prefix}${newMarker}${suffix}`);
        } else {
            outputLines.push(line);
        }
    }

    return outputLines;
}

function main() {
    if (process.argv.length < 3) {
        console.log("Usage: node renumber_markdown.js <input_file> [output_file]");
        process.exit(1);
    }

    const inputPath = process.argv[2];
    let outputPath;

    if (process.argv.length >= 4) {
        outputPath = process.argv[3];
    } else {
        const parsed = path.parse(inputPath);
        outputPath = path.join(parsed.dir, `${parsed.name}_renumbered${parsed.ext}`);
    }

    try {
        const content = fs.readFileSync(inputPath, 'utf8');
        // split by regex to handle \r\n, \n, \r
        const lines = content.split(/\r?\n/);
        const renumbered = renumberLines(lines);
        const outputContent = renumbered.join('\n');
        
        fs.writeFileSync(outputPath, outputContent, 'utf8');
        console.log(`リナンバー完了: ${outputPath}`);
        
        // クリップボードにコピー
        try {
            if (process.platform === 'win32') {
                // 保存したファイルを直接PowerShellで読み込んでクリップボードにコピー
                const result = spawnSync('powershell.exe', [
                    '-NoProfile',
                    '-Command',
                    `Get-Content -Path "${outputPath}" -Encoding UTF8 -Raw | Set-Clipboard`
                ], {
                    encoding: 'utf8'
                });
                
                if (result.status === 0) {
                    console.log('クリップボードにコピー成功');
                } else {
                    console.error(`警告: クリップボードへのコピーに失敗しました (終了コード: ${result.status})`);
                }
            } else if (process.platform === 'darwin') {
                const result = spawnSync('pbcopy', [], {
                    input: Buffer.from(outputContent, 'utf8')
                });
                
                if (result.status === 0) {
                    console.log('クリップボードにコピー成功');
                } else {
                    console.error(`警告: クリップボードへのコピーに失敗しました (終了コード: ${result.status})`);
                }
            } else {
                console.log('クリップボードのコピーはWindowsとmacOSのみ対応しています');
            }
        } catch (clipError) {
            console.error(`警告: クリップボードへのコピーに失敗しました: ${clipError.message}`);
        }
    } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    getKatakana,
    getAlphabet,
    renumberLines,
    main
};
