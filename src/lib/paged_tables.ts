/**
 * Paged.js で表を頁にまたがって組むときの補い。
 * Web 版のプレビュー・印刷（src/web/app.ts）と Chrome エンジンの PDF（pdf_converter_chrome.ts）で共通に使う。
 *
 * 2026-11-25、Web 版で証拠説明書を印刷すると、プレビューには出ている行（頁末で分かれた行の前半）が
 * PDF から消えた。原因は二つ重なっていた。
 *
 * 1. Paged.js 0.4 は表を頁で分けると、続きの頁の表を空の複製から作り直すので、colgroup と thead が落ちる。
 *    table-layout: fixed の証拠説明書は続きの頁で列が等幅になり、狭い列で字が細かく折れて行が高くなる。
 *    表頭も出ない（Copper PDF は列幅を保ち、表頭も頁ごとに繰り返す）。
 *    → registerPagedTableHandlers の layout フックで、続きの頁の表に colgroup と thead を写す。
 *      頁の高さを測る前に足すので、表頭の分も頁割りに入る。
 * 2. Paged.js の頁の本文領域は段組み（column-fill: auto）で、領域からはみ出した分は頁の外の見えない段へ行く。
 *    頁割りは画面で計算し、印刷ではブラウザが組み直すので、字の幅の違いなどで1行でも伸びると、
 *    頁末の行が見えない段へ移って消える。この件の PDF（Mac で印刷）では、頁末の行の前半が丸ごと消えていた
 *    （WebKit は表の行を段の途中で分けないため、とみられる。PDF の頁は、プレビューより行の上がちょうど1行高かった）。
 *    Paged.js は文字の行が収まるかだけを見て、セルの下の余白と罫線を勘定しないので、印刷の前から
 *    行が数 px はみ出していることもある。Chrome はそうした行を丸ごと次の段へ送ることがある
 *    （頁の頭の、頁より長い行の続きで 1px はみ出し、行が丸ごと消えた）。
 *    → showPagedOverflow で、頁割りが終わったら本文領域の段組みを外す。
 *      はみ出した分は下の余白に出て見え、消えない（Chrome エンジンは画面用の指定のまま印刷するので、印刷に限らない）。
 *
 * あわせて、頁の途中から始まる行は、頁に収まらなければ分けずに次の頁へ送る（Copper PDF と同じ）。
 * Paged.js は、はみ出した所で行を切るので、前半の頁に標目の数行だけ、後半の頁に残りの列が出ていた。
 * 頁の頭の行は、頁より長いときに限って分ける（送っても収まらず、送ると Paged.js が組めずに行を落とすため）。
 */

/**
 * Paged.js にハンドラを登録する。PagedPolyfill.preview() より前に呼ぶ。
 * win は Paged.js を読み込んだウィンドウ（Web 版ではプレビューの iframe）。
 * Chrome エンジンでは文字列にして頁へ埋め込むので、この関数の外のものを参照しない。
 */
export function registerPagedTableHandlers(win?: any) {
    const w = win || window;
    const Paged = w && w.Paged;
    if (!Paged || typeof Paged.registerHandlers !== 'function' || !Paged.Handler) return false;
    if (w.__houhiPagedTableHandlers) return true;
    w.__houhiPagedTableHandlers = true;

    const childByTag = (parent: Element, tag: string) => {
        for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
            if (child.tagName === tag) return child;
        }
        return null;
    };
    const previousRow = (tr: Element) => {
        let prev = tr.previousElementSibling;
        while (prev && prev.tagName !== 'TR') prev = prev.previousElementSibling;
        return prev;
    };

    class HouhiPagedTables extends Paged.Handler {
        // 頁の内容を並べ終え、はみ出しを測る直前に呼ばれる（1頁に何度も呼ばれることがある）
        layout(wrapper: Element) {
            const source = (this as any).chunker && (this as any).chunker.source;
            if (!source || typeof source.querySelector !== 'function') return;
            const tables = Array.prototype.slice.call(wrapper.querySelectorAll('table[data-split-from]')) as Element[];
            tables.forEach(table => {
                if (table.hasAttribute('data-houhi-table-repeated')) return;
                table.setAttribute('data-houhi-table-repeated', '');
                const ref = (table.getAttribute('data-split-from') || '').replace(/["\\]/g, '\\$&');
                const original = source.querySelector(`table[data-ref="${ref}"]`);
                if (!original) return;

                // 表の子の並びは caption, colgroup, thead, tbody の順
                let anchor: Element | null = table.firstElementChild;
                while (anchor && anchor.tagName === 'CAPTION') anchor = anchor.nextElementSibling;
                if (!childByTag(table, 'COLGROUP')) {
                    for (let child = original.firstElementChild; child; child = child.nextElementSibling) {
                        if (child.tagName === 'COLGROUP') table.insertBefore(child.cloneNode(true), anchor);
                    }
                }
                const thead = childByTag(original, 'THEAD');
                if (thead && !childByTag(table, 'THEAD')) {
                    let before: Element | null = table.firstElementChild;
                    while (before && (before.tagName === 'CAPTION' || before.tagName === 'COLGROUP')) before = before.nextElementSibling;
                    const copy = thead.cloneNode(true) as Element;
                    copy.setAttribute('data-houhi-repeated-thead', '');
                    table.insertBefore(copy, before);
                }
            });
        }

        // はみ出しが行の途中から始まるとき、その行が頁の途中から始まっているなら、行の頭で頁を改める
        onOverflow(overflow: Range, rendered: Element) {
            if (!overflow) return undefined;
            const start = overflow.startContainer as Node;
            const element = (start.nodeType === 1 ? start : start.parentNode) as Element | null;
            const tr = element && typeof element.closest === 'function' ? element.closest('tr') : null;
            if (!tr || !rendered.contains(tr)) return undefined;
            if (!tr.parentElement || tr.parentElement.tagName !== 'TBODY') return undefined;
            if (!previousRow(tr)) return undefined;
            const range = tr.ownerDocument.createRange();
            range.setStartBefore(tr);
            range.setEndAfter(rendered.lastChild as Node);
            return range;
        }
    }

    Paged.registerHandlers(HouhiPagedTables);
    return true;
}

/**
 * Paged.js の頁の本文領域の段組みを外し、はみ出した分を見えない段へ送らずに下の余白へ出す。
 * PagedPolyfill.preview() の後に呼ぶ（頁割りは段組みではみ出しを測るので、前に外すと頁割りが崩れる）。
 * 段組みの要素は flow-root にして、ブロック整形文脈（中の余白の扱い）を変えない。
 */
export function showPagedOverflow(root?: Document) {
    const doc = root || document;
    if (doc.querySelector('style[data-houhi-pagedjs-show-overflow]')) return;
    const style = doc.createElement('style');
    style.setAttribute('data-houhi-pagedjs-show-overflow', '');
    style.textContent = '.pagedjs_pagebox > .pagedjs_area > .pagedjs_page_content { columns: auto !important; column-width: auto !important; column-count: auto !important; display: flow-root !important; overflow: visible !important; }';
    doc.head.appendChild(style);
}

export function getPagedTablesBrowserScript() {
    return `
var registerPagedTableHandlers = ${registerPagedTableHandlers.toString()};
var showPagedOverflow = ${showPagedOverflow.toString()};
`.trim();
}
