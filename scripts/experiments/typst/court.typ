// houhi の体裁（src/base/style.css）を Typst で写した前置き。試作。
// 行送りは CSS の line-height: 1.618em に合わせ、1行の箱を 1.618em にする
// （上端 = 基線から 1.168em、下端 = 基線から 0.45em。MS 明朝の ascent 0.859 + 半分の行間 0.309）。
// 段落の間と塊の間は 0 にし、CSS の margin だけを v(weak) で入れる。

#let FONT = sys.inputs.at("font", default: "MS Mincho")
#let LH = 1.618em

#set document(title: sys.inputs.at("title", default: "裁判文書"))
#set page(
  paper: "a4",
  margin: (top: 35mm, right: 20mm, bottom: 27mm, left: 30mm),
  footer: context align(center)[\- #counter(page).display() \-],
  footer-descent: 28.5pt,
)
#set text(
  font: FONT,
  size: 12pt,
  lang: "ja",
  region: "JP",
  top-edge: 1.168em,
  bottom-edge: -0.45em,
  cjk-latin-spacing: none,
  overhang: false, // 行頭・行末の約物や「-」を版面の外へはみ出させない（Chrome と同じ）
)
#set par(leading: 0pt, spacing: 0pt, justify: true, linebreaks: "simple")
#set block(spacing: 0pt)

// 段落。inset = 左の余白、fi = 1行目の字下げ、hang = 2行目以降の字下げ（いずれも inset から）
// （block の中の set par は効かなかったので、par を明示して作る）
#let P(inset: 0pt, fi: 0pt, hang: 0pt, sticky: false, body) = block(sticky: sticky, inset: (left: inset), width: 100%,
  par(first-line-indent: (amount: fi, all: true), hanging-indent: hang, body))

// 右寄せの欄の段落（.right p: display table、min-width 16em、margin-left auto、左揃え）
#let RP(body) = context {
  let w = measure(body).width
  align(right, block(width: calc.max(w, 16em.to-absolute()), align(left, par(justify: false, body))))
}

// 均等割付（text-align-last: justify）
#let spread(s) = s.clusters().join(h(1fr))

// ルビ（50%）。親字の上に置き、行の高さは変えない
#let ruby(rt, base) = box[#place(center + top, dy: -5pt, box(width: 20em, align(center, text(size: 0.5em, rt))))#base]

// 項目表（table.info）。cols = 各列の幅、right = 右寄せ
#let info(widths, rows, toright: false) = {
  let t = table(
    columns: widths,
    stroke: none,
    inset: (col, row) => if col == 0 { (left: 0.75pt, right: 18.75pt, y: 0.75pt) } else { (x: 0.75pt, y: 0.75pt) },
    align: left + top,
    ..rows.flatten(),
  )
  if toright { align(right, t) } else { t }
}

// 証拠説明書の表。widths = colgroup の百分率、head = 見出しの各セル、
// rows = 行ごとの ((列番号, rowspan, 中寄せか, 中身), ...)。
// 行は頁の途中で分けない（Chrome 版・Copper 版と同じ）。ただし頁より高い行だけは分けてよいことにする
// （分けないと、頁に収まらない分が頁の外へ出て消える）
#let evtable(widths, head, rows) = context {
  let body-w = page.width - 30mm - 20mm
  let body-h = page.height - 35mm - 27mm
  let total = widths.sum()
  let colw = widths.map(w => w / total * body-w)
  let headh = measure(table(columns: colw, inset: (x: 4pt, y: 2pt), stroke: 0.5pt, ..head)).height
  let cells = ()
  for row in rows {
    let h = calc.max(..row.map(c => measure(block(width: colw.at(c.at(0)) - 8pt, c.at(3))).height + 4.5pt))
    let tall = h > body-h - headh
    for c in row {
      cells.push(table.cell(rowspan: c.at(1), align: if c.at(2) { center + top } else { left + top }, breakable: tall, c.at(3)))
    }
  }
  block(width: 100%)[
    #set par(justify: false)
    #table(
      columns: widths.map(w => w * 1fr),
      stroke: 0.5pt,
      inset: (x: 4pt, y: 2pt),
      align: left + top,
      table.header(..head.map(x => table.cell(align: center + top, x))),
      ..cells,
    )
  ]
}
