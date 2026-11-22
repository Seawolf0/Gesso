// @ts-check
/**
 * Background service worker: keeps the toolbar badge current.
 *
 * The badge shows how many items are due within 48 hours, counted from the
 * summary the Canvas tab writes after each sync (`popup.summary`, see
 * content/data/summary.js). It's recounted when that summary changes, when
 * Safari starts, and every 5 minutes (an alarm), because items cross the
 * 48-hour line as time passes.
 *
 * Clicking the toolbar button opens the popup (manifest `action.default_popup`),
 * so `action.onClicked` no longer fires.
 *
 * Deliberately no network requests here: Safari can omit session cookies on
 * extension background fetches (notably in non-default Safari profiles), so
 * all Canvas API traffic goes through the content script on the Canvas tab.
 *
 * Safari (MDN browser-compat-data, checked 2026-11-20): setBadgeText 15.4+,
 * alarms 14+, storage.onChanged 14+. setBadgeBackgroundColor exists but has
 * no effect (webkit.org/b/267662), so the badge can't use color.
 */
const api = /** @type {any} */ (globalThis).browser || /** @type {any} */ (globalThis).chrome;

const SUMMARY_KEY = 'popup.summary';
const ALARM = 'badge';
const HOURS = 48;

/** Items due from now to now + 48 h. Shared logic with the popup (kept tiny on purpose). */
function dueSoonCount(/** @type {any} */ summary, now = Date.now()) {
  if (!summary || !Array.isArray(summary.items)) return 0;
  const end = now + HOURS * 3_600_000;
  return summary.items.filter((/** @type {any} */ i) => {
    const t = Date.parse(i.dueAt);
    return Number.isFinite(t) && t >= now && t < end;
  }).length;
}

async function refreshBadge() {
  try {
    const { [SUMMARY_KEY]: summary } = await api.storage.local.get(SUMMARY_KEY);
    const n = dueSoonCount(summary);
    await api.action.setBadgeText({ text: n > 0 ? String(n > 99 ? '99+' : n) : '' });
    const title = !summary ? 'Gesso: open Canvas once to load your work'
      : summary.loggedOut ? 'Gesso: logged out of Canvas'
        : n ? `Gesso: ${n} due in the next 48 hours` : 'Gesso: nothing due in the next 48 hours';
    await api.action.setTitle({ title });
  } catch (err) {
    console.warn('[Gesso] badge update failed', err);
  }
}

function ensureAlarm() {
  try {
    Promise.resolve(api.alarms.get(ALARM)).then((a) => { if (!a) api.alarms.create(ALARM, { periodInMinutes: 5 }); });
  } catch { /* alarms unavailable: the badge still updates on every sync */ }
}

api.storage.onChanged.addListener((/** @type {any} */ changes, /** @type {string} */ area) => {
  if (area === 'local' && changes[SUMMARY_KEY]) refreshBadge();
});
api.alarms?.onAlarm.addListener((/** @type {any} */ alarm) => { if (alarm.name === ALARM) refreshBadge(); });
api.runtime.onStartup?.addListener(() => { ensureAlarm(); refreshBadge(); });
api.runtime.onInstalled?.addListener(() => { ensureAlarm(); refreshBadge(); });

// A worker can start for any event; make sure the alarm and badge exist.
ensureAlarm();
refreshBadge();
