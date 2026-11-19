/*!
 * Sitemap Link Checker
 * Checks every link in a sitemap from inside the browser, on the site being tested, and reports
 * which links open a real page, redirect, or land on a not-found, empty or error page.
 * MIT License.
 */
(function () {
  if (typeof window !== 'undefined' && window.__sitemapLinkChecker) { window.__sitemapLinkChecker.show(); return; }

  var DEFAULT_PHRASES = [
    'cannot find what you are looking for',
    'we cannot find the product',
    'technical error',
    'page not found',
    'no results were found',
    'no results found',
    'products (0)',
    'we couldn’t find',
    "we couldn't find"
  ];
  var CONCURRENCY = 3;
  var MAX_BYTES = 800000;
  var NO_CODE = 'No code';
  var GENTLE_DELAY = 1500;
  // this many blocked links in a row pauses the run, so a bot check is not hammered
  var PAUSE_AFTER = 3;
  // a page with less visible text than this is reported as nearly empty
  var THIN_TEXT = 150;
  // a page that takes longer than this to arrive is reported as slow
  var SLOW_MS = 3000;
  // wording in a page title or main heading that marks a not-found or error page on any kind of site
  var NOT_FOUND_TITLE = /\b404\b|not found|can(?:no|')t be found|could(?:n't| not) be found|does(?:n't| not) exist|no longer (?:available|exists)|page (?:is )?missing/;
  var ERROR_TITLE = /^\s*(?:error|oops)\b|something went wrong|server error|internal error|unexpected error|application error/;
  // wording a bot-check page shows to a person
  var BLOCK_TEXT = [
    'press & hold',
    'press and hold',
    'verify you are human',
    'verify you are a human',
    'verifying you are human',
    'are you a robot',
    'access to this page has been denied'
  ];
  // markup that only appears on a bot-check page, for checks drawn by a script
  var BLOCK_HTML = ['px-captcha', 'captcha-delivery.com', 'challenge-error-text'];

  // ---------- helpers
  // the part of the path every page of the site shares ('' on most sites)
  function sitePrefix() {
    var m = location.pathname.match(/^\/s\/[^/]+/);
    return m ? m[0] : '';
  }
  function siteRoot() { return location.origin + sitePrefix(); }

  /**
   * Turns what was typed in the sitemap field into an address on the current site.
   * @param {string} value - a path such as "/sitemap.xml", or a full address pasted in
   * @param {string} origin - the origin of the site being tested, for example "https://shop.example"
   * @returns {{url: string, path: string, error: string}} the address to load and the path to show, or an error
   */
  function sitemapAddress(value, origin) {
    var v = String(value || '').trim();
    if (!v) { return { url: '', path: '', error: 'Enter the path of a sitemap, for example /sitemap.xml' }; }
    if (/^https?:\/\//i.test(v)) {
      var full;
      try { full = new URL(v); } catch (e) { return { url: '', path: v, error: 'That is not a valid address.' }; }
      if (full.origin !== origin) { return { url: '', path: v, error: 'That sitemap is on a different site (' + full.origin + '). Open that site and run the checker there.' }; }
      v = full.pathname + full.search;
    }
    if (v.charAt(0) !== '/') { v = '/' + v; }
    return { url: origin + v, path: v, error: '' };
  }
  function norm(u) {
    try { var x = new URL(u, typeof location !== 'undefined' ? location.href : undefined); return (x.origin + decodeURI(x.pathname).replace(/\/+$/, '')).toLowerCase(); } catch (e) { return String(u).toLowerCase(); }
  }
  function isHome(u) {
    try {
      var x = new URL(u), p = x.pathname.replace(/\/+$/, '');
      return p === '' || /^\/s\/[^/]+$/.test(p) || /\/home(-show)?$/i.test(p) || /Home-Show$/i.test(p);
    } catch (e) { return false; }
  }
  function isLogin(u) {
    try { return /(^|[\/\-_])(login|log-in|signin|sign-in|sso)([\/\-_.]|$)/i.test(new URL(u).pathname); } catch (e) { return false; }
  }
  function pathKey(u) {
    try { return decodeURI(new URL(u).pathname).replace(/\/+$/, '').toLowerCase(); } catch (e) { return String(u).toLowerCase(); }
  }
  function attr(tag, name) {
    var m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    return m ? (m[1] || m[2] || m[3] || '').trim() : '';
  }
  function markup(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' '); }

  /**
   * The address a page names as its canonical one.
   * @param {string} html - the page's HTML
   * @param {string} baseUrl - the page's own address, to resolve a relative canonical against
   * @returns {string} the absolute canonical address, or '' when the page names none
   */
  function canonicalOf(html, baseUrl) {
    var tags = markup(html).match(/<link\b[^>]*>/gi) || [];
    for (var i = 0; i < tags.length; i++) {
      if (attr(tags[i], 'rel').toLowerCase().split(/\s+/).indexOf('canonical') > -1 && attr(tags[i], 'href')) {
        try { return new URL(attr(tags[i], 'href').replace(/&amp;/g, '&'), baseUrl).href; } catch (e) { return ''; }
      }
    }
    return '';
  }

  /**
   * The robots instructions in a page's meta tags.
   * @param {string} html - the page's HTML
   * @returns {string} the instructions, lower case, joined with commas ('' when there are none)
   */
  function robotsOf(html) {
    return (markup(html).match(/<meta\b[^>]*>/gi) || [])
      .filter(function (tag) { return /^(robots|googlebot)$/i.test(attr(tag, 'name')); })
      .map(function (tag) { return attr(tag, 'content').toLowerCase(); }).join(',');
  }

  /**
   * Whether a page is the same one the site shows for an address that does not exist.
   * @param {Object} info - title, heading and text of the page being checked
   * @param {?Object} missing - title, heading (lower case) and text length of the site's not-found page
   * @returns {boolean} true when the two match
   */
  function sameAsNotFound(info, missing) {
    if (!missing) { return false; }
    var title = (info.title || '').toLowerCase(), heading = (info.heading || '').toLowerCase();
    if ((!title && !heading) || title !== missing.title || heading !== missing.heading) { return false; }
    return Math.abs((info.text || '').length - missing.length) <= Math.max(200, missing.length * 0.2);
  }

  function visibleText(html) {
    return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<template[\s\S]*?<\/template>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
  }
  function decode(text) { try { return new DOMParser().parseFromString(text, 'text/html').documentElement.textContent; } catch (e) { return text; } }
  function pick(html, re) { var m = html.match(re); return m ? decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 120) : ''; }
  function csvCell(v) { v = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

  async function getText(url) {
    var res = await fetch(url, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
    var text = await res.text();
    return { res: res, text: text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text };
  }
  function locs(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    var isIndex = doc.documentElement && /sitemapindex/i.test(doc.documentElement.nodeName);
    var list = Array.prototype.map.call(doc.getElementsByTagName('loc'), function (n) { return n.textContent.trim(); });
    if (!list.length) { list = (xmlText.match(/<loc>\s*([^<]+?)\s*<\/loc>/gi) || []).map(function (s) { return s.replace(/<\/?loc>/gi, '').trim(); }); }
    return { isIndex: isIndex, list: list };
  }

  /**
   * Decides what happened to one link. Pure: no network, no DOM.
   * @param {Object} info
   * @param {string} info.requestedUrl - the link from the sitemap
   * @param {string} info.finalUrl - the address the browser ended on
   * @param {number} info.status - HTTP status of the final response
   * @param {boolean} info.redirected - whether the browser followed a redirect
   * @param {string} info.text - visible text of the page, lower case
   * @param {string[]} info.phrases - lower-case phrases that mark a not-found, empty or error page
   * @param {string} [info.html] - the page's HTML, lower case, used to spot bot checks drawn by a script
   * @param {string} [info.title] - the page title
   * @param {string} [info.heading] - the page's main heading
   * @param {string} [info.canonical] - the canonical address the page names
   * @param {string} [info.robots] - robots instructions from the meta tags and the response header, lower case
   * @param {boolean} [info.isHtml] - false when the response is not a web page (a PDF, a download)
   * @param {number} [info.ms] - how long the page took to arrive, in milliseconds
   * @param {?Object} [info.notFoundPage] - what the site's not-found page looks like, see sameAsNotFound
   * @returns {{result: string, note: string}} the outcome
   */
  function classify(info) {
    var hit = (info.phrases || []).filter(function (p) { return p && info.text.indexOf(p) > -1; })[0];
    var redirected = info.redirected && norm(info.finalUrl) !== norm(info.requestedUrl);

    var text = info.text || '', html = info.html || '';
    var wall = BLOCK_TEXT.filter(function (p) { return text.indexOf(p) > -1; })[0] || BLOCK_HTML.filter(function (p) { return html.indexOf(p) > -1; })[0];

    if (wall) { return { result: 'Blocked', note: 'The site showed a bot check ("' + wall + '")' }; }
    if (info.status >= 500) { return { result: 'Error', note: 'The site returned an error (' + info.status + ')' }; }
    if (info.status === 404 || info.status === 410) { return { result: 'Not found', note: 'The site answered ' + info.status }; }
    if (info.status === 401) { return { result: 'Sign-in needed', note: 'The site asked for a sign-in (401)' }; }
    if (info.status === 403) { return { result: 'Blocked', note: 'Not allowed (403). The site wants a sign-in or a bot check.' }; }
    if (info.status === 429) { return { result: 'Blocked', note: 'Too many requests (429). Try the gentle pace.' }; }
    if (hit) {
      return {
        result: /error/.test(hit) ? 'Error' : (/no results|\(0\)/.test(hit) ? 'No results' : 'Not found'),
        note: 'Page says: "' + hit + '"'
      };
    }
    if (sameAsNotFound(info, info.notFoundPage)) { return { result: 'Not found', note: 'Same page the site shows for an address that does not exist' }; }
    var named = [info.title, info.heading].filter(Boolean).map(function (t) { return t.toLowerCase().replace(/\u2019/g, "'"); });
    var says = named.filter(function (t) { return NOT_FOUND_TITLE.test(t); })[0];
    if (says) { return { result: 'Not found', note: 'Title says: "' + says + '"' }; }
    says = named.filter(function (t) { return ERROR_TITLE.test(t); })[0];
    if (says) { return { result: 'Error', note: 'Title says: "' + says + '"' }; }
    if (redirected && isLogin(info.finalUrl) && !isLogin(info.requestedUrl)) { return { result: 'Sign-in needed', note: 'Sent to a sign-in page' }; }
    if (redirected && isHome(info.finalUrl)) { return { result: 'Redirect to home', note: 'Sent to the home page' }; }
    if (redirected) { return { result: 'Redirect', note: 'Sent to a different address' }; }
    if (info.status >= 400) { return { result: 'Error', note: 'The site answered ' + info.status }; }
    if (redirected || info.isHtml === false) { return { result: 'OK', note: '' }; }

    // the page loaded; these are signs it still does not belong in the sitemap as it stands
    var warnings = [];
    if (/noindex/.test(info.robots || '')) { warnings.push('Marked noindex, so it does not belong in a sitemap'); }
    if (info.canonical && pathKey(info.canonical) !== pathKey(info.finalUrl) && pathKey(info.canonical) !== pathKey(info.requestedUrl)) {
      warnings.push(isHome(info.canonical) ? 'Canonical points to the home page' : 'Canonical points to a different address: ' + info.canonical);
    }
    if (info.title !== undefined && !info.title && !info.heading) { warnings.push('No title and no main heading'); }
    if (text.trim().length < THIN_TEXT) { warnings.push('Almost no text on the page. If scripts draw the page, the checker cannot see it'); }
    if (info.ms >= SLOW_MS) { warnings.push('Slow: took ' + duration(info.ms)); }
    if (warnings.length) { return { result: 'Warning', note: warnings.join('. ') + '.' }; }
    return { result: 'OK', note: '' };
  }

  // checked address -> the address the sitemap listed, for links moved onto this site
  var listedAs = {};

  async function checkOne(url, phrases, notFoundPage) {
    var row = { url: url, listed: listedAs[url] || '', result: '', status: '', ms: '', finalUrl: '', title: '', heading: '', canonical: '', note: '' };
    var target;
    try { target = new URL(url, location.href); } catch (e) { row.result = 'Error'; row.note = 'Not a valid link'; return row; }
    if (target.origin !== location.origin) { row.result = 'Skipped'; row.note = 'Different site (' + target.origin + '). Run the checker on that site, or choose to check these links on this site.'; return row; }
    try {
      var began = Date.now();
      var got = await getText(target.href);
      var res = got.res, html = got.text;
      row.ms = Date.now() - began;
      row.status = res.status;
      row.finalUrl = res.url;
      row.title = pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      row.heading = pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
      var kind = (res.headers.get('content-type') || '').toLowerCase(), isHtml = !kind || /html|xml/.test(kind);
      row.canonical = isHtml ? canonicalOf(html, res.url) : '';
      var outcome = classify({
        requestedUrl: target.href,
        finalUrl: res.url,
        status: res.status,
        redirected: res.redirected,
        text: visibleText(html).toLowerCase(),
        html: html.toLowerCase(),
        title: row.title,
        heading: row.heading,
        canonical: row.canonical,
        robots: (isHtml ? robotsOf(html) : '') + ',' + (res.headers.get('x-robots-tag') || '').toLowerCase(),
        isHtml: isHtml,
        ms: row.ms,
        notFoundPage: notFoundPage,
        phrases: phrases
      });
      row.result = outcome.result;
      row.note = outcome.note;
    } catch (e) {
      row.result = 'Error'; row.note = 'Could not load: ' + (e && e.message ? e.message : e);
    }
    return row;
  }

  /**
   * Whether a row was stopped by a sign-in or a bot check, so a person has to step in before it can be rechecked.
   * @param {Object} row - a result row
   * @returns {boolean} true for Blocked and Sign-in needed rows
   */
  function needsHuman(row) { return row.result === 'Blocked' || row.result === 'Sign-in needed'; }

  /**
   * The status code a row is grouped under in the status code filter.
   * @param {Object} row - a result row
   * @returns {string} the HTTP status as text, or "No code" when the link was never loaded
   */
  function codeOf(row) { return row.status ? String(row.status) : NO_CODE; }

  /**
   * Orders status codes for the filter buttons: error codes (400 and up) first, then the rest, then "No code".
   * @param {string[]} codes - status codes as text
   * @returns {string[]} a sorted copy
   */
  function sortCodes(codes) {
    function rank(c) { return c === NO_CODE ? 2 : (+c >= 400 ? 0 : 1); }
    return codes.slice().sort(function (a, b) { return rank(a) - rank(b) || (+a || 0) - (+b || 0); });
  }

  /**
   * The short summary of the chosen status codes shown on the closed status code menu.
   * @param {string[]} codes - the chosen status codes as text
   * @returns {string} "All", the codes themselves, or the first two and a count of the rest
   */
  function codePreview(codes) {
    var list = sortCodes(codes || []);
    if (!list.length) { return 'All'; }
    return list.length <= 3 ? list.join(', ') : list.slice(0, 2).join(', ') + ' +' + (list.length - 2);
  }

  /**
   * Whether a row passes the filters in the panel. Pure: no DOM.
   * @param {Object} row - a result row
   * @param {Object} f
   * @param {string} [f.result] - a result name, or "All"
   * @param {string[]} [f.codes] - status codes as text ("No code" included); empty means every code
   * @param {string} [f.q] - text to find in the link, final address, title, heading or note
   * @returns {boolean} true when the row should be shown
   */
  function matches(row, f) {
    if (f.result && f.result !== 'All' && row.result !== f.result) { return false; }
    if (f.codes && f.codes.length && f.codes.indexOf(codeOf(row)) === -1) { return false; }
    var q = (f.q || '').trim().toLowerCase();
    if (q && [row.url, row.finalUrl, row.title, row.heading, row.note].join(' ').toLowerCase().indexOf(q) === -1) { return false; }
    return true;
  }

  /**
   * Asks the site for an address that cannot exist, to learn what its not-found page looks like.
   * Only sites that answer 200 for a missing page need this; the others are caught by their status code.
   * @returns {Promise<?Object>} title, heading and text length of that page, or null when there is nothing to compare with
   */
  async function learnNotFoundPage() {
    try {
      var fake = siteRoot() + '/not-a-real-page-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var got = await getText(fake);
      if (got.res.status !== 200 || norm(got.res.url) !== norm(fake)) { return null; }
      var title = pick(got.text, /<title[^>]*>([\s\S]*?)<\/title>/i).toLowerCase(), heading = pick(got.text, /<h1[^>]*>([\s\S]*?)<\/h1>/i).toLowerCase();
      var text = visibleText(got.text);
      if (BLOCK_TEXT.concat(BLOCK_HTML).some(function (p) { return got.text.toLowerCase().indexOf(p) > -1; })) { return null; }
      return title || heading ? { title: title, heading: heading, length: text.length } : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * The same address on another site: used to check a production sitemap's links on a staging site.
   * @param {string} url - an absolute address
   * @param {string} origin - the origin to move it to, for example "https://staging.shop.example"
   * @returns {string} the address with its origin replaced, or the address unchanged when it is already there or not valid
   */
  function swapOrigin(url, origin) {
    try { var u = new URL(url); return u.origin === origin ? url : origin + u.pathname + u.search + u.hash; } catch (e) { return url; }
  }

  /**
   * Counts the links that are not on the site being tested.
   * @param {string[]} links - absolute addresses
   * @param {string} origin - the origin of the site being tested
   * @returns {{count: number, host: string, hosts: number}} how many, the most common other host, and how many other hosts there are
   */
  function otherSites(links, origin) {
    var seen = {}, count = 0;
    (links || []).forEach(function (link) {
      try { var u = new URL(link); if (u.origin !== origin) { count++; seen[u.host] = (seen[u.host] || 0) + 1; } } catch (e) { /* not a link */ }
    });
    var hosts = Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a]; });
    return { count: count, host: hosts[0] || '', hosts: hosts.length };
  }

  /**
   * A response time for display.
   * @param {number} ms - milliseconds
   * @returns {string} for example "420 ms" or "3.4 s"
   */
  function duration(ms) { return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(1) + ' s'; }

  /**
   * The sitemap addresses a robots.txt file declares.
   * @param {string} text - the contents of robots.txt
   * @returns {string[]} the addresses on its "Sitemap:" lines, in order
   */
  function robotsSitemaps(text) {
    return (String(text || '').match(/^[ \t]*sitemap[ \t]*:[ \t]*\S+/gim) || []).map(function (line) { return line.replace(/^[ \t]*sitemap[ \t]*:[ \t]*/i, ''); });
  }

  /**
   * Chooses the sitemap to suggest from the addresses found for a site.
   * Only addresses on the site itself can be read; an index is preferred because it leads to the rest.
   * @param {string[]} list - candidate addresses, absolute or relative
   * @param {string} origin - the origin of the site being tested
   * @returns {string} the path (and query) of the chosen sitemap, or '' when none can be used
   */
  function pickSitemap(list, origin) {
    var usable = (list || []).map(function (u) { try { return new URL(u, origin + '/'); } catch (e) { return null; } })
      .filter(function (u) { return u && u.origin === origin && !/\.gz$/i.test(u.pathname); });
    var best = usable.filter(function (u) { return /index/i.test(u.pathname); })[0] || usable[0];
    return best ? best.pathname + best.search : '';
  }

  // Node (tests): expose the pure helpers and stop before any DOM work.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { classify: classify, sitemapAddress: sitemapAddress, robotsSitemaps: robotsSitemaps, swapOrigin: swapOrigin, otherSites: otherSites, duration: duration, pickSitemap: pickSitemap, norm: norm, isHome: isHome, visibleText: visibleText, csvCell: csvCell, isLogin: isLogin, canonicalOf: canonicalOf, robotsOf: robotsOf, sameAsNotFound: sameAsNotFound, needsHuman: needsHuman, codeOf: codeOf, sortCodes: sortCodes, codePreview: codePreview, matches: matches, DEFAULT_PHRASES: DEFAULT_PHRASES };
    return;
  }

  // ---------- panel
  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}',
    '.wrap{position:fixed;inset:0;background:rgba(10,16,22,.55);display:flex;justify-content:center;align-items:flex-start;padding:24px 16px;overflow:auto}',
    '.panel{background:#fff;color:#16202a;width:min(1180px,100%);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:20px 22px 24px;font-size:14px;line-height:1.45}',
    'h2{font-size:17px;margin:0;display:flex;align-items:center;gap:10px}',
    'h2 svg{flex:none;border-radius:22%}',
    '.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}',
    'label{display:block;font-weight:600;margin:12px 0 4px}',
    '.swap{display:flex;gap:8px;align-items:flex-start;font-weight:400;margin:8px 0 0;padding:9px 12px;border:1px solid #e8c88a;background:#fff8e8;border-radius:8px}',
    'td.slow{color:#b26a00;font-weight:600}',
    '.between{justify-content:space-between;margin-bottom:8px}.sec{font-weight:600}',
    '.help{margin:6px 0 0;color:#5b6875;font-size:13px}.help strong{color:#16202a}',
    '#panePaste textarea{min-height:104px}',
    '.opts{margin-top:12px;border:1px solid #e1e5ea;border-radius:8px}.opts summary{padding:9px 12px}',
    '.optbody{display:grid;grid-template-columns:minmax(220px,1fr) minmax(260px,1.4fr);gap:8px 24px;padding:0 12px 14px;border-top:1px solid #eef1f4}',
    '.optbody textarea{min-height:120px}',
    '@media (max-width:720px){.optbody{grid-template-columns:1fr}}',
    'select{font:inherit;padding:7px 8px;border:1px solid #c4ccd4;border-radius:8px;color:#16202a;background:#fff}',
    '.gate{margin:12px 0 14px;padding:12px 14px;border:1px solid #e8c88a;background:#fff8e8;border-radius:8px}',
    '.gate ol{margin:6px 0 10px;padding-left:20px}.gate li{margin:2px 0;word-break:break-word}',
    '.addr{display:flex;align-items:stretch;border:1px solid #c4ccd4;border-radius:8px;overflow:hidden;background:#fff}',
    '.addr:focus-within{outline:2px solid #0b5cad;outline-offset:1px}',
    '.addr span{display:flex;align-items:center;padding:0 10px;background:#f1f4f7;color:#5b6875;border-right:1px solid #c4ccd4;white-space:nowrap;max-width:60%;overflow:hidden;text-overflow:ellipsis}',
    '.addr input[type=text]{border:0;border-radius:0;flex:1;min-width:140px;outline:0}',
    'input[type=text],textarea{width:100%;font:inherit;padding:8px 10px;border:1px solid #c4ccd4;border-radius:8px;color:#16202a;background:#fff}',
    'textarea{min-height:72px;resize:vertical}',
    'button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #c4ccd4;background:#fff;color:#16202a;cursor:pointer}',
    'button.primary{background:#0b5cad;border-color:#0b5cad;color:#fff;font-weight:600}',
    'button:disabled{opacity:.5;cursor:default}',
    'button.on{background:#16202a;border-color:#16202a;color:#fff}',
    '.seg{display:inline-flex;flex-wrap:wrap;border:1px solid #c4ccd4;border-radius:8px;overflow:hidden;background:#fff}',
    '.seg button{border:0;border-radius:0;box-shadow:1px 0 0 #e1e5ea,0 1px 0 #e1e5ea}',
    '.seg button:focus-visible{outline-offset:-2px}',
    '.dd{position:relative;margin-left:auto}',
    '.dd>button{font-variant-numeric:tabular-nums}',
    '.menu{position:absolute;right:0;top:calc(100% + 4px);z-index:5;min-width:200px;max-height:280px;overflow:auto;background:#fff;border:1px solid #c4ccd4;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:6px}',
    '.menu label{display:flex;gap:8px;align-items:center;font-weight:400;margin:0;padding:5px 8px;border-radius:6px;cursor:pointer;font-variant-numeric:tabular-nums}',
    '.menu label:hover{background:#f1f4f7}.menu label.bad{color:#c62828}',
    '.menu button{width:100%;margin-top:4px;padding:5px 8px;font-size:13px}',
    '.results{margin-top:12px;border:1px solid #e1e5ea;border-radius:8px;overflow:hidden}',
    '#find{padding:8px;background:#f6f8fa;border-bottom:1px solid #e1e5ea}',
    '#find input[type=text]{padding:6px 10px}#find button{padding:6px 12px}#shown{padding:0 4px}',
    '[hidden]{display:none!important}',
    'td.r{white-space:nowrap}',
    '.by{margin-top:10px;text-align:right;font-size:11px;color:#a9b2bc}.by a{color:inherit;text-decoration:none}.by a:hover{color:#5b6875;text-decoration:underline}',
    'td.s{white-space:nowrap;font-variant-numeric:tabular-nums}td.s.bad{color:#c62828;font-weight:600}',
    'td.none{text-align:center;padding:18px 8px;color:#5b6875}',
    '.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.grow{flex:1 1 320px}',
    '.muted{color:#5b6875}',
    '.files{margin:8px 0;max-height:150px;overflow:auto;border:1px solid #e1e5ea;border-radius:8px;padding:8px 10px}',
    '.files.hint{color:#5b6875;background:#f8f9fb;border-style:dashed;padding:12px}',
    '.files label{font-weight:400;margin:2px 0;display:flex;gap:8px;align-items:center}',
    '.bar{height:8px;background:#e9edf1;border-radius:4px;overflow:hidden;margin:10px 0 6px}',
    '.bar i{display:block;height:100%;width:0;background:#0b5cad}',
    '.scroll{overflow:auto;max-height:52vh}',
    'table{border-collapse:collapse;width:100%;font-size:13px}',
    'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eef1f4;vertical-align:top}',
    'th{position:sticky;top:0;background:#f6f8fa;font-weight:600;border-bottom-color:#e1e5ea}',
    'td.u{max-width:420px;word-break:break-all}',
    'a{color:#0b5cad}',
    '.OK{color:#1a7f37;font-weight:600}.Blocked,.Sign-in-needed,.Warning,.Redirect,.Redirect-to-home,.Skipped{color:#b26a00;font-weight:600}.Not-found,.No-results,.Error{color:#c62828;font-weight:600}',
    'details{margin-top:10px}summary{cursor:pointer;font-weight:600}',
    '</style>',
    '<div class="wrap"><div class="panel" role="dialog" aria-label="Sitemap Link Checker">',
    '<div class="top"><h2><svg viewBox="0 0 128 128" width="28" height="28" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#F0EFEB"/><path d="M33.58,37.93l-23.9,26.07,23.9,26.07M94.42,37.93l23.9,26.07-23.9,26.07" stroke="#1F1C1F" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M45.56,53.56l19.76,19.76,35.91-44.9" stroke="#C42D82" stroke-width="15" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>Sitemap Link Checker</h2><button id="close" aria-label="Close">Close</button></div>',
    '<div class="row between"><span class="sec">Links to check</span><div class="seg" role="group" aria-label="Where the links come from"><button id="srcMap" class="on" aria-pressed="true">From a sitemap</button><button id="srcPaste" aria-pressed="false">Pasted list</button></div></div>',
    '<div id="paneMap">',
    '<div class="row"><div class="addr grow"><span id="site" title="The checker can only read sitemaps on the site it is opened on"></span><input id="sm" type="text" aria-label="Sitemap address" aria-describedby="site" spellcheck="false"></div><button id="load">Load sitemap</button></div>',
    '<div id="files"></div>',
    '</div>',
    '<div id="panePaste" hidden><textarea id="paste" aria-label="Links to check, one per line" placeholder="https://…"></textarea><p class="help">One link per line. Only links on this site can be checked.</p></div>',
    '<label class="swap" id="swapRow" hidden><input type="checkbox" id="swap"><span id="swapText"></span></label>',
    '<details class="opts"><summary>Options</summary><div class="optbody">',
    '<div><label for="pace">Pace</label><select id="pace"><option value="normal">Normal (3 at a time)</option><option value="gentle">Gentle (1 at a time)</option></select>',
    '<p class="help">Gentle is slower but less likely to set off a bot check.</p>',
    '<p class="help"><strong>Sign-ins and bot checks.</strong> The checker uses this browser\'s session, so it sees what you see. Sign in, enter the site password, or complete the "press and hold" check in this browser first. It never asks for a password and never stores one. If the site starts blocking part-way through, the run pauses and shows how to carry on.</p></div>',
    '<div><label for="phrases">Messages that mark a broken page</label><textarea id="phrases"></textarea>',
    '<p class="help">One per line. A page whose text contains one of these is reported as Not found, as No results if the phrase contains "no results" or "(0)", or as Error if it contains the word "error".</p></div>',
    '</div></details>',
    '<div class="row" style="margin-top:14px"><button class="primary" id="start">Check links</button><button id="stop" disabled>Stop</button><button id="csv" disabled>Download CSV</button><button id="again" disabled>Recheck problems</button><span class="muted" id="status" aria-live="polite"></span></div>',
    '<div class="bar"><i id="prog"></i></div>',
    '<div class="gate" id="gate" role="status" hidden></div>',
    '<div class="row" id="filters"></div>',
    '<div class="results">',
    '<div class="row" id="find" hidden><input class="grow" id="q" type="text" placeholder="Search links, titles and notes" aria-label="Search results"><button id="copy">Copy links</button><span class="muted" id="shown" aria-live="polite"></span></div>',
    '<div class="scroll"><table><thead><tr><th>Result</th><th>Status</th><th>Time</th><th>Link</th><th>Went to</th><th>Page title</th><th>Note</th></tr></thead><tbody id="rows"></tbody></table></div></div>',
    '<div class="by">Powered by <a href="https://summitml.com" target="_blank" rel="noopener">Summit ML</a></div>',
    '</div></div>'
  ].join('');
  document.documentElement.appendChild(host);

  var $ = function (id) { return root.getElementById(id); };
  var rows = [], filter = 'All', codeSet = [], codesOpen = false, running = false, stopRequested = false, paused = false, files = [], pending = [], phrases = [], source = 'map', lastGated = null, notFoundPage = null;
  var DEFAULT_SITEMAP = sitePrefix() + '/sitemap.xml', OTHER_SITEMAP = sitePrefix() + '/sitemap_index.xml';
  var FILES_HINT = 'No sitemap loaded yet. Click Load sitemap and the sitemap files found at that address will be listed here, ready to tick.';
  $('site').textContent = location.origin;
  $('sm').value = DEFAULT_SITEMAP;
  $('phrases').value = DEFAULT_PHRASES.join('\n');
  filesHint(FILES_HINT);

  // Suggest the site's real sitemap instead of the usual guess: first from links on the page, then from
  // robots.txt, which is where a site declares its sitemaps. Never overrides what the tester typed or loaded.
  var typed = false;
  $('sm').addEventListener('input', function () { typed = true; });
  function suggestSitemap(path, where) {
    if (!path || typed || files.length) { return; }
    $('sm').value = path;
    filesHint('Found this site\'s sitemap ' + where + '. Click Load sitemap to list its files.');
  }
  function pageSitemaps() {
    return Array.prototype.map.call(document.querySelectorAll('link[rel~="sitemap" i][href], a[href]'), function (n) { return n; })
      .filter(function (n) { try { return n.tagName === 'LINK' || /sitemap[^/]*\.xml$/i.test(new URL(n.href).pathname); } catch (e) { return false; } })
      .map(function (n) { return n.href; });
  }
  suggestSitemap(pickSitemap(pageSitemaps(), location.origin), 'linked on this page');
  getText(location.origin + '/robots.txt').then(function (got) {
    if (got.res.ok) { suggestSitemap(pickSitemap(robotsSitemaps(got.text), location.origin), 'in robots.txt'); }
  }).catch(function () { /* no robots.txt is fine */ });

  function setStatus(t) { $('status').textContent = t; }
  function cls(r) { return r.replace(/ /g, '-'); }

  function isBad(code) { return +code >= 400; }
  function filterButton(parent, label, on, klass, pick) {
    var b = document.createElement('button');
    b.textContent = label;
    b.className = (klass || '') + (on ? ' on' : '');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', function () { pick(); renderFilters(); renderRows(); });
    parent.appendChild(b);
  }
  function renderFilters() {
    var counts = { All: rows.length }, codes = {};
    rows.forEach(function (r) { counts[r.result] = (counts[r.result] || 0) + 1; codes[codeOf(r)] = (codes[codeOf(r)] || 0) + 1; });
    if (filter !== 'All' && !counts[filter]) { filter = 'All'; }
    var order = ['All', 'Blocked', 'Sign-in needed', 'Not found', 'No results', 'Error', 'Warning', 'Redirect to home', 'Redirect', 'Skipped', 'OK'];
    $('filters').innerHTML = '';
    var group = document.createElement('div'); group.className = 'seg'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Filter by result');
    $('filters').appendChild(group);
    order.forEach(function (name) {
      if (name !== 'All' && !counts[name]) { return; }
      filterButton(group, name + ' (' + (counts[name] || 0) + ')', name === filter, '', function () { filter = name; });
    });

    // status codes pulled out of the results: a menu to tick one or several, error codes first
    $('find').hidden = !rows.length;
    if (!rows.length) { return; }
    codeSet = codeSet.filter(function (c) { return codes[c]; });
    var dd = document.createElement('div'); dd.className = 'dd'; $('filters').appendChild(dd);
    filterButton(dd, 'Status code: ' + codePreview(codeSet) + ' \u25BE', codeSet.length > 0, '', function () { codesOpen = !codesOpen; });
    dd.firstChild.setAttribute('aria-haspopup', 'true'); dd.firstChild.setAttribute('aria-expanded', codesOpen ? 'true' : 'false');
    dd.firstChild.removeAttribute('aria-pressed');
    if (!codesOpen) { return; }
    var menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'Status codes'); dd.appendChild(menu);
    sortCodes(Object.keys(codes)).forEach(function (code) {
      var label = document.createElement('label'), box = document.createElement('input');
      if (isBad(code)) { label.className = 'bad'; }
      box.type = 'checkbox'; box.value = code; box.checked = codeSet.indexOf(code) > -1;
      box.addEventListener('change', function () {
        codeSet = box.checked ? codeSet.concat(code) : codeSet.filter(function (c) { return c !== code; });
        renderFilters(); renderRows();
        var again = root.querySelector('.menu input[value="' + code + '"]'); if (again) { again.focus(); }
      });
      label.appendChild(box); label.appendChild(document.createTextNode(code + ' (' + codes[code] + ')'));
      menu.appendChild(label);
    });
    if (codeSet.length) { filterButton(menu, 'Show all codes', false, '', function () { codeSet = []; }); }
  }
  function visibleRows() {
    var f = { result: filter, codes: codeSet, q: $('q').value };
    return rows.filter(function (r) { return matches(r, f); });
  }
  function renderRows() {
    var body = $('rows'), list = visibleRows(); body.innerHTML = '';
    $('shown').textContent = rows.length ? 'Showing ' + list.length + ' of ' + rows.length : '';
    $('copy').disabled = !list.length;
    if (rows.length && !list.length) {
      var empty = document.createElement('tr'), cell = document.createElement('td');
      cell.colSpan = 7; cell.className = 'none'; cell.textContent = 'No links match these filters.';
      empty.appendChild(cell); body.appendChild(empty);
      return;
    }
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      function td(text, klass, link) {
        var c = document.createElement('td'); if (klass) { c.className = klass; }
        if (link) { var a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; c.appendChild(a); } else { c.textContent = text; }
        tr.appendChild(c);
      }
      td(r.result, 'r ' + cls(r.result));
      td(r.status || '', 's' + (isBad(r.status) ? ' bad' : ''));
      td(r.ms === '' ? '' : duration(r.ms), 's' + (r.ms >= SLOW_MS ? ' slow' : ''));
      td(r.url, 'u', r.url);
      var moved = r.finalUrl && norm(r.finalUrl) !== norm(r.url) ? r.finalUrl : '';
      td(moved, 'u', moved);
      td(r.title || r.heading || '');
      td(r.note);
      body.appendChild(tr);
    });
  }
  async function copyLinks() {
    var list = visibleRows().map(function (r) { return r.url; });
    try {
      await navigator.clipboard.writeText(list.join('\n'));
      setStatus('Copied ' + list.length + ' link' + (list.length === 1 ? '' : 's') + '.');
    } catch (e) {
      setStatus('Could not copy. Use Download CSV instead.');
    }
  }

  // the box where sitemap files are listed; before a sitemap is loaded it says what will appear there
  function filesHint(text) {
    var box = document.createElement('div'); box.className = 'files hint'; box.textContent = text;
    $('files').innerHTML = ''; $('files').appendChild(box);
  }
  async function loadSitemap() {
    await readSitemap();
    if (!files.length) { filesHint(FILES_HINT); }
  }
  async function readSitemap() {
    var address = sitemapAddress($('sm').value, location.origin), url = address.url; files = [];
    if (address.error) { setStatus(address.error); return; }
    $('sm').value = address.path;
    filesHint('Looking for sitemap files…');
    setStatus('Loading sitemap…');
    try {
      var got = await getText(url);
      // many sites keep an index at the other common name; try it before giving up on the default
      if (address.path === DEFAULT_SITEMAP && (got.res.status === 404 || (got.res.ok && !locs(got.text).list.length))) {
        var other = await getText(location.origin + OTHER_SITEMAP);
        if (other.res.ok && locs(other.text).list.length) { got = other; url = location.origin + OTHER_SITEMAP; $('sm').value = OTHER_SITEMAP; }
      }
      if (!got.res.ok) {
        var gate = got.res.status === 401 || got.res.status === 403 || got.res.status === 429;
        setStatus('Could not load the sitemap (' + got.res.status + ').' + (gate ? ' The site wants a sign-in or a bot check. Open the sitemap address in a new tab, get through it there, then load again.' : ''));
        return;
      }
      var parsed = locs(got.text);
      if (!parsed.list.length) { setStatus('No links found at that address. Check that it is a sitemap.'); return; }
      if (parsed.isIndex) {
        for (var i = 0; i < parsed.list.length; i++) {
          var child = parsed.list[i], count = '?', links = [];
          try {
            // a sitemap index copied from another environment names files there; read the same file on this site
            var c = await getText(swapOrigin(child, location.origin));
            if (c.res.ok) { links = locs(c.text).list; count = links.length; }
          } catch (e) { count = '?'; }
          files.push({ url: child, links: links, count: count });
          setStatus('Reading sitemap files… ' + (i + 1) + ' of ' + parsed.list.length);
        }
      } else {
        files.push({ url: url, links: parsed.list, count: parsed.list.length });
      }
      // small sitemaps are ready to go; with a large one the tester picks the files that matter
      var total = files.reduce(function (sum, f) { return sum + (typeof f.count === 'number' ? f.count : 0); }, 0);
      var tickAll = files.length === 1 || total <= 500;
      var box = document.createElement('div'); box.className = 'files';
      files.forEach(function (f, i) {
        var l = document.createElement('label'), cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = tickAll; cb.dataset.i = i;
        l.appendChild(cb); l.appendChild(document.createTextNode(f.url.split('/').pop() + '  (' + f.count + ' links)'));
        box.appendChild(l);
      });
      $('files').innerHTML = ''; $('files').appendChild(box);
      updateSwap();
      setStatus(files.length + ' sitemap file' + (files.length === 1 ? '' : 's') + ' found. Tick the ones to check.');
    } catch (e) {
      setStatus('Could not load the sitemap: ' + (e && e.message ? e.message : e));
    }
  }

  // links come from one place at a time: the ticked sitemap files, or the pasted list
  function setSource(name) {
    source = name;
    $('paneMap').hidden = name !== 'map'; $('panePaste').hidden = name !== 'paste';
    $('swapRow').hidden = true; updateSwap();
    [['srcMap', 'map'], ['srcPaste', 'paste']].forEach(function (pair) {
      $(pair[0]).className = pair[1] === name ? 'on' : ''; $(pair[0]).setAttribute('aria-pressed', pair[1] === name ? 'true' : 'false');
    });
  }
  function collectLinks() {
    var list = [];
    if (source === 'map') {
      Array.prototype.forEach.call(root.querySelectorAll('.files input:checked'), function (cb) { list = list.concat(files[+cb.dataset.i].links); });
    } else {
      $('paste').value.split(/\s+/).forEach(function (u) { if (/^https?:\/\//i.test(u)) { list.push(u); } });
    }
    var seen = {};
    return list.filter(function (u) { if (seen[u]) { return false; } seen[u] = 1; return true; });
  }

  // offers to check links from another site (a production sitemap, say) on the site being tested instead
  function updateSwap() {
    var all = [];
    if (source === 'map') { files.forEach(function (f) { all = all.concat(f.links); }); } else { all = collectLinks(); }
    var other = otherSites(all, location.origin), wasHidden = $('swapRow').hidden;
    $('swapRow').hidden = !other.count;
    if (!other.count) { return; }
    $('swapText').textContent = other.count + ' of ' + plural(all.length, 'link') + (other.count === 1 ? ' is' : ' are') + ' on ' + other.host +
      (other.hosts > 1 ? ' and ' + plural(other.hosts - 1, 'other site') : '') + ', which the checker cannot read from here. Check ' +
      (other.count === 1 ? 'it' : 'them') + ' on this site (' + location.host + ') instead, at the same paths.';
    // when most of the list is elsewhere, it is almost certainly the same site in another environment
    if (wasHidden) { $('swap').checked = other.count * 2 >= all.length; }
  }

  function gated() { return rows.filter(needsHuman); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function sleep(ms) { return new Promise(function (done) { setTimeout(done, ms); }); }

  // the notice that tells the tester how to get past a sign-in or bot check, and reruns what was blocked
  function renderGate() {
    var box = $('gate'), list = gated(); box.innerHTML = '';
    box.hidden = running || !list.length;
    if (box.hidden) { return; }
    function el(tag, text, parent) { var n = document.createElement(tag); if (text) { n.textContent = text; } (parent || box).appendChild(n); return n; }
    var signIn = list.every(function (r) { return r.result === 'Sign-in needed'; });
    el('strong', plural(list.length, 'link') + (list.length === 1 ? ' was' : ' were') + ' blocked by ' + (signIn ? 'a sign-in.' : 'a sign-in or a bot check.') +
      (pending.length ? ' The run is paused with ' + plural(pending.length, 'link') + ' still to check.' : ''));
    var steps = el('ol');
    var first = el('li', 'Open ', steps), a = el('a', 'this blocked link', first);
    // the link blocked most recently is the one most likely to show the check again
    a.href = (lastGated && list.indexOf(lastGated) > -1 ? lastGated : list[0]).url; a.target = '_blank'; a.rel = 'noopener';
    first.appendChild(document.createTextNode(' in a new tab.'));
    el('li', signIn ? 'Sign in there until the real page shows.' : 'Sign in there, or complete the check (for example, press and hold the button), until the real page shows.', steps);
    el('li', 'Come back to this tab and click the button below.', steps);
    var again = el('button', 'Recheck ' + plural(list.length, 'blocked link') + (pending.length ? ' and continue' : ''));
    again.className = 'primary';
    again.addEventListener('click', function () { recheck(needsHuman); });
    el('span', '  Blocked again? Set Pace to Gentle under Options and recheck.').className = 'muted';
  }

  async function runQueue() {
    running = true; stopRequested = false; paused = false;
    $('start').disabled = true; $('stop').disabled = false; $('csv').disabled = true; $('pace').disabled = true; $('again').disabled = true;
    renderGate();
    var gentle = $('pace').value === 'gentle', streak = 0, inflight = 0;
    async function worker() {
      while (pending.length && !stopRequested && !paused) {
        var url = pending.shift(); inflight++;
        var row = await checkOne(url, phrases, notFoundPage);
        inflight--; rows.push(row);
        streak = needsHuman(row) ? streak + 1 : 0;
        if (needsHuman(row)) { lastGated = row; }
        if (streak >= PAUSE_AFTER) { paused = true; }
        var total = rows.length + pending.length + inflight;
        $('prog').style.width = Math.round(rows.length / total * 100) + '%';
        setStatus('Checked ' + rows.length + ' of ' + total);
        if (rows.length % 5 === 0 || !pending.length) { renderFilters(); renderRows(); }
        if (gentle && pending.length && !stopRequested && !paused) { await sleep(GENTLE_DELAY); }
      }
    }
    var workers = []; for (var i = 0; i < (gentle ? 1 : CONCURRENCY); i++) { workers.push(worker()); }
    await Promise.all(workers);
    var weight = { 'Blocked': -2, 'Sign-in needed': -1, 'Not found': 0, 'No results': 1, 'Error': 2, 'Warning': 2.5, 'Redirect to home': 3, 'Redirect': 4, 'Skipped': 5, 'OK': 6 };
    rows.sort(function (a, b) { return weight[a.result] - weight[b.result]; });
    running = false; $('start').disabled = false; $('stop').disabled = true; $('csv').disabled = !rows.length; $('pace').disabled = false;
    renderFilters(); renderRows(); renderGate(); updateAgain();
    var problems = rows.filter(function (r) { return r.result !== 'OK'; }).length;
    setStatus(paused ? 'Paused after ' + rows.length + ' links. The site wants a sign-in or a bot check: follow the steps below.'
      : (stopRequested ? 'Stopped. ' : 'Done. ') + rows.length + ' checked, ' + problems + ' need a look.');
  }

  async function start() {
    if (running) { return; }
    var links = collectLinks();
    listedAs = {};
    if (!$('swapRow').hidden && $('swap').checked) {
      var moved = {};
      links = links.map(function (u) { var to = swapOrigin(u, location.origin); if (to !== u) { listedAs[to] = u; } return to; })
        .filter(function (u) { if (moved[u]) { return false; } moved[u] = 1; return true; });
    }
    if (!links.length) { setStatus(source === 'map' ? 'Nothing to check. Load a sitemap and tick a file first.' : 'Nothing to check. Paste some links first.'); return; }
    phrases = $('phrases').value.split('\n').map(function (p) { return p.trim().toLowerCase(); }).filter(Boolean);
    rows = []; pending = links; filter = 'All'; codeSet = []; codesOpen = false; $('q').value = '';
    running = true; $('start').disabled = true; renderFilters(); renderRows(); renderGate();
    setStatus('Checking how this site answers for a page that does not exist…');
    notFoundPage = await learnNotFoundPage();
    running = false;
    await runQueue();
  }

  function isProblem(row) { return row.result !== 'OK' && row.result !== 'Skipped'; }
  function updateAgain() {
    var n = rows.filter(isProblem).length;
    $('again').disabled = running || !n; $('again').textContent = 'Recheck problems' + (n ? ' (' + n + ')' : '');
  }

  // checks some of the links again (the blocked ones by default), then carries on with whatever a pause left unchecked
  async function recheck(which) {
    if (running) { return; }
    var pick = typeof which === 'function' ? which : needsHuman;
    var again = rows.filter(pick).map(function (r) { return r.url; });
    if (!again.length && !pending.length) { return; }
    rows = rows.filter(function (r) { return !pick(r); });
    pending = again.concat(pending);
    await runQueue();
  }

  function downloadCsv() {
    var head = ['Result', 'Link', 'Listed as', 'Went to', 'Status', 'Time (ms)', 'Page title', 'Main heading', 'Canonical', 'Note'];
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [r.result, r.url, r.listed, r.finalUrl, r.status, r.ms, r.title, r.heading, r.canonical, r.note].map(csvCell).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sitemap-links-' + location.hostname + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    root.appendChild(a); a.click(); a.remove();
  }

  $('load').addEventListener('click', loadSitemap);
  $('srcMap').addEventListener('click', function () { setSource('map'); });
  $('srcPaste').addEventListener('click', function () { setSource('paste'); });
  $('sm').addEventListener('keydown', function (e) { if (e.key === 'Enter') { loadSitemap(); } });
  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', function () { stopRequested = true; setStatus('Stopping…'); });
  $('csv').addEventListener('click', downloadCsv);
  $('copy').addEventListener('click', copyLinks);
  $('again').addEventListener('click', function () { recheck(isProblem); });
  $('paste').addEventListener('input', updateSwap);
  // the status code menu closes on a click anywhere else, or on Escape
  root.addEventListener('click', function (e) { if (codesOpen && !(e.target.closest && e.target.closest('.dd'))) { codesOpen = false; renderFilters(); } });
  root.addEventListener('keydown', function (e) { if (codesOpen && e.key === 'Escape') { codesOpen = false; renderFilters(); var b = root.querySelector('.dd>button'); if (b) { b.focus(); } } });
  $('q').addEventListener('input', renderRows);
  $('close').addEventListener('click', function () { host.style.display = 'none'; });

  window.__sitemapLinkChecker = {
    show: function () { host.style.display = ''; },
    // for scripted use: resolves with the result rows
    run: async function (links) { if (links && links.length) { $('paste').value = links.join('\n'); setSource('paste'); } await start(); return rows; },
    load: loadSitemap,
    recheck: async function () { await recheck(needsHuman); return rows; },
    rows: function () { return rows; }
  };
}());
