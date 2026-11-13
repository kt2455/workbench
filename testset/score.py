"""Scores a Tells Checker run against Kyle's answer key (plan step 1.13).

Usage: python3 -I score.py RUN.json TESTSET_DIR
Follows testset/README.md: verdict per sample first; marks are regions, and a
finding that overlaps a mark counts as catching it; any finding in a sample
marked clean is a false flag.
"""
import json, sys
from collections import Counter

run = json.load(open(sys.argv[1]))
base = sys.argv[2]
labels = json.load(open(f"{base}/labels.json"))
key = json.load(open(f"{base}/key.json"))
NAME = {"CLEAN": "clean", "A FEW TELLS": "a_few_tells", "OBVIOUSLY AI": "obviously_ai"}

def to_codepoints(text, utf16_index):
    # The Worker counts in UTF-16 units (JavaScript); the labels in code points (Python).
    units = 0
    for i, ch in enumerate(text):
        if units >= utf16_index:
            return i
        units += 2 if ord(ch) > 0xFFFF else 1
    return len(text)

rows, confusion = [], Counter()
marks_total = marks_caught = 0
clean_samples = clean_flagged = clean_false_findings = 0
unmarked_findings = findings_total = 0
for r in run["results"]:
    sid = r["id"]
    want = NAME[labels[sid]["verdict"]]
    reply = r.get("reply") or {}
    got = reply.get("verdict") if r["status"] == 200 else None
    mode = reply.get("mode")
    text = open(f"{base}/samples/{sid}.txt", encoding="utf-8").read()
    findings = reply.get("findings") or []
    spans = [(to_codepoints(text, f["start"]), to_codepoints(text, f["end"])) for f in findings]
    marks = labels[sid]["marks"]
    caught = sum(1 for m in marks if any(s < m["end"] and m["start"] < e for s, e in spans))
    stray = sum(1 for s, e in spans if not any(s < m["end"] and m["start"] < e for m in marks))
    marks_total += len(marks); marks_caught += caught
    findings_total += len(spans); unmarked_findings += stray
    if want == "clean":
        clean_samples += 1
        clean_false_findings += len(spans)
        clean_flagged += 1 if spans else 0
    confusion[(want, got)] += 1
    rows.append((sid, key[sid]["source"], want, got or f"({mode or 'error ' + str(r['status'])})", len(marks), caught, len(spans), stray, r.get("ms")))

full = [r for r in rows if not r[3].startswith("(")]
agree = sum(1 for r in full if r[2] == r[3])
print(f"Samples: {len(rows)}; full checks with a verdict: {len(full)}")
print(f"Verdict agreement: {agree}/{len(full)}")
print(f"Clean samples with any finding (false flags): {clean_flagged}/{clean_samples} samples, {clean_false_findings} findings")
obvious = [r for r in rows if r[2] == "obviously_ai"]
print(f"'Obviously AI' samples with at least one finding: {sum(1 for r in obvious if r[6] > 0)}/{len(obvious)}")
print(f"Marked passages caught: {marks_caught}/{marks_total}")
print(f"Findings outside any marked passage: {unmarked_findings}/{findings_total}")
print("\nConfusion (Kyle's verdict -> tool's verdict):")
for (w, g), c in sorted(confusion.items(), key=lambda x: (x[0][0], str(x[0][1]))):
    print(f"  {w:13} -> {str(g):13} {c}")
ms = sorted(r[8] for r in rows if r[8])
if ms: print(f"\nTime per check: median {ms[len(ms)//2]/1000:.1f} s, slowest {ms[-1]/1000:.1f} s")
print("\nid   source        kyle          tool          marks caught findings stray")
for r in rows:
    print(f"{r[0]}  {r[1]:13} {r[2]:13} {r[3]:13} {r[4]:5} {r[5]:6} {r[6]:8} {r[7]:5}")
