#!/bin/sh
# Re-render benchmark: median and max render time per route, measured
# by the app itself (Gesso.diagnostics.renders) over 6 store updates.
# Usage: dev/tools/perf.sh [scale]   (scale = N× the mock assignments; default 1)
# Run dev/tools/test.sh once first (it compiles the WebKit runner).
BIN="${TMPDIR:-/tmp}/gesso-dev/webkit-run"
cd "$(dirname "$0")/../.."
SCALE="${1:-1}"
for r in / /assignments /calendar /calendar/month /grades /courses/101 /courses/101/assignments; do
  "$BIN" "dev/preview/index.html?noanim=1&latency=0&scale=$SCALE&route=$r" --timeout 60 \
    --wait "window.__ready && window.__ready() && (window.__go ||= (async () => { for (let i = 0; i < 6; i++) { Gesso.store.set({ visit: { ...Gesso.store.get().visit } }); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); } window.__done = 1; })(), 1) && window.__done" \
    --eval "(() => { const r = Gesso.diagnostics.renders.slice(-6).map((x) => x.ms).sort((a, b) => a - b); const n = Gesso.derive.workItems(Gesso.store.get().data).length; return '$r items=' + n + ' median=' + r[3] + 'ms max=' + r[5] + 'ms'; })()" 2>&1 | sed -n 's/^\[eval\] /  /p'
done
