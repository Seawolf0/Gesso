#!/bin/sh
# Screenshots of every built-in theme, in dark and light, on every main view
# (plus the popup, a dialog and the ⌘K palette), and one contact sheet per
# theme. Runs the dev preview against mock data in headless WebKit.
#
# Usage: dev/tools/theme-shots.sh [out-dir] [theme ...]
#   out-dir defaults to $TMPDIR/gesso-dev/theme-shots; themes default to every preset in shared/themes.js.
# Run dev/tools/test.sh once first: it builds the headless runner.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${TMPDIR:-/tmp}/gesso-dev/webkit-run"
OUT="${1:-${TMPDIR:-/tmp}/gesso-dev/theme-shots}"
[ $# -gt 0 ] && shift
THEMES="${*:-$(sed -n "s/^ *id: '\([a-z0-9]*\)', group: .*/\1/p" "$ROOT/extension/src/shared/themes.js")}"
mkdir -p "$OUT"
[ -x "$BIN" ] || { echo "Run dev/tools/test.sh first (it builds $BIN)."; exit 1; }
cd "$ROOT"

SR="document.getElementById('host').shadowRoot"
READY="window.__ready && window.__ready() && !$SR.querySelector('main .skel') && (window.__t ||= Date.now()) && Date.now() - window.__t > 700"

# name|route|extra wait condition (side effects guarded with ||=)
VIEWS='dashboard|/|true
assignments|/assignments|true
calendar|/calendar|true
course|/courses/101|true
grades|/grades|true
detail|/courses/101/assignments/1|true
settings|/settings|true
dialog|/courses|(window.__d ||= (Gesso.courseSettings.open(Gesso.store.get().data.courses[0]), 1)) && !!SR.querySelector("dialog[open]")
palette|/|(window.__p ||= (Gesso.palette.show(), 1)) && !!SR.querySelector("dialog[open]")'

jobs="$OUT/jobs.txt"; : > "$jobs"
for theme in $THEMES; do
  for mode in dark light; do
    echo "$VIEWS" | while IFS='|' read -r name route extra; do
      extra="$(printf '%s' "$extra" | sed "s/SR\./$SR./g")"
      printf '%s\t%s\t%s\t%s\t%s\n' "$theme" "$mode" "$name" "$route" "$extra" >> "$jobs"
    done
    printf '%s\t%s\tpopup\t-\t-\n' "$theme" "$mode" >> "$jobs"
  done
done

shoot() {
  theme="$1"; mode="$2"; name="$3"; route="$4"; extra="$5"
  png="$OUT/$theme-$mode-$name.png"
  if [ "$name" = popup ]; then
    "$BIN" "dev/preview/popup.html?themeId=$theme&theme=$mode" --wait "window.__popupReady" --png "$png" --width 340 --height 470 >/dev/null 2>&1
  else
    "$BIN" "dev/preview/index.html?noanim=1&latency=0&themeId=$theme&theme=$mode&route=$route" \
      --wait "$READY && ($extra)" --png "$png" --width 1440 --height 900 --timeout 40 >/dev/null 2>&1
  fi
  [ -s "$png" ] && echo "  $theme $mode $name" || echo "  FAILED $theme $mode $name"
}

echo "› Screenshots ($(wc -l < "$jobs" | tr -d ' '))"
# Six at a time; each runner is its own WebKit process.
while IFS="$(printf '\t')" read -r theme mode name route extra; do
  shoot "$theme" "$mode" "$name" "$route" "$extra" &
  while [ "$(jobs -r | wc -l)" -ge 6 ]; do sleep 0.2; done
done < "$jobs"
wait

echo "› Contact sheets"
for theme in $THEMES; do
  html="$OUT/sheet-$theme.html"
  {
    printf '<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:40px;background:#1c1c1e;color:#eee;font:15px -apple-system,system-ui;width:2320px}h1{font-size:28px;margin:0 0 6px}h2{font-size:18px;margin:28px 0 12px;color:#bbb;font-weight:600}.g{display:grid;grid-template-columns:repeat(5,440px);gap:18px}.c{margin:0}.c img{display:block;width:100%%;border-radius:8px;box-shadow:0 0 0 1px #333}.c.p img{width:auto;height:248px}.c figcaption{font-size:13px;color:#999;margin-top:6px}</style>'
    printf '<h1>%s</h1>' "$theme"
    for mode in dark light; do
      printf '<h2>%s</h2><div class="g">' "$mode"
      for name in dashboard assignments calendar course grades detail settings dialog palette popup; do
        cls=c; [ "$name" = popup ] && cls="c p"
        printf '<figure class="%s"><img src="%s-%s-%s.png"><figcaption>%s</figcaption></figure>' "$cls" "$theme" "$mode" "$name" "$name"
      done
      printf '</div>'
    done
  } > "$html"
  "$BIN" "$html" --wait "[...document.images].every((i) => i.complete)" --png "$OUT/sheet-$theme.png" --width 2400 --height 1400 --full >/dev/null 2>&1 \
    && echo "  $OUT/sheet-$theme.png"
done

# One overview: every theme's dashboard and calendar, dark and light.
html="$OUT/sheet-overview.html"
{
  printf '<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:40px;background:#1c1c1e;color:#eee;font:15px -apple-system,system-ui;width:2320px}h1{font-size:28px;margin:0 0 20px}.r{display:grid;grid-template-columns:140px repeat(4,535px);gap:16px;align-items:center;margin-bottom:16px}.r b{font-size:18px}.r img{display:block;width:100%%;border-radius:8px;box-shadow:0 0 0 1px #333}.h{color:#999;font-size:13px}</style><h1>Gesso themes</h1>'
  printf '<div class="r h"><span></span><span>dark · dashboard</span><span>dark · calendar</span><span>light · dashboard</span><span>light · calendar</span></div>'
  for theme in $THEMES; do
    printf '<div class="r"><b>%s</b>' "$theme"
    for shot in dark-dashboard dark-calendar light-dashboard light-calendar; do printf '<img src="%s-%s.png">' "$theme" "$shot"; done
    printf '</div>'
  done
} > "$html"
"$BIN" "$html" --wait "[...document.images].every((i) => i.complete)" --png "$OUT/sheet-overview.png" --width 2400 --height 1400 --full >/dev/null 2>&1 \
  && echo "  $OUT/sheet-overview.png"
