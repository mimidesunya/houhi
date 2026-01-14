/**
 * 裁判文書用 Markdown -> HTML 変換スクリプト
 */

/**
 * 文字列の視覚的な幅（em単位）を計算します。
 * 半角文字を0.5em、全角文字を1emとして計算します。
 */
function getVisualWidth(text) {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        // 半角文字（ASCII, 半角カナ）は0.5、それ以外は1
        if ((code >= 0x0020 && code <= 0x007e) || (code >= 0xff61 && code <= 0xff9f)) {
            width += 0.5;
        } else {
            width += 1;
        }
    }
    return width;
}

/**
 * Markdownテキストを裁判文書用のHTMLに変換します。
 */
function convertMarkdownToCourtHtml(markdown) {
    const lines = markdown.split(/\r?\n/);
    let html = '';
    let lastLevel = 0;
    let inTable = false;
    let tableBuffer = [];
    let tableClass = '';
    let inRightBlock = false;
    let inLeftBlock = false;
    let lastHeader = '';
    let inEvidenceTable = false;
    let evidenceTableBuffer = [];

    // インデント用のヘルパー
    const indent = (level) => '    '.repeat(level);
    const nl = '\n';

    // --- 事前スキャン: table.info のグローバルな列幅を計算 ---
    const globalColWidths = [];
    let scanHeader = '';
    let inScanEvidenceTable = false;
    for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
            scanHeader = trimmed.replace(/^#*\s*/, '').trim();
        }
        const tableMatch = trimmed.match(/^\|(.*)\|$/);
        const listTableMatch = trimmed.match(/^- (.*?)[：:](.*)$/);
        if (tableMatch || listTableMatch) {
            // 証拠説明書テーブルの開始を検出
            if (tableMatch && tableMatch[1].includes('号証') && tableMatch[1].includes('標目')) {
                inScanEvidenceTable = true;
            }
            // 附属書類テーブルと証拠説明書テーブルは除外
            if (scanHeader !== '附属書類' && !inScanEvidenceTable) {
                // セパレーター行（|:---|:---|...）は除外
                if (tableMatch && /^[\s|:-]+$/.test(tableMatch[1])) {
                    continue;
                }
                let cells;
                if (tableMatch) {
                    cells = tableMatch[1].split('|');
                } else {
                    cells = [listTableMatch[1], listTableMatch[2]];
                }
                cells.forEach((cell, i) => {
                    const w = getVisualWidth(cell.trim());
                    if (!globalColWidths[i] || w > globalColWidths[i]) globalColWidths[i] = w;
                });
            }
        } else if (inScanEvidenceTable) {
            // テーブル行以外が来たら証拠説明書テーブル終了
            inScanEvidenceTable = false;
        }
    }
    // table.info の合計幅（署名欄の幅に使用）
    // 各列の最小幅を 4em とし、第1列の padding-right: 1.5em を考慮する
    const col0Width = Math.max(globalColWidths[0] || 0, 4);
    const col1Width = Math.max(globalColWidths[1] || 0, 4);
    const totalInfoWidth = (col0Width + 1.5) + col1Width;

    // テーブルをフラッシュしてHTMLを生成する内部関数
    const flushTable = () => {
        if (tableBuffer.length === 0) return '';
        let tableHtml = '';
        
        tableHtml += indent(lastLevel) + `<table class="${tableClass}">` + nl;
        tableBuffer.forEach(row => {
            tableHtml += indent(lastLevel + 1) + '<tr>' + nl;
            row.forEach((cell, i) => {
                const text = cell.trim();
                const isAmount = i > 0 && /^[0-9０-９,，．.]+円?$/.test(text);
                const classes = [];
                if (tableClass === 'info') classes.push(`col-${i + 1}`);
                if (isAmount) classes.push('val');
                const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
                tableHtml += indent(lastLevel + 2) + `<td${classAttr}>${text}</td>` + nl;
            });
            tableHtml += indent(lastLevel + 1) + '</tr>' + nl;
        });
        tableHtml += indent(lastLevel) + '</table>' + nl;
        tableBuffer = [];
        return tableHtml;
    };

    // 証拠説明書テーブルをフラッシュしてHTMLを生成する内部関数
    const flushEvidenceTable = () => {
        if (evidenceTableBuffer.length === 0) return '';
        let tableHtml = '';
        
        // ヘッダー行とセパレーター行をスキップ
        const headerRow = evidenceTableBuffer[0];
        const dataRows = evidenceTableBuffer.slice(2); // ヘッダーとセパレーターをスキップ
        
        tableHtml += indent(lastLevel) + '<table class="evidence">' + nl;
        
        // ヘッダー行を生成
        tableHtml += indent(lastLevel + 1) + '<thead>' + nl;
        tableHtml += indent(lastLevel + 2) + '<tr>' + nl;
        headerRow.forEach((cell, i) => {
            const text = cell.trim();
            tableHtml += indent(lastLevel + 3) + `<th class="col-${i + 1}">${text}</th>` + nl;
        });
        tableHtml += indent(lastLevel + 2) + '</tr>' + nl;
        tableHtml += indent(lastLevel + 1) + '</thead>' + nl;
        
        // データ行を生成
        tableHtml += indent(lastLevel + 1) + '<tbody>' + nl;
        
        // 各列で結合が必要な行を追跡
        const rowspanMap = new Map(); // key: colIndex, value: { rowIndex, span, text }
        
        dataRows.forEach((row, rowIndex) => {
            tableHtml += indent(lastLevel + 2) + '<tr>' + nl;
            
            row.forEach((cell, colIndex) => {
                const text = cell.trim();
                
                // この列が既に結合中かチェック
                if (rowspanMap.has(colIndex)) {
                    const info = rowspanMap.get(colIndex);
                    if (rowIndex < info.rowIndex + info.span) {
                        // まだ結合中なのでセルをスキップ
                        return;
                    }
                }
                
                // 空のセルの場合、上のセルと結合
                if (text === '') {
                    // 上方向に遡って最初の非空セルを探す
                    let spanCount = 1;
                    let lookupRow = rowIndex - 1;
                    let mergedText = '';
                    
                    while (lookupRow >= 0) {
                        const prevText = dataRows[lookupRow][colIndex].trim();
                        if (prevText !== '') {
                            mergedText = prevText;
                            // 既存のrowspanを更新
                            if (rowspanMap.has(colIndex)) {
                                const existingInfo = rowspanMap.get(colIndex);
                                if (lookupRow >= existingInfo.rowIndex && lookupRow < existingInfo.rowIndex + existingInfo.span) {
                                    // 既存の結合を拡張
                                    existingInfo.span++;
                                    return;
                                }
                            }
                            
                            // 新しいrowspanの開始位置まで遡る
                            let startRow = lookupRow;
                            while (startRow > 0 && dataRows[startRow - 1][colIndex].trim() === '') {
                                startRow--;
                                spanCount++;
                            }
                            
                            // この空セルまでのスパンをカウント
                            spanCount = rowIndex - startRow + 1;
                            
                            // 既存のマッピングを更新
                            if (rowspanMap.has(colIndex)) {
                                const info = rowspanMap.get(colIndex);
                                if (info.rowIndex === startRow) {
                                    info.span = spanCount + 1;
                                }
                            }
                            break;
                        }
                        lookupRow--;
                        spanCount++;
                    }
                    return; // 空のセルは出力しない
                }
                
                // 下方向に空のセルがいくつ続くかカウント
                let rowspan = 1;
                for (let nextRow = rowIndex + 1; nextRow < dataRows.length; nextRow++) {
                    if (dataRows[nextRow][colIndex].trim() === '') {
                        rowspan++;
                    } else {
                        break;
                    }
                }
                
                if (rowspan > 1) {
                    rowspanMap.set(colIndex, { rowIndex, span: rowspan, text });
                }
                
                const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : '';
                tableHtml += indent(lastLevel + 3) + `<td class="col-${colIndex + 1}"${rowspanAttr}>${text}</td>` + nl;
            });
            
            tableHtml += indent(lastLevel + 2) + '</tr>' + nl;
        });
        
        tableHtml += indent(lastLevel + 1) + '</tbody>' + nl;
        tableHtml += indent(lastLevel) + '</table>' + nl;
        evidenceTableBuffer = [];
        return tableHtml;
    };

    const markers = [
        { level: 1, regex: /^#*\s*(第[0-9]+)[　\s]/ },
        { level: 2, regex: /^#*\s*([0-9]+)[　\s]/ },
        { level: 3, regex: /^#*\s*(\([0-9]+\))[　\s]/ },
        { level: 4, regex: /^#*\s*([ア-ン])[　\s]/ },
        { level: 5, regex: /^#*\s*(\([ア-ン]\))[　\s]/ },
        { level: 6, regex: /^#*\s*([a-z])[　\s]/ },
        { level: 7, regex: /^#*\s*(\([a-z]\))[　\s]/ }
    ];

    function getLevelInfo(line) {
        for (const m of markers) {
            const match = line.match(m.regex);
            if (match) {
                return { level: m.level, marker: match[1] };
            }
        }
        return null;
    }

    for (let line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        // 右寄せ・左寄せブロックの開始・終了
        if (trimmedLine === '### --右') {
            if (inTable) { html += flushTable(); inTable = false; }
            while (lastLevel > 0) { 
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl; 
                lastLevel--; 
            }
            html += '<div class="right">' + nl;
            inRightBlock = true;
            continue;
        }
        if (trimmedLine === '### --左') {
            if (inTable) { html += flushTable(); inTable = false; }
            while (lastLevel > 0) { 
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl; 
                lastLevel--; 
            }
            html += '<div class="left">' + nl;
            inLeftBlock = true;
            continue;
        }
        if (trimmedLine === '### --') {
            if (inRightBlock || inLeftBlock) {
                if (inTable) { html += flushTable(); inTable = false; }
                while (lastLevel > 0) { 
                    html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl; 
                    lastLevel--; 
                }
                html += '</div>' + nl;
                inRightBlock = false;
                inLeftBlock = false;
                continue;
            }
        }

        // テーブル行の処理: |書類名|通数| または - 書類名：通数
        const tableMatch = trimmedLine.match(/^\|(.*)\|$/);
        const listTableMatch = trimmedLine.match(/^- (.*?)[：:](.*)$/);

        if (tableMatch || listTableMatch) {
            // セパレーター行（|:---|:---|...）をチェック
            const isSeparator = tableMatch && /^[\s|:-]+$/.test(tableMatch[1]);
            
            // ヘッダー行（「号証」「標目」などを含む）をチェック
            const isEvidenceHeader = tableMatch && tableMatch[1].includes('号証') && 
                                      tableMatch[1].includes('標目');
            
            if (isEvidenceHeader || (inEvidenceTable && tableMatch)) {
                // 証拠説明書テーブル
                if (!inEvidenceTable) {
                    while (lastLevel > 0) {
                        html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                        lastLevel--;
                    }
                    inEvidenceTable = true;
                }
                
                if (tableMatch) {
                    const cells = tableMatch[1].split('|');
                    evidenceTableBuffer.push(cells);
                }
                
                continue;
            } else if (!inTable) {
                // 通常のテーブル（info/att）
                while (lastLevel > 0) {
                    html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                    lastLevel--;
                }
                // 直前のヘッダが「附属書類」なら att クラス、そうでなければ info クラス
                tableClass = (lastHeader === '附属書類') ? 'att' : 'info';
                inTable = true;
            }

            let cells;
            if (tableMatch) {
                cells = tableMatch[1].split('|');
            } else {
                cells = [listTableMatch[1], listTableMatch[2]];
            }
            tableBuffer.push(cells);
            continue;
        } else if (inTable) {
            html += flushTable();
            inTable = false;
        } else if (inEvidenceTable) {
            html += flushEvidenceTable();
            inEvidenceTable = false;
        }

        // 改ページマーカーの処理: ### -- 任意のテキスト --
        if (/^### --.*--$/.test(trimmedLine)) {
            // リストを閉じて改ページを挿入
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            html += '<div class="break"></div>' + nl;
            continue;
        }

        const levelInfo = getLevelInfo(trimmedLine);
        const isHeader = trimmedLine.startsWith('#');
        
        let level, text;
        if (levelInfo) {
            level = levelInfo.level;
            // マーカーと#を除去
            text = trimmedLine.replace(/^#*\s*/, '').replace(levelInfo.marker, '').trim();
        } else {
            // マーカーがない場合は現在のレベルの継続（最初からマーカーがない場合はレベル0）
            level = lastLevel;
            text = trimmedLine.replace(/^#+\s*/, '').trim();
        }

        // 階層の調整
        let openedNewLevel = false;
        while (lastLevel < level) {
            if (lastLevel === 0) {
                lastLevel = level;
            } else {
                lastLevel++;
            }
            html += indent(lastLevel - 1) + `<ol class="lvl${lastLevel}">` + nl + indent(lastLevel) + '<li>' + nl;
            openedNewLevel = true;
        }
        while (lastLevel > level) {
            html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
            lastLevel--;
        }
        if (lastLevel === level && levelInfo && !openedNewLevel) {
            // 新しいマーカーがある場合は次の li へ
            html += indent(lastLevel) + '</li>' + nl + indent(lastLevel) + '<li>' + nl;
        }

        const currentIndent = indent(lastLevel + (lastLevel > 0 ? 1 : 0));

        if (isHeader) {
            lastHeader = text; // ヘッダテキストを保存
            if (levelInfo) {
                html += currentIndent + `<h2>${text}</h2>` + nl;
            } else {
                // マーカーがないヘッダは h1 とし、リストの外に出す
                while (lastLevel > 0) {
                    html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                    lastLevel--;
                }
                html += `<h1>${text}</h1>` + nl;
            }
        } else if (text === '以上') {
            // 「以上」のみの行は特別扱い（リストを閉じて右寄せ）
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            html += `<div class="end-mark">${text}</div>` + nl;
        } else if (/^(?:(?:令和|平成|昭和|大正|明治)\s*(?:[0-9０-９]{1,2}|[元〇○一二三四五六七八九十]{1,3})|[0-9０-９]{1,4})\s*年\s*(?:[0-9０-９]{1,2}|[〇○一二三四五六七八九十]{1,3})\s*月\s*(?:[0-9０-９]{1,2}|[元〇○一二三四五六七八九十]{1,3})\s*日$/.test(text)) {
            // 日付の識別 (和暦・西暦、数字・漢数字、元年などに対応)
            html += currentIndent + `<div class="date">${text}</div>` + nl;
        } else if (/.*[　\s](?:御中|様)$/.test(text)) {
            // 宛先の識別
            html += currentIndent + `<div class="dest">${text}</div>` + nl;
        } else {
            let style = '';
            if (inRightBlock) {
                // 署名欄の幅は table.info の合計幅に合わせる。
                // ただし table.info がない場合や、テキストの方が長い場合はそちらに合わせる。
                const textW = getVisualWidth(text);
                const w = Math.max(textW, totalInfoWidth);
                if (w > 0) {
                    style = ` style="width: ${w}em"`;
                }
            }
            html += currentIndent + `<p${style}>${text}</p>` + nl;
        }
        lastLevel = level;
    }

    // 残ったタグを閉じる
    if (inTable) {
        html += flushTable();
    }
    if (inEvidenceTable) {
        html += flushEvidenceTable();
    }
    while (lastLevel > 0) {
        html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
        lastLevel--;
    }

    // table.info の列幅スタイルを生成
    let styleTag = '';
    if (globalColWidths.length > 0) {
        styleTag = '<style>' + nl;
        globalColWidths.forEach((w, i) => {
            if (w) {
                styleTag += `table.info td.col-${i + 1} { width: ${w}em; }` + nl;
            }
        });
        styleTag += '</style>' + nl;
    }

    return styleTag + html;
}

/**
 * ページ内のすべての <pre> タグを裁判文書形式に変換します。
 */
async function renderMarkdown() {
    const preElements = document.querySelectorAll('pre');
    for (const pre of preElements) {
        let markdown = pre.textContent;
        const src = pre.getAttribute('data-src');
        
        if (src) {
            try {
                const response = await fetch(src);
                if (response.ok) {
                    markdown = await response.text();
                } else {
                    console.error(`Failed to load markdown from ${src}: ${response.status}`);
                }
            } catch (e) {
                console.error(`Error fetching markdown from ${src}:`, e);
            }
        }

        if (!markdown.trim()) continue;

        const html = convertMarkdownToCourtHtml(markdown);
        
        // pre要素を変換後のHTMLで置き換える
        const container = document.createElement('div');
        container.className = (pre.className ? pre.className + ' ' : '') + 'content-container';
        container.innerHTML = html;
        pre.parentNode.replaceChild(container, pre);
    }
}

// Node.js環境用のエクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { convertMarkdownToCourtHtml };
} else {
    // ブラウザ環境では自動実行
    document.addEventListener('DOMContentLoaded', renderMarkdown);
}
