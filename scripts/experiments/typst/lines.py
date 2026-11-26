# usage: python lines.py file.pdf  -> prints visual lines per page (y, x0, x1, text)
# 同じ基線の字を左から並べ、1em 以上の隙間で区切る（表の列ごとに分ける）
import sys, fitz, json, os
def visual_lines(path):
    d = fitz.open(path)
    pages = []
    for page in d:
        chars = []
        rd = page.get_text("rawdict")
        for b in rd["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    for c in s["chars"]:
                        if c["c"].strip() == "":
                            continue
                        x0, y0, x1, y1 = c["bbox"]
                        chars.append((round(c["origin"][1], 1), x0, x1, c["c"], s["size"]))
        chars.sort(key=lambda t: (t[0], t[1]))
        rows = []
        for ch in chars:
            if rows and abs(rows[-1]["y"] - ch[0]) < 1.5:
                rows[-1]["c"].append(ch)
            else:
                rows.append({"y": ch[0], "c": [ch]})
        out = []
        for r in rows:
            cs = sorted(r["c"], key=lambda t: t[1])
            segs = []
            for ch in cs:
                if segs and ch[1] - segs[-1]["x1"] < ch[4] * 0.9:
                    segs[-1]["t"] += ch[3]; segs[-1]["x1"] = ch[2]; segs[-1]["n"] += 1
                else:
                    segs.append({"x0": ch[1], "x1": ch[2], "t": ch[3], "n": 1, "size": ch[4]})
            for s in segs:
                out.append({"y": r["y"], "x0": round(s["x0"], 1), "x1": round(s["x1"], 1), "n": s["n"], "size": round(s["size"], 1), "t": s["t"]})
        pages.append({"w": page.rect.width, "h": page.rect.height, "lines": out})
    return pages
if __name__ == "__main__":
    for p in sys.argv[1:]:
        pages = visual_lines(p)
        print("==", os.path.basename(p), len(pages), "pages")
        for i, pg in enumerate(pages):
            print("-- page", i + 1)
            for l in pg["lines"]:
                print(f'{l["y"]:7.1f} {l["x0"]:6.1f}-{l["x1"]:6.1f} n={l["n"]:2d} s={l["size"]:4.1f} {l["t"]}')
