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

  // ---------- helpers
  function siteRoot() {
    var m = location.pathname.match(/^\/s\/[^/]+/);
    return location.origin + (m ? m[0] : '');
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
   * @returns {{result: string, note: string}} the outcome
   */
  function classify(info) {
    var hit = (info.phrases || []).filter(function (p) { return p && info.text.indexOf(p) > -1; })[0];
    var redirected = info.redirected && norm(info.finalUrl) !== norm(info.requestedUrl);

    if (info.status >= 500) { return { result: 'Error', note: 'The site returned an error (' + info.status + ')' }; }
    if (info.status === 404 || info.status === 410) { return { result: 'Not found', note: 'The site answered ' + info.status }; }
    if (info.status === 401 || info.status === 403) { return { result: 'Error', note: 'Not allowed (' + info.status + '). Are you signed in?' }; }
    if (hit) {
      return {
        result: /error/.test(hit) ? 'Error' : (/no results|\(0\)/.test(hit) ? 'No results' : 'Not found'),
        note: 'Page says: "' + hit + '"'
      };
    }
    if (redirected && isHome(info.finalUrl)) { return { result: 'Redirect to home', note: 'Sent to the home page' }; }
    if (redirected) { return { result: 'Redirect', note: 'Sent to a different address' }; }
    if (info.status >= 400) { return { result: 'Error', note: 'The site answered ' + info.status }; }
    return { result: 'OK', note: '' };
  }

  async function checkOne(url, phrases) {
    var row = { url: url, result: '', status: '', finalUrl: '', title: '', heading: '', note: '' };
    var target;
    try { target = new URL(url, location.href); } catch (e) { row.result = 'Error'; row.note = 'Not a valid link'; return row; }
    if (target.origin !== location.origin) { row.result = 'Skipped'; row.note = 'Different site (' + target.origin + '). Run the checker on that site.'; return row; }
    try {
      var got = await getText(target.href);
      var res = got.res, html = got.text;
      row.status = res.status;
      row.finalUrl = res.url;
      row.title = pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      row.heading = pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
      var outcome = classify({
        requestedUrl: target.href,
        finalUrl: res.url,
        status: res.status,
        redirected: res.redirected,
        text: visibleText(html).toLowerCase(),
        phrases: phrases
      });
      row.result = outcome.result;
      row.note = outcome.note;
    } catch (e) {
      row.result = 'Error'; row.note = 'Could not load: ' + (e && e.message ? e.message : e);
    }
    return row;
  }

  // Node (tests): expose the pure helpers and stop before any DOM work.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { classify: classify, norm: norm, isHome: isHome, visibleText: visibleText, csvCell: csvCell, DEFAULT_PHRASES: DEFAULT_PHRASES };
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
    'h2{font-size:20px;margin:0}',
    '.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}',
    'label{display:block;font-weight:600;margin:12px 0 4px}',
    'input[type=text],textarea{width:100%;font:inherit;padding:8px 10px;border:1px solid #c4ccd4;border-radius:8px;color:#16202a;background:#fff}',
    'textarea{min-height:72px;resize:vertical}',
    'button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #c4ccd4;background:#fff;color:#16202a;cursor:pointer}',
    'button.primary{background:#0b5cad;border-color:#0b5cad;color:#fff;font-weight:600}',
    'button:disabled{opacity:.5;cursor:default}',
    'button.on{background:#16202a;border-color:#16202a;color:#fff}',
    '.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.grow{flex:1 1 320px}',
    '.muted{color:#5b6875}',
    '.files{margin:8px 0;max-height:150px;overflow:auto;border:1px solid #e1e5ea;border-radius:8px;padding:8px 10px}',
    '.files label{font-weight:400;margin:2px 0;display:flex;gap:8px;align-items:center}',
    '.bar{height:8px;background:#e9edf1;border-radius:4px;overflow:hidden;margin:10px 0 6px}',
    '.bar i{display:block;height:100%;width:0;background:#0b5cad}',
    '.scroll{overflow:auto;max-height:52vh;border:1px solid #e1e5ea;border-radius:8px;margin-top:10px}',
    'table{border-collapse:collapse;width:100%;font-size:13px}',
    'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eef1f4;vertical-align:top}',
    'th{position:sticky;top:0;background:#f6f8fa;font-weight:600}',
    'td.u{max-width:420px;word-break:break-all}',
    'a{color:#0b5cad}',
    '.OK{color:#1a7f37;font-weight:600}.Redirect,.Redirect-to-home,.Skipped{color:#b26a00;font-weight:600}.Not-found,.No-results,.Error{color:#c62828;font-weight:600}',
    'details{margin-top:10px}summary{cursor:pointer;font-weight:600}',
    '</style>',
    '<div class="wrap"><div class="panel" role="dialog" aria-label="Sitemap Link Checker">',
    '<div class="top"><h2>Sitemap Link Checker</h2><button id="close" aria-label="Close">Close</button></div>',
    '<label for="sm">Sitemap address</label>',
    '<div class="row"><input class="grow" id="sm" type="text"><button id="load">Load sitemap</button></div>',
    '<div id="files"></div>',
    '<details><summary>Or paste links, one per line</summary><textarea id="paste" placeholder="https://..."></textarea></details>',
    '<details><summary>Not-found and error messages to look for</summary><p class="muted" style="margin:6px 0">One per line. A page whose text contains one of these is reported as Not found, as No results if the phrase contains "no results" or "(0)", or as Error if it contains the word "error".</p><textarea id="phrases"></textarea></details>',
    '<div class="row" style="margin-top:14px"><button class="primary" id="start">Check links</button><button id="stop" disabled>Stop</button><button id="csv" disabled>Download CSV</button><span class="muted" id="status" aria-live="polite"></span></div>',
    '<div class="bar"><i id="prog"></i></div>',
    '<div class="row" id="filters"></div>',
    '<div class="scroll"><table><thead><tr><th>Result</th><th>Link</th><th>Went to</th><th>Page title</th><th>Note</th></tr></thead><tbody id="rows"></tbody></table></div>',
    '</div></div>'
  ].join('');
  document.documentElement.appendChild(host);

  var $ = function (id) { return root.getElementById(id); };
  var rows = [], filter = 'All', running = false, stopRequested = false, files = [];
  $('sm').value = siteRoot() + '/sitemap_index.xml';
  $('phrases').value = DEFAULT_PHRASES.join('\n');

  function setStatus(t) { $('status').textContent = t; }
  function cls(r) { return r.replace(/ /g, '-'); }

  function renderFilters() {
    var counts = { All: rows.length };
    rows.forEach(function (r) { counts[r.result] = (counts[r.result] || 0) + 1; });
    var order = ['All', 'Not found', 'No results', 'Error', 'Redirect to home', 'Redirect', 'Skipped', 'OK'];
    $('filters').innerHTML = '';
    order.forEach(function (name) {
      if (name !== 'All' && !counts[name]) { return; }
      var b = document.createElement('button');
      b.textContent = name + ' (' + (counts[name] || 0) + ')';
      if (name === filter) { b.className = 'on'; }
      b.addEventListener('click', function () { filter = name; renderFilters(); renderRows(); });
      $('filters').appendChild(b);
    });
  }
  function renderRows() {
    var body = $('rows'); body.innerHTML = '';
    rows.filter(function (r) { return filter === 'All' || r.result === filter; }).forEach(function (r) {
      var tr = document.createElement('tr');
      function td(text, klass, link) {
        var c = document.createElement('td'); if (klass) { c.className = klass; }
        if (link) { var a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; c.appendChild(a); } else { c.textContent = text; }
        tr.appendChild(c);
      }
      td(r.result, cls(r.result));
      td(r.url, 'u', r.url);
      td(r.finalUrl && norm(r.finalUrl) !== norm(r.url) ? r.finalUrl : '', 'u', r.finalUrl);
      td(r.title || r.heading || '');
      td(r.note + (r.status ? ' [' + r.status + ']' : ''));
      body.appendChild(tr);
    });
  }

  async function loadSitemap() {
    var url = $('sm').value.trim(); files = []; $('files').innerHTML = '';
    if (!url) { return; }
    setStatus('Loading sitemap…');
    try {
      var got = await getText(url);
      if (!got.res.ok) { setStatus('Could not load the sitemap (' + got.res.status + ').'); return; }
      var parsed = locs(got.text);
      if (parsed.isIndex) {
        for (var i = 0; i < parsed.list.length; i++) {
          var child = parsed.list[i], count = '?', links = [];
          try {
            var same = new URL(child).origin === location.origin;
            if (same) { var c = await getText(child); links = locs(c.text).list; count = links.length; }
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
      $('files').appendChild(box);
      setStatus(files.length + ' sitemap file' + (files.length === 1 ? '' : 's') + ' found. Tick the ones to check.');
    } catch (e) {
      setStatus('Could not load the sitemap: ' + (e && e.message ? e.message : e));
    }
  }

  function collectLinks() {
    var list = [];
    Array.prototype.forEach.call(root.querySelectorAll('.files input:checked'), function (cb) { list = list.concat(files[+cb.dataset.i].links); });
    $('paste').value.split(/\s+/).forEach(function (u) { if (/^https?:\/\//i.test(u)) { list.push(u); } });
    var seen = {};
    return list.filter(function (u) { if (seen[u]) { return false; } seen[u] = 1; return true; });
  }

  async function start() {
    if (running) { return; }
    var links = collectLinks();
    if (!links.length) { setStatus('Nothing to check. Load a sitemap and tick a file, or paste some links.'); return; }
    var phrases = $('phrases').value.split('\n').map(function (p) { return p.trim().toLowerCase(); }).filter(Boolean);
    rows = []; filter = 'All'; running = true; stopRequested = false;
    $('start').disabled = true; $('stop').disabled = false; $('csv').disabled = true;
    var next = 0, done = 0;
    async function worker() {
      while (next < links.length && !stopRequested) {
        var url = links[next++];
        var row = await checkOne(url, phrases);
        rows.push(row); done++;
        $('prog').style.width = Math.round(done / links.length * 100) + '%';
        setStatus('Checked ' + done + ' of ' + links.length);
        if (done % 5 === 0 || done === links.length) { renderFilters(); renderRows(); }
      }
    }
    var workers = []; for (var i = 0; i < CONCURRENCY; i++) { workers.push(worker()); }
    await Promise.all(workers);
    var weight = { 'Not found': 0, 'No results': 1, 'Error': 2, 'Redirect to home': 3, 'Redirect': 4, 'Skipped': 5, 'OK': 6 };
    rows.sort(function (a, b) { return weight[a.result] - weight[b.result]; });
    running = false; $('start').disabled = false; $('stop').disabled = true; $('csv').disabled = !rows.length;
    renderFilters(); renderRows();
    var problems = rows.filter(function (r) { return r.result !== 'OK'; }).length;
    setStatus((stopRequested ? 'Stopped. ' : 'Done. ') + rows.length + ' checked, ' + problems + ' need a look.');
  }

  function downloadCsv() {
    var head = ['Result', 'Link', 'Went to', 'Status', 'Page title', 'Main heading', 'Note'];
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [r.result, r.url, r.finalUrl, r.status, r.title, r.heading, r.note].map(csvCell).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sitemap-links-' + location.hostname + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    root.appendChild(a); a.click(); a.remove();
  }

  $('load').addEventListener('click', loadSitemap);
  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', function () { stopRequested = true; setStatus('Stopping…'); });
  $('csv').addEventListener('click', downloadCsv);
  $('close').addEventListener('click', function () { host.style.display = 'none'; });

  window.__sitemapLinkChecker = {
    show: function () { host.style.display = ''; },
    // for scripted use: resolves with the result rows
    run: async function (links) { $('paste').value = (links || []).join('\n'); await start(); return rows; },
    load: loadSitemap,
    rows: function () { return rows; }
  };
}());
