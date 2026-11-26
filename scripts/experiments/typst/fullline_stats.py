# usage: python fullline_stats.py <baseline_dir> <typst_dir> name...
# Chrome 版で行末まで詰まった本文の行（右端が版面の右端）のうち、Typst 版に同じ字の並びの行があるものを数える
import sys, os, unicodedata
from lines import visual_lines
norm = lambda s: unicodedata.normalize("NFKC", s)
def rows(path):
    out = []
    for pi, pg in enumerate(visual_lines(path)):
        for l in pg["lines"]:
            if l["size"] >= 10:
                out.append(l)
    return out
PUNCT = set("、。，．）」』】〕］｝〉》・：；？！ー…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ（「『【〔［｛〈《")
base, typ = sys.argv[1], sys.argv[2]
tot = same = 0
cause_punct = 0
for name in sys.argv[3:]:
    a = rows(os.path.join(base, name + ".pdf")); b = rows(os.path.join(typ, name + ".pdf"))
    bset = set(norm(l["t"]) for l in b)
    full = [l for l in a if l["x1"] >= 536 and l["x0"] <= 120 and l["n"] >= 30]
    s = [l for l in full if norm(l["t"]) in bset]
    miss = [l for l in full if norm(l["t"]) not in bset]
    tot += len(full); same += len(s)
    for l in miss:
        # 次の行の頭か、この行の末尾近くに約物・小書きの仮名があるか
        i = a.index(l)
        nxt = a[i + 1]["t"] if i + 1 < len(a) else ""
        if any(c in PUNCT for c in l["t"][-3:] + nxt[:2]):
            cause_punct += 1
    print(f"{name}: full={len(full)} same={len(s)}")
print(f"TOTAL full lines={tot} same={same} ({same / tot * 100:.1f}%) ; mismatches with punctuation/small kana near the break={cause_punct}/{tot - same}")
