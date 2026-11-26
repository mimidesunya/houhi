// houhi の Markdown を Typst に変換する試作。
// Markdown の解釈は houhi の court_markdown.ts（repo の dist/src/base/court_markdown.js）に任せ、
// その HTML（クラス付き）を木にして、style.css の体裁を Typst の指定へ写す。
// 3つの文書（訴状・準備書面・長い証拠説明書）に出てくる要素だけを扱う。
//
// usage: node md2typ.js <in.md> <out.typ>
const fs = require('fs');
const path = require('path');
const { convertMarkdownToCourtHtml } = require('../../../dist/src/base/court_markdown.js');

const EM = 12; // pt

// ---------- HTML を木にする ----------
const VOID = new Set(['br', 'col', 'img', 'hr', 'meta', 'link']);
function decode(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function parseHtml(html) {
    const root = { tag: '#root', attrs: {}, children: [] };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9:-]+)\s*>|<([a-zA-Z0-9:-]+)([^>]*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
        const top = stack[stack.length - 1];
        if (m[1]) {
            const tag = m[1].toLowerCase();
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tag === tag) { stack.length = i; break; }
            }
        } else if (m[2]) {
            const tag = m[2].toLowerCase();
            const attrs = {};
            m[3].replace(/([a-zA-Z-:]+)\s*=\s*"([^"]*)"/g, (_x, k, v) => { attrs[k] = decode(v); });
            const node = { tag, attrs, children: [], parent: top };
            top.children.push(node);
            if (!VOID.has(tag) && !m[4]) stack.push(node);
        } else if (m[5] !== undefined) {
            top.children.push({ tag: '#text', text: decode(m[5]), parent: top });
        }
    }
    return root;
}
const cls = (n) => ((n.attrs && n.attrs.class) || '').split(/\s+/).filter(Boolean);
const hasCls = (n, c) => cls(n).includes(c);
const elems = (n) => n.children.filter(c => c.tag !== '#text');
const textOf = (n) => n.tag === '#text' ? n.text : n.children.map(textOf).join('');

// ---------- Typst の文字列 ----------
// 記号は全部バックスラッシュで逃がす（# * _ ` $ < > @ [ ] = - + / ~ " ' \）
function esc(s) {
    return s.replace(/[\\#*_`$<>@\[\]=\-+\/~"']/g, '\\$&');
}
function strLit(s) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
// 段落の中身（インライン）
function inline(n) {
    if (n.tag === '#text') return esc(n.text.replace(/\s*\n\s*/g, ''));
    if (n.tag === 'ruby') {
        const rt = n.children.find(c => c.tag === 'rt');
        const base = n.children.filter(c => c.tag !== 'rt').map(inline).join('');
        return `#ruby[${rt ? inline(rt) : ''}][${base}]`;
    }
    if (n.tag === 'rt') return n.children.map(inline).join('');
    if (n.tag === 'br') return '\\ ';
    if (n.tag === 'span' && hasCls(n, 'underline')) return `#underline[${n.children.map(inline).join('')}]`;
    if (n.tag === 'span' && hasCls(n, 'nw')) return `#box[${n.children.map(inline).join('')}]`;
    return n.children.map(inline).join('');
}
const pt = (v) => `${+v.toFixed(3)}pt`;

// ---------- 本体 ----------
function convert(md) {
    const html = convertMarkdownToCourtHtml(md);
    const root = parseHtml(html);

    // <style> の項目表の幅（em）
    const colWidths = {}; // e.g. 'right-info' -> [3, 5]
    root.children.filter(n => n.tag === 'style').forEach(s => {
        textOf(s).replace(/table\.([a-z-]+) td\.col-(\d+) \{ width: ([0-9.]+)em/g, (_x, c, i, w) => {
            (colWidths[c] = colWidths[c] || [])[+i - 1] = +w;
        });
    });

    const out = [];
    let started = false; // 最初の中身を出したか（文書の頭の余白は弱い v だと消えるため）
    const space = (em) => {
        if (!em) return;
        out.push(started ? `#v(${em}em, weak: true)` : `#v(${em}em)`);
    };
    const emit = (s) => { out.push(s); started = true; };

    const visualWidth = (t) => [...t].reduce((a, ch) => a + (/[\x20-\x7e｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);

    function infoTable(n, side) {
        const kind = cls(n).find(c => /-info$/.test(c)) || 'default-info';
        const spec = colWidths[kind] || [];
        const rows = elems(n).flatMap(x => x.tag === 'tr' ? [x] : elems(x).filter(y => y.tag === 'tr'));
        const cells = rows.map(r => elems(r).filter(c => c.tag === 'td'));
        // Chrome の自動の表組みでは、td の width は罫線・余白込みの幅として効き、min-width 4em も効く
        const natural0 = Math.max(...cells.map(c => visualWidth(textOf(c[0]).trim()))) * EM;
        const col1 = Math.max((spec[0] || 0) * EM, 4 * EM, natural0 + 18 + 1.5);
        const natural1 = Math.max(...cells.map(c => c[1] ? visualWidth(textOf(c[1]).trim()) : 0)) * EM;
        const col2 = Math.max((spec[1] || 0) * EM, natural1 + 1.5);
        const rowsT = cells.map(c => `([#spread(${strLit(textOf(c[0]).trim())})], [${c[1] ? inline(c[1]).trim() : ''}])`);
        emit(`#info((${pt(col1)}, ${pt(col2)}), (${rowsT.join(', ')},), toright: ${side === "right"})`);
        space(1.618); // table.info { margin-bottom: 1.618em }
    }

    function attTable(n) {
        const spec = colWidths['att'] || [];
        const rows = elems(n).filter(x => x.tag === 'tr');
        const col1 = (spec[0] || 8) * EM; // td padding 0、1列目の padding-right 1em を含む
        const items = rows.map((r, i) => {
            const tds = elems(r).filter(c => c.tag === 'td');
            return `[#box(width: 2em)[${i + 1}　]${inline(tds[0]).trim()}], [${tds[1] ? inline(tds[1]).trim() : ''}]`;
        });
        emit(`#pad(left: 2em, table(columns: (${pt(col1)}, auto), stroke: none, inset: 0pt, align: left + top, ${items.join(', ')}))`);
        space(38.8 / EM); // table.att { margin-bottom: 38.8pt }
    }

    function evidenceTable(n) {
        space(1.618);
        const colgroup = elems(n).find(x => x.tag === 'colgroup');
        const widths = colgroup ? elems(colgroup).map(c => parseFloat((c.attrs.style || '').replace(/[^0-9.]/g, ''))) : [];
        const thead = elems(n).find(x => x.tag === 'thead');
        const tbody = elems(n).find(x => x.tag === 'tbody');
        const headCells = elems(elems(thead)[0]).map(th => `[${inline(th).trim()}]`);
        // 行ごとに (列番号, rowspan, 中寄せか, 中身) を並べる。rowspan で埋まった列は飛ばして列番号を数える
        const rowsT = [];
        const occupied = []; // occupied[r] = Set(列番号)
        elems(tbody).forEach((tr, r) => {
            const cells = [];
            let col = 0;
            elems(tr).forEach(td => {
                while (occupied[r] && occupied[r].has(col)) col++;
                const rs = +(td.attrs.rowspan || 1);
                for (let k = 1; k < rs; k++) (occupied[r + k] = occupied[r + k] || new Set()).add(col);
                cells.push(`(${col}, ${rs}, ${hasCls(td, 'col-orig')}, [${inline(td).trim()}])`);
                col++;
            });
            rowsT.push(`(${cells.join(', ')},)`);
        });
        emit([
            `#evtable((${widths.join(', ')}), (${headCells.join(', ')}), (`,
            '  ' + rowsT.join(',\n  '),
            '))',
        ].join('\n'));
        space(1.618);
    }

    // 番号付きの階層の字下げ（em、本文の左端から）。Chrome 版の PDF の実測に合わせた
    function geometry(li, lvl, isHeading, hasNum) {
        const c = li ? cls(li) : [];
        if (!li) return { x: 0, fi: 1 };
        if (lvl === 1) return isHeading ? { x: 0, fi: 0 } : { x: 0, fi: 1 };
        if (lvl === 2) {
            if (c.includes('heading-item')) return isHeading ? { x: 0, fi: 0 } : { x: 0, fi: 1 };
            return hasNum ? { x: 1, markx: 0.5 } : { x: 1, fi: 1 };
        }
        // 3 以下
        if (c.includes('heading-item')) return isHeading ? { x: 1, fi: 0 } : { x: 1, fi: 1 };
        return hasNum ? { x: 1.5, markx: 1 } : { x: 1.5, fi: 1 };
    }

    function para(n, g, opts = {}) {
        const kids = n.children.slice();
        let mark = '';
        const first = kids.find(k => k.tag !== '#text' || k.text.trim());
        if (first && first.tag === 'span' && hasCls(first, 'num')) {
            mark = inline(first);
            kids.splice(kids.indexOf(first), 1);
        }
        let body = kids.map(inline).join('').trim();
        let inset, fi, hang;
        if (g.markx !== undefined) {
            inset = Math.min(g.markx, g.x);
            fi = g.markx - inset;
            hang = g.x - inset;
            // 番号は箱に入れる（両端揃えで番号の後ろの全角空白が伸びないように）
            body = `#box[${mark}]` + body;
        } else {
            inset = Math.min(g.x, g.x + g.fi);
            fi = g.x + g.fi - inset;
            hang = g.x - inset;
        }
        const args = [];
        if (inset) args.push(`inset: ${inset}em`);
        if (fi) args.push(`fi: ${fi}em`);
        if (hang) args.push(`hang: ${hang}em`);
        if (opts.sticky) args.push('sticky: true');
        emit(`#P(${args.join(', ')})[${body}]`);
    }

    function walk(n, ctx) {
        for (const c of n.children) {
            if (c.tag === '#text' || c.tag === 'style') continue;
            const k = cls(c);
            if (c.tag === 'div' && k.includes('doc-title')) {
                space(1.618);
                emit(`#block(sticky: true, width: 100%, align(center, text(tracking: 0.5em)[${inline(c).trim()}#h(0.5em)]))`); // CSS の letter-spacing は最後の字の後ろにも付く
                space(1.618);
            } else if (c.tag === 'div' && k.includes('right')) {
                space(1.618);
                walk(c, { ...ctx, side: 'right' });
                space(1.618);
            } else if (c.tag === 'div' && k.includes('left')) {
                walk(c, { ...ctx, side: 'left' });
            } else if (c.tag === 'div' && k.includes('date')) {
                emit(`#align(right)[${inline(c).trim()}]`);
                space(1.618);
            } else if (c.tag === 'div' && k.includes('dest')) {
                emit(`#P()[${inline(c).trim()}]`);
            } else if (c.tag === 'div' && k.includes('end-mark')) {
                space(1.618);
                emit(`#align(right)[${inline(c).trim()}]`);
                space(1.618);
            } else if (c.tag === 'table' && k.includes('evidence')) {
                evidenceTable(c);
            } else if (c.tag === 'table' && k.includes('att')) {
                attTable(c);
            } else if (c.tag === 'table' && k.includes('info')) {
                infoTable(c, ctx.side);
            } else if (c.tag === 'p') {
                if (ctx.side === 'right') emit(`#RP[${inline(c).trim()}]`);
                else if (ctx.side === 'left') emit(`#P()[${inline(c).trim()}]`);
                else {
                    const hasNum = !!c.children.find(x => x.tag === 'span' && hasCls(x, 'num'));
                    para(c, geometry(ctx.li, ctx.lvl, false, hasNum));
                }
            } else if (c.tag === 'ol') {
                const lvl = +((k.find(x => /^lvl\d$/.test(x)) || 'lvl0').slice(3));
                walk(c, { ...ctx, lvl });
            } else if (c.tag === 'li') {
                if (ctx.lvl === 1) space(1.618); // ol.lvl1 > li { margin-top: 1.618em }
                walk(c, { ...ctx, li: c });
            } else if (/^h[1-6]$/.test(c.tag)) {
                para(c, geometry(ctx.li, ctx.lvl, true, false), { sticky: true });
            } else {
                walk(c, ctx);
            }
        }
    }
    walk(root, { lvl: 0, li: null, side: null });
    return out.join('\n');
}

if (require.main === module) {
    const [inMd, outTyp] = process.argv.slice(2);
    const md = fs.readFileSync(inMd, 'utf8');
    const pre = fs.readFileSync(path.join(__dirname, 'court.typ'), 'utf8');
    fs.writeFileSync(outTyp, pre + '\n// ---- 本文 ----\n' + convert(md) + '\n');
}
module.exports = { convert };
