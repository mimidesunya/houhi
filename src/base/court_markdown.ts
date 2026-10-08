/**
 * 裁判文書用 Markdown -> HTML 変換スクリプト
 */

/**
 * 文字列の視覚的な幅（em単位）を計算します。
 * 半角文字を0.5em、全角文字を1emとして計算します。
 */
function getVisualWidth(text) {
    let maxWidth = 0;
    let lineWidth = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === 0x000a) {
            maxWidth = Math.max(maxWidth, lineWidth);
            lineWidth = 0;
            continue;
        }
        // 半角文字（ASCII, 半角カナ）は0.5、それ以外は1
        if ((code >= 0x0020 && code <= 0x007e) || (code >= 0xff61 && code <= 0xff9f)) {
            lineWidth += 0.5;
        } else {
            lineWidth += 1.0;
        }
    }
    return Math.max(maxWidth, lineWidth);
}

/**
 * 証拠説明書の作成年月日を、折り返してよい位置（「年」の後ろ）で塊に分けます。
 * 「令和8年3月31日」は「令和8年」「3月31日」になり、各塊は折り返さずに組みます。
 */
function dateChunks(text) {
    return String(text).split(/(?<=年)/).filter(chunk => chunk !== '');
}

/**
 * 証拠説明書の見出しを、折り返してよい位置で塊に分けます。
 * 「乙A号証」は「乙A」「号証」、「作成年月日」は「作成」「年月日」になり、
 * 狭い列でも「乙A号／証」のような割れ方をしない。
 */
function evidenceHeaderChunks(text) {
    return String(text).split(/(?=号証)|(?=年月日)/).filter(chunk => chunk !== '');
}

function escapeHtmlAttribute(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function stripInlineMarkdown(value) {
    const escapedPlus = '\uE000';
    return String(value)
        .replace(/\\\+\+/g, escapedPlus)
        .replace(/(?<!\\)｜([^《\r\n]+?)《([^》\r\n]+?)》/g, '$1')
        .replace(/\+\+(.+?)\+\+/g, '$1')
        .replace(new RegExp(escapedPlus, 'g'), '++')
        .replace(/\\([｜《》])/g, '$1')
        .replace(/<br\s*\/?>/gi, '\n');
}

function renderInlineMarkdown(value) {
    const escapedPlus = '\uE000';
    return escapeHtml(value)
        .replace(/\\\+\+/g, escapedPlus)
        .replace(/(?<!\\)｜([^《\r\n]+?)《([^》\r\n]+?)》/g, (_match, baseText, rubyText) => `<ruby>${baseText}<rt>${rubyText}</rt></ruby>`)
        .replace(/\+\+(.+?)\+\+/g, (_match, text) => `<span class="underline">${text}</span>`)
        .replace(new RegExp(escapedPlus, 'g'), '++')
        .replace(/\\([｜《》])/g, '$1')
        .replace(/&lt;br\s*\/?&gt;/gi, '<br>');
}

function stripHtmlComments(value) {
    return String(value || '').replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Markdownテキストを裁判文書用のHTMLに変換します。
 */
export function convertMarkdownToCourtHtml(markdown) {
    const lines = stripHtmlComments(markdown).split(/\r?\n/);
    let html = '';
    let lastLevel = 0;
    let inTable = false;
    let tableBuffer = [];
    let tableClass = '';
    let tableHasHeader = false;
    let inRightBlock = false;
    let inLeftBlock = false;
    let inLandscapeBlock = false;
    let lastHeader = '';
    let inEvidenceTable = false;
    let evidenceTableBuffer = [];
    let inSimpleList = false;

    // インデント用のヘルパー
    const indent = (level) => '    '.repeat(level);
    const nl = '\n';
    const tocElement = '<cssj:make-toc xmlns:cssj="http://www.cssj.jp/ns/cssjml" counter="page" type="decimal"></cssj:make-toc>';
    const headingTag = (level) => `h${Math.min(Math.max(level, 1), 6)}`;

    // --- 事前スキャン: 各エリアのグローバルな列幅を計算 ---
    const rightColWidths = [];
    const leftColWidths = [];
    const attColWidths = [];

    // 附属書類の体裁（連番＋「1通」の右揃え）で組む見出し。
    // 書面の種類によって「添付書類」「添付資料」とも書かれるため、いずれも同じ扱いにする。
    const ATTACHMENT_HEADERS = ['附属書類', '証拠書類', '添付書類', '添付資料'];
    const isAttachmentHeader = (header) => ATTACHMENT_HEADERS.includes((header || '').trim());
    const defaultColWidths = [];

    let scanHeader = '';
    let inScanEvidenceTable = false;
    let isSoufusho = false;
    let scanInRight = false;
    let scanInLeft = false;

    // 区切り行（|:---|...）を持つ見出し付きのパイプ表の行。これらは表ごとに列幅を決めるので、
    // 文書全体で共有する info 表の列幅（defaultColWidths 等）の計算に入れない。
    const headerTableLines = new Set();
    {
        let run = [];
        const flushRun = () => {
            if (run.some(idx => /^\|[\s|:-]+\|$/.test(lines[idx].trim()))) run.forEach(idx => headerTableLines.add(idx));
            run = [];
        };
        lines.forEach((l, idx) => {
            if (/^\|(.*)\|$/.test(l.trim())) run.push(idx); else flushRun();
        });
        flushRun();
    }

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const trimmed = line.trim();
        
        // ブロック検出
        if (trimmed === '### --右') { scanInRight = true; scanInLeft = false; continue; }
        if (trimmed === '### --左') { scanInLeft = true; scanInRight = false; continue; }
        if (trimmed === '### --横' || trimmed === '### --縦') { continue; }
        if (trimmed === '### --') { scanInRight = false; scanInLeft = false; continue; }

        if (trimmed.startsWith('#')) {
            // 改ページマーカー等はヘッダーとして扱わない
            if (/^### --.*--$/.test(trimmed) || trimmed === '### ---' || trimmed === '### -') continue;

            scanHeader = trimmed.replace(/^#*\s*/, '').trim();
            if (scanHeader === '送付書') {
                isSoufusho = true;
            }
        }
        
        const tableMatch = trimmed.match(/^\|(.*)\|$/);
        if (tableMatch && headerTableLines.has(lineIdx)) continue;
        let listTableMatch = trimmed.match(/^[-*] (.*?)[：:](.*)$/);
        if (isProseColonLine(listTableMatch, 1)) listTableMatch = null;
        // 当事者欄の連絡先は表に入れないので、列幅の計算からも外す
        if (listTableMatch && (scanInRight || scanInLeft) && isContactLabel(listTableMatch[1])) continue;
        let numberedListTableMatch = trimmed.match(/^([0-9０-９]+)[　\s]+(.+?)[：:](.*)$/);
        if (isProseColonLine(numberedListTableMatch, 2)) numberedListTableMatch = null;
        
        if (tableMatch || listTableMatch || numberedListTableMatch) {
            // 証拠説明書テーブルの開始を検出
            // 「号証」に加えて「標目」又は「立証趣旨」を含むヘッダー行だけを
            // 証拠説明書テーブルとして扱う。「甲号証」等の列を持つだけの一般表を
            // 証拠説明書と誤認すると、専用の固定列幅が適用されて崩れるため。
            if (tableMatch && tableMatch[1].includes('号証')
                && (tableMatch[1].includes('標目') || tableMatch[1].includes('立証趣旨'))) {
                inScanEvidenceTable = true;
            }
            
            // 証拠説明書テーブルは除外（別扱い）
            if (!inScanEvidenceTable) {
                // セパレーター行（|:---|:---|...）は除外
                if (tableMatch && /^[\s|:-]+$/.test(tableMatch[1])) {
                    continue;
                }
                
                let cells;
                if (tableMatch) {
                    cells = tableMatch[1].split('|');
                } else if (numberedListTableMatch) {
                    cells = [numberedListTableMatch[2], numberedListTableMatch[3]];
                } else {
                    cells = [listTableMatch[1], listTableMatch[2]];
                }
                
                // どの幅配列を使うか決定
                let targetWidths = defaultColWidths;
                if (numberedListTableMatch || isAttachmentHeader(scanHeader)) {
                    targetWidths = attColWidths;
                } else if (scanInRight) {
                    targetWidths = rightColWidths;
                } else if (scanInLeft) {
                    targetWidths = leftColWidths;
                }

                cells.forEach((cell, i) => {
                    const w = getVisualWidth(stripInlineMarkdown(cell.trim()));
                    if (!targetWidths[i] || w > targetWidths[i]) targetWidths[i] = w;
                });
            }
        } else if (inScanEvidenceTable) {
            // テーブル行以外が来たら証拠説明書テーブル終了
            inScanEvidenceTable = false;
        }
    }

    // テーブルをフラッシュしてHTMLを生成する内部関数
    const flushTable = () => {
        if (tableBuffer.length === 0) return '';
        let tableHtml = '';

        // ヘッダー付きの一般パイプ表は、列内容の実測幅から配分した固定レイアウトにする。
        // 自動レイアウトに任せると、Copper PDF が列をほぼ均等に割って長い列が細くなるため。
        // 以前は表の開始時に付く info クラスのせいでこの分岐に入らず、文書全体で共有する
        // info 表の列幅（em 固定）と均等割付・1列目の折り返し禁止まで掛かって崩れていた。
        // 見出し付きの表は info / 当事者欄の扱いから外し、has-header の表として組む。
        const isGeneralHeaderTable = tableHasHeader && !tableClass.includes('att');
        if (isGeneralHeaderTable) tableClass = '';
        const useFixedLayout = isGeneralHeaderTable;
        let colgroupHtml = '';
        if (useFixedLayout) {
            // 全角=1em、半角=0.5em で測る。Copper PDF は和文と欧文の間に四分アキ（0.25em）を入れ、
            // 半角の英大文字は 0.5em より広いので、その分を足す（証拠説明書の表の nowrapWidth と同じ考え方）。
            // <br> は改行として扱い、最も長い行の幅を列の最大幅とする
            const typesetWidth = (text) => {
                let w = getVisualWidth(text);
                for (let k = 0; k < text.length; k++) {
                    const half = /[\x20-\x7e]/.test(text[k]);
                    if (/[A-Z]/.test(text[k])) w += 0.2;
                    if (k > 0 && half !== /[\x20-\x7e]/.test(text[k - 1])) w += 0.25;
                }
                return w;
            };
            const lineWidth = (cell) => Math.max(0, ...stripInlineMarkdown(String(cell || '').trim().replace(/<br\s*\/?>/gi, '\n')).split('\n').map(typesetWidth));
            const flatWidth = (cell) => getVisualWidth(stripInlineMarkdown(String(cell || '').trim().replace(/<br\s*\/?>/gi, '')));
            const nCols = Math.max(...tableBuffer.map(r => r.length));
            const colMax = Array(nCols).fill(0);
            const colArea = Array(nCols).fill(0);
            tableBuffer.forEach((row, r) => row.forEach((cell, i) => {
                const w = lineWidth(cell);
                if (w > colMax[i]) colMax[i] = w;
                if (r > 0) colArea[i] += flatWidth(cell);
            }));
            // 本文幅（12pt）: A4縦 160mm＝37.8em、A4横（### --横）252mm＝59.5em
            const bodyEm = inLandscapeBlock ? 59.5 : 37.8;
            const PAD = 1.0;      // セルの左右の余白（0.5em ずつ）
            const SHORT_EM = 8;   // これ以下の列は折り返さずに収まる幅を与える
            const FLEX_MIN = 6;   // 長い列に残す最小の幅
            const SLACK = 0.3;    // 短い列の測り誤差の余裕（これがないと「100万円」が「100万／円」と折り返す）
            const fixed = colMax.map(w => (w <= SHORT_EM ? Math.max(w, 2) + PAD + SLACK : 0));
            const flexIdx = [];
            fixed.forEach((w, i) => { if (!w) flexIdx.push(i); });
            const fixedTotal = fixed.reduce((a, b) => a + b, 0);
            const remain = bodyEm - fixedTotal;
            let widths;
            if (flexIdx.length === 0 || remain < flexIdx.length * FLEX_MIN) {
                // 収まらないときは、各列の最大幅に比例して配分する
                widths = colMax.map(w => Math.max(w, 3) + PAD);
            } else {
                // 長い列は残りの幅を中身の量（全行の文字幅の和）に比例して分ける——行の高さがそろう配分。
                // 下限 FLEX_MIN、上限は列の最大幅＋余白（それ以上与えても空白になるだけ）
                widths = fixed.slice();
                const pinned = new Set<number>();
                for (let pass = 0; pass <= nCols; pass++) {
                    const free = remain - [...pinned].reduce((a, i) => a + widths[i], 0);
                    const pool = flexIdx.filter(i => !pinned.has(i));
                    if (pool.length === 0) break;
                    const areaTotal = pool.reduce((a, i) => a + Math.max(colArea[i], 1), 0);
                    let changed = false;
                    pool.forEach(i => {
                        const share = free * Math.max(colArea[i], 1) / areaTotal;
                        const cap = colMax[i] + PAD;
                        if (share < FLEX_MIN) { widths[i] = FLEX_MIN; pinned.add(i); changed = true; }
                        else if (share > cap) { widths[i] = cap; pinned.add(i); changed = true; }
                        else widths[i] = share;
                    });
                    if (!changed) break;
                }
            }
            const total = widths.reduce((a, b) => a + b, 0);
            if (total > 0) {
                colgroupHtml = indent(lastLevel + 1) + '<colgroup>'
                    + widths.map(w => `<col style="width:${(100 * w / total).toFixed(1)}%">`).join('')
                    + '</colgroup>' + nl;
            }
        }

        const effectiveClass = (tableHasHeader ? tableClass + ' has-header' : tableClass)
            + (useFixedLayout && colgroupHtml ? ' fixed' : '');
        tableHtml += indent(lastLevel) + `<table class="${effectiveClass.trim()}">` + nl;
        tableHtml += colgroupHtml;

        const renderRow = (row, tag) => {
            let rowHtml = indent(lastLevel + 2) + '<tr>' + nl;
            row.forEach((cell, i) => {
                const text = cell.trim();
                const displayText = stripInlineMarkdown(text);
                const isAmount = tag === 'td' && i > 0 && /^[0-9０-９,，．.]+円?$/.test(displayText);
                const classes = [];
                if (tableClass.includes('info') || tableClass.includes('att')) classes.push(`col-${i + 1}`);
                if (isAmount) classes.push('val');
                const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
                rowHtml += indent(lastLevel + 3) + `<${tag}${classAttr}>${renderInlineMarkdown(text)}</${tag}>` + nl;
            });
            rowHtml += indent(lastLevel + 2) + '</tr>' + nl;
            return rowHtml;
        };

        if (tableHasHeader && tableBuffer.length > 0) {
            tableHtml += indent(lastLevel + 1) + '<thead>' + nl;
            tableHtml += renderRow(tableBuffer[0], 'th');
            tableHtml += indent(lastLevel + 1) + '</thead>' + nl;
            tableHtml += indent(lastLevel + 1) + '<tbody>' + nl;
            tableBuffer.slice(1).forEach(row => { tableHtml += renderRow(row, 'td'); });
            tableHtml += indent(lastLevel + 1) + '</tbody>' + nl;
        } else {
            tableBuffer.forEach(row => { tableHtml += renderRow(row, 'td'); });
        }

        tableHtml += indent(lastLevel) + '</table>' + nl;
        tableBuffer = [];
        tableHasHeader = false;
        return tableHtml;
    };

    // 証拠説明書テーブルをフラッシュしてHTMLを生成する内部関数
    const flushEvidenceTable = () => {
        if (evidenceTableBuffer.length === 0) return '';
        let tableHtml = '';
        
        // ヘッダー行とセパレーター行をスキップ
        const headerRow = evidenceTableBuffer[0];
        const dataRows = evidenceTableBuffer.slice(1); // セパレーターは既に除外済みのためヘッダーのみスキップ
        
        tableHtml += indent(lastLevel) + '<table class="evidence">' + nl;

        // 列の役割は見出し語で決める（列の順序や有無に依存しない）。
        // 旧書式「号証｜標目｜原本写｜作成年月日｜作成者｜立証趣旨」でも、
        // 新法書式「号証｜標目｜作成年月日｜作成者｜立証趣旨｜備考」でも同じ幅指定になる。
        const evidenceColClass = (header) => {
            const h = (header || '').replace(/\s/g, '');
            if (h.includes('号証')) return 'col-no';
            if (h.includes('標目')) return 'col-title';
            if (h.includes('原本') || h.includes('写')) return 'col-orig';
            if (h.includes('年月日')) return 'col-date';
            if (h.includes('作成者')) return 'col-author';
            if (h.includes('立証')) return 'col-purpose';
            if (h.includes('備考')) return 'col-note';
            return 'col-other';
        };
        const colClasses = headerRow.map(c => evidenceColClass(c.trim()));

        // 列幅は固定レイアウトで比例配分する。Copper PDF の自動レイアウトは、
        // 幅 auto の列が 2 つ以上（標目と立証趣旨）あると一方へ偏るため。
        // 短い列（号証・原本写し・年月日・作成者・備考）は内容の最大幅（折り返す列は上限あり）、
        // 標目と立証趣旨は残りを中身の量（全行の文字幅の和）に比例して分ける——行の高さが揃う配分。
        // getVisualWidth は全角=1・半角=0.5 で数える（= em）。セルの左右の余白と罫線（約 0.7em）は
        // CELL_PAD で足す。折り返さない列（号証・年月日の塊）は見出しも含めて測り、上限で切らない
        // ——切ると字が隣の列へはみ出す（2026-09-25 の証拠説明書3、TECH-20260925-001）。
        const CELL_PAD = 0.8;
        const nowrapCols = { 'col-no': true, 'col-date': true };
        const shortMaxEm = { 'col-orig': 2.5, 'col-author': 4.5, 'col-note': 4.5 };
        const shortMinEm = { 'col-no': 2, 'col-orig': 2, 'col-date': 3.5, 'col-author': 3, 'col-note': 3 };
        const colW = colClasses.map(() => 0);
        const colArea = colClasses.map(() => 0);
        // 折り返さない塊の幅。Copper PDF は和文と欧文の間に四分アキ（0.25em）を入れ、
        // 半角の英大文字は 0.5em より広い（「乙A号証」は 3.5em ではなく約 4.2em）
        const nowrapWidth = (text) => {
            let w = getVisualWidth(text);
            for (let k = 0; k < text.length; k++) {
                const half = /[\x20-\x7e]/.test(text[k]);
                if (/[A-Z]/.test(text[k])) w += 0.2;
                if (k > 0 && half !== /[\x20-\x7e]/.test(text[k - 1])) w += 0.25;
            }
            return w;
        };
        const measure = (cell, i, header) => {
            const text = stripInlineMarkdown((cell || '').trim());
            const w = header
                ? Math.max(0, ...evidenceHeaderChunks(text).map(nowrapWidth))
                : colClasses[i] === 'col-date'
                    ? Math.max(0, ...dateChunks(text).map(nowrapWidth))
                    : (nowrapCols[colClasses[i]] ? nowrapWidth(text) : getVisualWidth(text));
            if (w > colW[i]) colW[i] = w;
        };
        headerRow.forEach((cell, i) => { if (nowrapCols[colClasses[i]]) measure(cell, i, true); });
        dataRows.forEach(row => row.forEach((cell, i) => {
            measure(cell, i, false);
            colArea[i] += getVisualWidth(stripInlineMarkdown((cell || '').trim()));
        }));
        const fixedEm = colClasses.map((cls, i) => {
            if (!(cls in shortMinEm)) return 0;
            const content = Math.max(colW[i], shortMinEm[cls]);
            return (nowrapCols[cls] ? content : Math.min(content, shortMaxEm[cls])) + CELL_PAD;
        });
        // 標目は中身が少なくても 6 字分は残す。下限に張り付いた列の分は他の伸びる列から引き、
        // 合計を本文幅に保つ（合計が本文幅を超えると 100% への換算で短い列まで縮む）
        const flexMinEm = { 'col-title': 6, 'col-purpose': 8, 'col-other': 3 };
        const flexible = colClasses.map((cls, i) => cls in flexMinEm ? Math.max(colArea[i], 1) : 0);
        // 本文幅 160mm（A4・左右余白 30mm/20mm）÷ 12pt = 37.8em
        const bodyEm = 37.8;
        const fixedTotal = fixedEm.reduce((x, y) => x + y, 0);
        const remain = Math.max(bodyEm - fixedTotal, 10);
        const pinned = colClasses.map(() => false);
        let flexWidths = colClasses.map(() => 0);
        for (let pass = 0; pass < colClasses.length; pass++) {
            const free = remain - flexWidths.reduce((x, y, i) => x + (pinned[i] ? y : 0), 0);
            const freeTotal = flexible.reduce((x, y, i) => x + (pinned[i] ? 0 : y), 0) || 1;
            let changed = false;
            flexWidths = flexWidths.map((w, i) => {
                if (!flexible[i] || pinned[i]) return w;
                const share = free * flexible[i] / freeTotal;
                const min = flexMinEm[colClasses[i]] || 0;
                if (share < min) { pinned[i] = true; changed = true; return min; }
                return share;
            });
            if (!changed) break;
        }
        const widthsEm = colClasses.map((cls, i) => fixedEm[i] > 0 ? fixedEm[i] : flexWidths[i]);
        const sumEm = widthsEm.reduce((x, y) => x + y, 0);
        tableHtml += indent(lastLevel + 1) + '<colgroup>'
            + widthsEm.map(w => `<col style="width:${(100 * w / sumEm).toFixed(1)}%">`).join('')
            + '</colgroup>' + nl;

        // ヘッダー行を生成
        tableHtml += indent(lastLevel + 1) + '<thead>' + nl;
        tableHtml += indent(lastLevel + 2) + '<tr>' + nl;
        headerRow.forEach((cell, i) => {
            const text = cell.trim();
            const headerHtml = nowrapCols[colClasses[i]]
                ? evidenceHeaderChunks(text).map(chunk => `<span class="nw">${renderInlineMarkdown(chunk)}</span>`).join('')
                : renderInlineMarkdown(text);
            tableHtml += indent(lastLevel + 3) + `<th class="${colClasses[i]}">${headerHtml}</th>` + nl;
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
                const cellHtml = colClasses[colIndex] === 'col-date'
                    ? dateChunks(text).map(chunk => `<span class="nw">${renderInlineMarkdown(chunk)}</span>`).join('')
                    : renderInlineMarkdown(text);
                tableHtml += indent(lastLevel + 3) + `<td class="${colClasses[colIndex] || 'col-other'}"${rowspanAttr}>${cellHtml}</td>` + nl;
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

    // 「ラベル：値」型の行だけを表として扱う。読点・句点を含む行は地の文とみなす。
    function isProseColonLine(m, labelIdx) {
        return !!(m && /[、。]/.test(m[labelIdx] + (m[labelIdx + 1] || '')));
    }

    // 当事者欄の連絡先（電話・FAX・メール）の項目名か。
    // 当事者欄の項目表に入れると、項目名が「上告人兼上告受理申立人」などの幅まで均等割付され
    // 「電　　　　話」と間延びし、氏名の列も電話番号の幅に引きずられて右端がそろわなくなる。
    // そのため右寄せ・左寄せの欄では、表に入れず独立した行（p.contact）として出す。
    function isContactLabel(label) {
        return /^(電話|電話番号|携帯|携帯電話|TEL|Tel|ＴＥＬ|FAX|Fax|ＦＡＸ|ファクシミリ|ファックス|メール|E-?mail|Ｅメール)$/.test(String(label || '').trim());
    }

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

        // 横置きセクションの開始・終了: ### --横 / ### --縦
        // 以降の内容をA4横置きのページ（別紙など）として組む。頁番号は本体からの通し。
        if (trimmedLine === '### --横') {
            if (inTable) { html += flushTable(); inTable = false; }
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            if (!inLandscapeBlock) {
                html += '<div class="landscape">' + nl;
                inLandscapeBlock = true;
            }
            continue;
        }
        if (trimmedLine === '### --縦') {
            if (inLandscapeBlock) {
                if (inTable) { html += flushTable(); inTable = false; }
                while (lastLevel > 0) {
                    html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                    lastLevel--;
                }
                html += '</div>' + nl;
                inLandscapeBlock = false;
            }
            continue;
        }

        // テーブル行の処理: |書類名|通数|、- 書類名：通数、1 書類名：通数
        const tableMatch = trimmedLine.match(/^\|(.*)\|$/);
        let listTableMatch = trimmedLine.match(/^[-*] (.*?)[：:](.*)$/);
        if (isProseColonLine(listTableMatch, 1)) listTableMatch = null;

        // 当事者欄（右寄せ・左寄せ）の電話・FAX等は、項目表に入れず独立した行にする（isContactLabel の注記参照）
        if (listTableMatch && (inRightBlock || inLeftBlock) && isContactLabel(listTableMatch[1])) {
            if (inTable) {
                html += flushTable();
                inTable = false;
            }
            html += `<p class="contact">${renderInlineMarkdown(listTableMatch[1].trim() + ' ' + listTableMatch[2].trim())}</p>` + nl;
            continue;
        }
        let numberedListTableMatch = trimmedLine.match(/^([0-9０-９]+)[　\s]+(.+?)[：:](.*)$/);
        if (isProseColonLine(numberedListTableMatch, 2)) numberedListTableMatch = null;

        if (tableMatch || listTableMatch || numberedListTableMatch) {
            // セパレーター行（|:---|:---|...）をチェック
            const isSeparator = tableMatch && /^[\s|:-]+$/.test(tableMatch[1]);
            if (isSeparator) {
                tableHasHeader = true;
                continue;
            }

            // ヘッダー行（「号証」＋「標目」又は「立証趣旨」を含む）をチェック
            const isEvidenceHeader = tableMatch && tableMatch[1].includes('号証')
                && (tableMatch[1].includes('標目') || tableMatch[1].includes('立証趣旨'));
            
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
                tableHasHeader = false;
                if (numberedListTableMatch || isAttachmentHeader(lastHeader)) {
                    tableClass = 'att';
                } else if (inRightBlock) {
                    tableClass = 'info right-info';
                } else if (inLeftBlock) {
                    tableClass = 'info left-info';
                } else {
                    tableClass = 'info default-info';
                }
                inTable = true;
            }

            let cells;
            if (tableMatch) {
                cells = tableMatch[1].split('|');
            } else if (numberedListTableMatch) {
                cells = [numberedListTableMatch[2], numberedListTableMatch[3]];
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

        // シンプルなリスト形式の処理: * 項目名、- 項目名
        const simpleListMatch = trimmedLine.match(/^[*＊-]\s+(.+)$/);
        if (simpleListMatch) {
            if (!inSimpleList) {
                while (lastLevel > 0) {
                    html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                    lastLevel--;
                }
                html += '<ul>' + nl;
                inSimpleList = true;
            }
            html += indent(1) + `<li>${renderInlineMarkdown(simpleListMatch[1])}</li>` + nl;
            continue;
        } else if (inSimpleList) {
            html += '</ul>' + nl;
            inSimpleList = false;
        }

        // 画像の処理: ![説明](画像パス)
        // 書面では常に中央寄せの独立ブロックとして配置する
        const imageMatch = trimmedLine.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imageMatch) {
            if (inRightBlock || inLeftBlock) {
                while (lastLevel > 0) {
                    html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                    lastLevel--;
                }
                html += '</div>' + nl;
                inRightBlock = false;
                inLeftBlock = false;
            }
            const alt = escapeHtmlAttribute(imageMatch[1].trim());
            const src = escapeHtmlAttribute(imageMatch[2].trim());
            const currentIndent = indent(lastLevel + (lastLevel > 0 ? 1 : 0));
            html += currentIndent + `<div class="image-block"><img src="${src}" alt="${alt}" /></div>` + nl;
            continue;
        }

        // 空行（スペーサー）マーカーの処理: ### -
        // 空行は入力上は捨てられるため、見た目の空行を挿入する
        if (trimmedLine === '### -') {
            const currentIndent = indent(lastLevel + (lastLevel > 0 ? 1 : 0));
            html += currentIndent + '<div class="blank-line"></div>' + nl;
            continue;
        }

        // 目次マーカーの処理: ### --目次
        // Copper PDF の cssj:make-toc により、文書内の h1-h6 から目次を生成する
        if (trimmedLine === '### --目次') {
            if (inRightBlock || inLeftBlock) {
                while (lastLevel > 0) {
                    html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                    lastLevel--;
                }
                html += '</div>' + nl;
                inRightBlock = false;
                inLeftBlock = false;
            }
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            html += '<div class="toc-title">目次</div>' + nl;
            html += tocElement + nl;
            continue;
        }

        // 区切り線マーカーの処理: ### ---
        // 改ページはせず、点線（区切り線）を挿入する
        if (trimmedLine === '### ---') {
            // 右/左ブロック内で使われた場合も安全に閉じる
            if (inRightBlock || inLeftBlock) {
                while (lastLevel > 0) {
                    html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                    lastLevel--;
                }
                html += '</div>' + nl;
                inRightBlock = false;
                inLeftBlock = false;
            }

            // リストを閉じて区切り線を挿入
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            html += '<hr class="separator" />' + nl;
            continue;
        }

        // 改ページマーカーの処理: ### -- 任意のテキスト --
        if (/^### --.*--$/.test(trimmedLine)) {
            // テキスト部分を抽出
            const match = trimmedLine.match(/^### --\s*(.*?)\s*--$/);
            const breakText = match ? match[1].trim() : '';
            
            // リストを閉じて改ページを挿入
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            html += (breakText ? `<div class="break">(${renderInlineMarkdown(breakText)})</div>` : '<div class="break"></div>') + nl;
            continue;
        }

        const levelInfo = getLevelInfo(trimmedLine);
        const isHeader = trimmedLine.startsWith('#');
        const markerText = levelInfo
            ? trimmedLine.replace(/^#*\s*/, '').replace(levelInfo.marker, '').trim()
            : '';
        const isTocHeading = !!levelInfo && (isHeader || (levelInfo.level <= 2 && !markerText.includes('。') && !/[：:]/.test(markerText)));
        const liClass = isTocHeading ? ' class="heading-item"' : (levelInfo ? ' class="num-lit"' : '');
        
        let level, text;
        if (levelInfo) {
            level = levelInfo.level;
            // マーカーと#を除去
            text = markerText;
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
            // レベルを飛ばして下位リストを開く場合、中間レベルの li は番号を表示しない
            const currentLiClass = lastLevel === level ? liClass : ' class="filler"';
            html += indent(lastLevel - 1) + `<ol class="lvl${lastLevel}">` + nl + indent(lastLevel) + `<li${currentLiClass}>` + nl;
            openedNewLevel = true;
        }
        while (lastLevel > level) {
            html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
            lastLevel--;
        }
        if (lastLevel === level && levelInfo && !openedNewLevel) {
            // 新しいマーカーがある場合は次の li へ
            html += indent(lastLevel) + '</li>' + nl + indent(lastLevel) + `<li${liClass}>` + nl;
        }

        const currentIndent = indent(lastLevel + (lastLevel > 0 ? 1 : 0));

        if (isTocHeading) {
            lastHeader = text; // ヘッダテキストを保存
            if (levelInfo) {
                const tagName = headingTag(levelInfo.level);
                html += currentIndent + `<${tagName}>${levelInfo.marker}　${renderInlineMarkdown(text)}</${tagName}>` + nl;
            }
        } else if (isHeader) {
            lastHeader = text; // ヘッダテキストを保存
            // マーカーがないヘッダはリストの外に出し、文書タイトルとして扱う
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            html += `<div class="doc-title">${renderInlineMarkdown(text)}</div>` + nl;
            lastLevel = 0;
            continue;
        } else if (text === '以上') {
            // 「以上」のみの行は特別扱い（リストを閉じて右寄せ）
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            html += `<div class="end-mark">${renderInlineMarkdown(text)}</div>` + nl;
            lastLevel = 0;
            continue;
        } else if (text === '記') {
            // 「記」のみの行は特別扱い（リストを閉じてセンタリング）
            while (lastLevel > 0) {
                html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
                lastLevel--;
            }
            html += `<div class="center-mark">${renderInlineMarkdown(text)}</div>` + nl;
            lastLevel = 0;
            continue;
        } else if (/^(?:(?:令和|平成|昭和|大正|明治)\s*(?:[0-9０-９]{1,2}|[元〇○一二三四五六七八九十]{1,3})|[0-9０-９]{1,4})\s*年\s*(?:[0-9０-９]{1,2}|[〇○一二三四五六七八九十]{1,3})\s*月\s*(?:[0-9０-９]{1,2}|[元〇○一二三四五六七八九十]{1,3})\s*日$/.test(text)) {
            // 日付の識別 (和暦・西暦、数字・漢数字、元年などに対応)
            html += currentIndent + `<div class="date">${renderInlineMarkdown(text)}</div>` + nl;
        } else if (/.*[　\s](?:御中|様)$/.test(text)) {
            // 宛先の識別
            html += currentIndent + `<div class="dest">${renderInlineMarkdown(text)}</div>` + nl;
        } else {
            // マーカー付きの段落は、md記載の番号をそのまま出力する（自動採番に頼らない）
            const numPrefix = (levelInfo && !isTocHeading)
                ? `<span class="num">${levelInfo.marker}${level === 2 ? '　' : (level === 1 ? '' : ' ')}</span>`
                : '';
            html += currentIndent + `<p>${numPrefix}${renderInlineMarkdown(text)}</p>` + nl;
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
    if (inSimpleList) {
        html += '</ul>' + nl;
    }
    while (lastLevel > 0) {
        html += indent(lastLevel - 1) + '</li>' + nl + indent(lastLevel - 1) + '</ol>' + nl;
        lastLevel--;
    }
    if (inLandscapeBlock) {
        html += '</div>' + nl;
        inLandscapeBlock = false;
    }

    // スタイルを生成
    let styleTag = '';
    if (rightColWidths.length > 0 || leftColWidths.length > 0 || attColWidths.length > 0 || defaultColWidths.length > 0 || isSoufusho) {
        styleTag = '<style>' + nl;
        if (isSoufusho) {
            styleTag += '* { font-size: 10.5pt; }' + nl;
        }
        
        // 版面に収まる最大の全角文字数。これを超える幅を指定すると、
        // 1行に収まらない項目が紙面の右へはみ出して切れる。
        const MAX_COL_WIDTH_EM = 38;

        const generateTableStyle = (widths, className) => {
            let css = '';
            widths.forEach((w, i) => {
                if (w) {
                    // 右寄せの当事者欄の最後の列（氏名）は余裕を足さず、折り返しも止める。
                    // 足すと氏名の右に1字分の空きが出て、住所の行と右端がそろわない。
                    if (className === 'right-info' && i === widths.length - 1 && w <= MAX_COL_WIDTH_EM) {
                        css += `table.${className} td.col-${i + 1} { width: ${w}em; white-space: nowrap; }` + nl;
                        return;
                    }
                    w += 1; // 余裕を持たせる
                    // 附属書類・証拠書類（attクラス）の1列目はカウンター（2em）があるため幅を広げる
                    if (className === 'att' && i === 0) {
                        w += 2.5;
                    }
                    if (w > MAX_COL_WIDTH_EM) {
                        // 長い項目名は1行に収まらない。幅の指定をやめて折り返させる。
                        // 附属書類の1列目は既定で white-space: nowrap のため、あわせて解除する。
                        css += `table.${className} td.col-${i + 1} { width: auto; white-space: normal; }` + nl;
                    } else {
                        css += `table.${className} td.col-${i + 1} { width: ${w}em; }` + nl;
                    }
                }
            });
            return css;
        };

        styleTag += generateTableStyle(rightColWidths, 'right-info');
        styleTag += generateTableStyle(leftColWidths, 'left-info');
        styleTag += generateTableStyle(attColWidths, 'att');
        styleTag += generateTableStyle(defaultColWidths, 'default-info'); // クラス指定がない通常のinfoテーブル用

        styleTag += '</style>' + nl;
    }

    return styleTag + html;
}

/**
 * ページ内のすべての <pre> タグを裁判文書形式に変換します。
 */
async function renderMarkdown() {
    const preElements = document.querySelectorAll('pre');
    for (const pre of Array.from(preElements)) {
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
    (window as any).convertMarkdownToCourtHtml = convertMarkdownToCourtHtml;
    // ブラウザ環境では自動実行
    (window as any).__houhiMarkdownReady = false;
    (window as any).__houhiMarkdownPromise = null;
    document.addEventListener('DOMContentLoaded', () => {
        const promise = renderMarkdown();
        (window as any).__houhiMarkdownPromise = promise;
        promise.finally(() => {
            (window as any).__houhiMarkdownReady = true;
        });
    });
}
