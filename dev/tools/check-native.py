#!/usr/bin/env python3
"""Checks the dark mode for native pages on dev/preview/native.html (run by dev/tools/test.sh).

Reads the webkit-run output (the page's window.__nativeChecks as JSON) and the
screenshot, prints each check, and samples the pixel probes: every photo must
render with its real colors (within tolerance), never inverted.
Usage: check-native.py <webkit-run output file> <screenshot.png> <device scale>
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from png_pixels import read  # noqa: E402

out, png, scale = sys.argv[1], sys.argv[2], float(sys.argv[3])
text = open(out).read()
m = re.search(r'^\[eval\] (.*)$', text, re.M)
if not m or m.group(1) in ('nil', 'undefined'):
    print('  FAIL native checks did not run'); print(text[-800:]); sys.exit(1)
res = json.loads(json.loads(m.group(1)) if m.group(1).startswith('"') else m.group(1))
fails = list(res['fail'])
for p in res['pass']: print(f'  PASS {p}')
rows, bpp = read(png) if res['probes'] else (None, 0)
TOL = 40  # the filter technique costs saturation on vivid reds: 200,60,50 → ~181,73,64
for pr in res['probes']:
    x, y = int(pr['x'] * scale), int(pr['y'] * scale)
    got = tuple(rows[y][x * bpp:x * bpp + 3])
    dist = max(abs(a - b) for a, b in zip(got, pr['expect']))
    line = f"pixel: {pr['name']} keeps its real colors (got {got}, want ~{tuple(pr['expect'])})"
    if dist <= TOL: print(f'  PASS {line}')
    else: fails.append(line)
for f in fails: print(f'  FAIL {f}')
total = len(res['pass']) + len(res['fail']) + len(res['probes'])
print(f'  {total - len(fails)}/{total} native checks passed')
sys.exit(1 if fails else 0)
