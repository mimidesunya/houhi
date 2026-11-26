# fullline_stats の食い違いを、(a) 折り返し位置の近くに約物・小書き仮名がある、(b) 同じ段落の前の行が既に違う（その波及）、(c) それ以外、に分ける
import sys, os, unicodedata
from lines import visual_lines
norm = lambda s: unicodedata.normalize("NFKC", s)
PUNCT = set("、。，．）」』】〕］｝〉》・：；？！ー…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ（「『【〔［｛〈《")
def rows(path):
    out = []
    for pi, pg in enumerate(visual_lines(path)):
        for l in pg["lines"]:
            if l["size"] >= 10:
                l = dict(l); l["p"] = pi; out.append(l)
    return out
base, typ = sys.argv[1], sys.argv[2]
cnt = {"a": 0, "b": 0, "c": 0}
for name in sys.argv[3:]:
    a = rows(os.path.join(base, name + ".pdf")); b = rows(os.path.join(typ, name + ".pdf"))
    bset = set(norm(l["t"]) for l in b)
    bad = set()
    for i, l in enumerate(a):
        if not (l["x1"] >= 536 and l["x0"] <= 120 and l["n"] >= 30): continue
        if norm(l["t"]) in bset: continue
        nxt = a[i + 1]["t"] if i + 1 < len(a) else ""
        prev = a[i - 1] if i > 0 else None
        if any(c in PUNCT for c in l["t"][-3:] + nxt[:2]): k = "a"
        elif prev and prev["p"] == l["p"] and abs(l["y"] - prev["y"]) < 21 and (i - 1) in bad: k = "b"
        else: k = "c"
        bad.add(i); cnt[k] += 1
        if k == "c": print("c:", name, l["t"])
print(cnt)
