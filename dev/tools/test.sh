#!/bin/sh
# Headless checks in WebKit (same engine as Safari):
#   1. syntax-check every extension script with JavaScriptCore
#   2. run dev/tests/tests.js against the real extension code
# Usage: dev/tools/test.sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${TMPDIR:-/tmp}/gesso-dev/webkit-run"; mkdir -p "$(dirname "$BIN")"
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc

echo "› Syntax check"
fail=0
for f in $(find "$ROOT/extension/src" -name '*.js'); do
  # jsc -e compiles without running: wrap the file in a never-called function.
  if ! "$JSC" -e "new Function(readFile('$f'))" >/dev/null 2>&1; then
    echo "  syntax error: ${f#$ROOT/}"; "$JSC" -e "new Function(readFile('$f'))" 2>&1 | head -3; fail=1
  fi
done
[ $fail -eq 0 ] && echo "  ok"

"$ROOT/dev/tools/gen-preview-scripts.sh"
if [ ! -x "$BIN" ] || [ "$ROOT/dev/tools/webkit-run.swift" -nt "$BIN" ]; then
  echo "› Compiling WebKit runner"
  swiftc -O -o "$BIN" "$ROOT/dev/tools/webkit-run.swift"
fi

echo "› Unit tests"
cd "$ROOT"
"$BIN" "dev/preview/index.html?test=1" --wait "window.__testResults" --eval "JSON.stringify(window.__testResults)" | grep -E 'FAIL|passed|\[eval\]|uncaught|unhandled' || true
# Interaction checks on the running app: palette, shortcuts, settings, popup summary.
echo "› UI checks"
# Offscreen WebKit stretches short timers to 1 s after a few seconds, so this needs more than the default 15 s.
UI_OUT="${TMPDIR:-/tmp}/gesso-dev/ui-checks.txt"
"$BIN" "dev/preview/index.html?uicheck=1&noanim=1&latency=0" --timeout 240 --wait "window.__uiChecks" --eval "JSON.stringify(window.__uiChecks)" > "$UI_OUT" 2>&1 || true
grep -E 'FAIL|\[eval\]|uncaught|unhandled|\[timeout\]' "$UI_OUT"
grep -q '"failed":0' "$UI_OUT" || fail=1
# Never blank: page replaced, document cleared, cache restore, dead extension, render errors.
echo "› Never-blank checks"
H_OUT="${TMPDIR:-/tmp}/gesso-dev/health-checks.txt"
"$BIN" "dev/preview/index.html?health=1&noanim=1&latency=0" --timeout 180 --wait "window.__healthChecks" --eval "JSON.stringify(window.__healthChecks)" > "$H_OUT" 2>&1 || true
grep -E 'FAIL|\[eval\]|uncaught|unhandled|\[timeout\]' "$H_OUT"
grep -q '"failed":0' "$H_OUT" || fail=1
# Accessibility audit: every route + main dialogs, dark and light.
echo "› Accessibility audit"
for t in dark light; do
  A11Y_OUT="${TMPDIR:-/tmp}/gesso-dev/a11y-$t.txt"
  "$BIN" "dev/preview/index.html?a11y=1&noanim=1&latency=0&theme=$t" --timeout 120 --wait "window.__a11y" --eval "window.__a11y.count" > "$A11Y_OUT" 2>&1 || true
  sed -n 's/^\[console\] error: \(A11Y .*\)/  \1/p' "$A11Y_OUT"
  if grep -q '^\[eval\] 0$' "$A11Y_OUT"; then echo "  [$t] no findings"; else echo "  [$t] FAIL"; fail=1; fi
done
# Toolbar popup renders from a real summary (and with none).
echo "› Popup"
for st in full empty; do
  "$BIN" "dev/preview/popup.html?state=$st" --wait "window.__popupReady" --eval "document.getElementById('app').innerText.length > 40 && !/undefined|NaN/.test(document.getElementById('app').innerText)" 2>/dev/null | grep -qE '^\[eval\] (true|1)$' && echo "  ok [$st]" || { echo "  FAIL popup [$st]"; fail=1; }
done
# Native-page dark mode: launcher visible, fixed elements in place,
# background-image photos kept natural (pixel-checked), in dark and light.
echo "› Native dark-mode checks"
for mode in "" "&light=1"; do
  OUT="${TMPDIR:-/tmp}/gesso-dev/native-check.txt"; PNG="${TMPDIR:-/tmp}/gesso-dev/native-check.png"
  "$BIN" "dev/preview/native.html?noanim=1&check=1$mode" --wait "window.__nativeChecks" --eval "JSON.stringify(window.__nativeChecks)" \
    --png "$PNG" --width 1100 --height 900 --full > "$OUT" 2>&1 || true
  echo "  [${mode:-dark}]"
  python3 "$ROOT/dev/tools/check-native.py" "$OUT" "$PNG" 2 || fail=1
done
exit $fail
