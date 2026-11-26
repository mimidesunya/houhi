# usage: python linediff.py a.pdf b.pdf
# 行（同じ基線の字のまとまり）ごとに、行の字の並びと左端を比べる
import sys, unicodedata
from lines import visual_lines
def rows(path):
    out = []
    for pi, pg in enumerate(visual_lines(path)):
        cur = None
        for l in pg["lines"]:
            if l["size"] < 10:  # ルビは除く
                continue
            if cur and abs(cur["y"] - l["y"]) < 1.5:
                cur["t"] += "|" + l["t"]
            else:
                cur = {"p": pi + 1, "y": l["y"], "x": l["x0"], "t": l["t"]}
                out.append(cur)
    return out
a, b = rows(sys.argv[1]), rows(sys.argv[2])
norm = lambda s: unicodedata.normalize("NFKC", s).replace("|", "")
import difflib
sm = difflib.SequenceMatcher(a=[norm(x["t"]) for x in a], b=[norm(y["t"]) for y in b], autojunk=False)
pairs = []
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == "equal":
        pairs += list(zip(a[i1:i2], b[j1:j2]))
same_page = sum(1 for x, y in pairs if x["p"] == y["p"])
same_x = sum(1 for x, y in pairs if abs(x["x"] - y["x"]) <= 1.0)
print(f"rows A={len(a)} B={len(b)} same-text={len(pairs)} same-text&page={same_page} same-text&x(±1pt)={same_x}")
dy = [y["y"] - x["y"] for x, y in pairs if x["p"] == y["p"]]
if dy:
    print(f"baseline dy (B-A, same text, same page): min={min(dy):.1f} max={max(dy):.1f}")
for x, y in pairs:
    if x["p"] != y["p"] or abs(x["x"] - y["x"]) > 1.0:
        print(f'  moved: A p{x["p"]} y={x["y"]:.1f} x={x["x"]:.1f} / B p{y["p"]} y={y["y"]:.1f} x={y["x"]:.1f}  {x["t"]}')
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag != "equal":
        for x in a[i1:i2]:
            print(f'  A p{x["p"]} y={x["y"]:.1f} x={x["x"]:.1f} {x["t"]}')
        for y in b[j1:j2]:
            print(f'  B p{y["p"]} y={y["y"]:.1f} x={y["x"]:.1f} {y["t"]}')
