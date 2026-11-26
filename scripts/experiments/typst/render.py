# usage: python render.py out.png dpi page clip(x0,y0,x1,y1 in pt or 'full') a.pdf b.pdf ...
# 同じ頁の同じ範囲を、左から順に並べた PNG を作る（目で比べるため）
import sys, fitz
out, dpi, page, clip = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]) - 1, sys.argv[4]
pdfs = sys.argv[5:]
pixes = []
for p in pdfs:
    d = fitz.open(p)
    pg = d[page]
    r = pg.rect if clip == "full" else fitz.Rect(*map(float, clip.split(",")))
    pixes.append(pg.get_pixmap(dpi=dpi, clip=r, alpha=False))
w = sum(px.width for px in pixes) + 10 * (len(pixes) - 1)
h = max(px.height for px in pixes)
canvas = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h), False)
canvas.clear_with(200)
x = 0
for px in pixes:
    px.set_origin(x, 0)
    canvas.copy(px, px.irect)
    x += px.width + 10
canvas.save(out)
print(out, w, h)
