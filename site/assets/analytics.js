// Counting, not tracking: one anonymous "view" per page load of the landing page, on the live site only
// (overdubstudio.com over https), and nothing at all when the browser sends Do Not Track or Global Privacy Control.
// It is one GET of /site/e.gif?e=view, plus r = the referring site's host when there is one (no path, no query).
// No cookies, nothing stored, no ids, no third parties, no retries. CloudFront's access log is the pipeline;
// tools/stats.sh reads it with Athena. The studio counts a few more things: app/src/analytics.js.

const HOST = 'overdubstudio.com';

export function optedOut(nav = navigator, win = window) {
  try {
    const dnt = nav.doNotTrack ?? win.doNotTrack ?? nav.msDoNotTrack;
    return dnt === '1' || dnt === 'yes' || dnt === 1 || nav.globalPrivacyControl === true;
  } catch (e) {
    return true;
  }
}

export function referrerHost(ref) {
  if (!ref) return '';
  try {
    const h = new URL(ref).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]{1,64}$/.test(h) ? h : '';
  } catch (e) {
    return '';
  }
}

(function view() {
  try {
    if (location.hostname !== HOST || location.protocol !== 'https:' || navigator.webdriver || optedOut()) return;
    const q = new URLSearchParams({ e: 'view' });
    const r = referrerHost(document.referrer);
    if (r) q.set('r', r);
    const url = '/site/e.gif?' + q;
    (window.__overdub_site_counts = window.__overdub_site_counts || []).push(url);
    fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      keepalive: true,
    }).catch(() => {});
  } catch (e) {
    /* never let counting break the page */
  }
})();
