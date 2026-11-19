'use strict';

/**
 * A small made-up store, plus the slides that frame it, used to render the store listing images.
 * The checker runs for real against these pages; only the address shown is swapped for a neutral one.
 *
 * Usage: node tools/store-images/server.js   (then see build.sh)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8793;
const ORIGIN = 'http://localhost:' + PORT;
const SHOWN = 'https://shop.example.com';
const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const page = (title, body) => `<!doctype html><title>${title} | Northtrail</title><h1>${title}</h1><p>${body || 'Shop the collection. '.concat('Built for the long haul, with free shipping and easy returns on every order. '.repeat(3))}</p>`;

// path -> [status, title, body]
const pages = {
    '/luggage/carry-on': [200, 'Carry-On Luggage'], '/luggage/checked': [200, 'Checked Luggage'], '/luggage/hardside': [200, 'Hardside Luggage'],
    '/luggage/spinner-2019': [404, 'Page Not Found', 'Sorry.'], '/backpacks/laptop': [200, 'Laptop Backpacks'], '/backpacks/travel': [200, 'Travel Backpacks'],
    '/backpacks/rolling': [200, 'Backpacks', 'Sorry, we cannot find the product you are looking for.'],
    '/bags/duffel': [200, 'Duffel Bags'], '/bags/tote': [200, 'Tote Bags'], '/bags/weekender': [200, 'Weekender Bags'],
    '/accessories/packing-cubes': [200, 'Packing Cubes'], '/accessories/luggage-tags': [200, 'Luggage Tags'],
    '/sale/summer': [404, 'Page Not Found', 'Sorry.'], '/sale/clearance': [200, 'Clearance', 'Products (0)'], '/collections/retired': [410, 'Gone', 'Sorry.'],
    '/collections/new-arrivals': [200, 'New Arrivals'], '/collections/best-sellers': [200, 'Best Sellers'], '/search/weekender-luggage': [200, 'Search', 'No results found for weekender luggage.'],
    '/help/shipping': [200, 'Shipping'], '/help/returns': [200, 'Returns'], '/help/warranty': [200, 'Warranty'], '/about': [200, 'About Northtrail'], '/stores': [200, 'Find a Store'],
    '/checkout/gift-cards': [500, 'Something went wrong', 'Sorry.'], '/store-locator/map': [503, 'Service Unavailable', 'Sorry.'], '/luggage/sets': [200, 'Luggage Sets']
};
const redirects = { '/luggage/softside': '/luggage/sets', '/promo/spring': '/' };
const guarded = ['/brands/alpine', '/brands/harbor', '/brands/meridian', '/brands/summit-line'];
const sitemaps = {
    'sitemap-products.xml': ['/luggage/carry-on', '/luggage/checked', '/luggage/hardside', '/luggage/spinner-2019', '/luggage/softside', '/backpacks/laptop', '/backpacks/travel', '/backpacks/rolling',
        '/bags/duffel', '/bags/tote', '/bags/weekender', '/accessories/packing-cubes'].concat(guarded, ['/accessories/luggage-tags', '/luggage/sets']),
    'sitemap-categories.xml': ['/sale/summer', '/sale/clearance', '/collections/retired', '/collections/new-arrivals', '/collections/best-sellers', '/search/weekender-luggage', '/promo/spring'],
    'sitemap-content.xml': ['/help/shipping', '/help/returns', '/help/warranty', '/about', '/stores', '/checkout/gift-cards', '/store-locator/map']
};

const store = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northtrail</title><style>
body{margin:0;font:15px/1.4 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1d2530;background:#fff}
nav{display:flex;gap:26px;align-items:center;padding:16px 32px;border-bottom:1px solid #e6e9ee}nav b{font-size:20px;letter-spacing:.08em;margin-right:20px}
.hero{height:230px;margin:24px 32px;border-radius:14px;background:linear-gradient(120deg,#d9e4ee,#f1e6dc)}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin:0 32px}.grid i{display:block;height:170px;border-radius:12px;background:#eef1f4}
</style></head><body><nav><b>NORTHTRAIL</b><span>Luggage</span><span>Backpacks</span><span>Bags</span><span>Accessories</span><span>Sale</span></nav>
<div class="hero"></div><div class="grid"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
<script src="/checker.js"></script><script>
(async function () {
  var mode = new URLSearchParams(location.search).get('demo'); if (!mode) { return; }
  document.cookie = mode === 'gate' ? 'human=; path=/; max-age=0' : 'human=1; path=/';
  var api = window.__sitemapLinkChecker; await api.load();
  var root = Array.prototype.filter.call(document.documentElement.children, function (e) { return e.shadowRoot; })[0].shadowRoot;
  var wrap = root.querySelector('.wrap');
  function button(text) { return Array.prototype.filter.call(root.querySelectorAll('button'), function (b) { return b.textContent.indexOf(text) === 0; })[0]; }
  if (mode !== 'files') {
    await api.run([]);
    if (mode === 'codes') { button('Status code').click(); root.querySelector('.menu input[value="404"]').click(); root.querySelector('.menu input[value="410"]').click(); }
    if (mode === 'search') { var q = root.getElementById('q'); q.value = 'luggage'; q.dispatchEvent(new Event('input')); }
    wrap.scrollTop = root.getElementById('start').getBoundingClientRect().top + wrap.scrollTop - 12;
  }
  // show a neutral address instead of the local one the pages are served from
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), node;
  while ((node = walker.nextNode())) { node.nodeValue = node.nodeValue.split('${ORIGIN}').join('${SHOWN}'); }
}());
</script></body></html>`;

const slides = {
    1: ['Check every link in your sitemap', 'Real page, redirect, not found, empty or error: every link gets a verdict.', 'all'],
    2: ['Jump straight to the error codes', 'Every status code the run found is in one menu. Tick the ones you want to see.', 'codes'],
    3: ['Works behind sign-ins and bot checks', 'It runs in your browser, as you. If the site pushes back, it pauses and picks up where it left off.', 'gate'],
    4: ['Search, copy, export', 'Narrow the list as you type, copy the links, or download everything as CSV.', 'search'],
    5: ['Pick the sitemap files that matter', 'Load a sitemap index, see what is in it, and check only the files you need.', 'files']
};
const BRAND = `*{box-sizing:border-box}html,body{margin:0;overflow:hidden}
body{background:#1F1C1F;color:#F0EFEB;font-family:'Space Grotesk','Segoe UI',Helvetica,Arial,sans-serif;position:relative}
body:before{content:"";position:absolute;inset:0;background:radial-gradient(900px 500px at 88% -10%,rgba(196,45,130,.34),transparent 62%),radial-gradient(800px 520px at -5% 110%,rgba(58,103,134,.42),transparent 60%)}
body>*{position:relative}
h1{font-family:'Sofia Sans','Segoe UI',Helvetica,Arial,sans-serif;font-weight:800;letter-spacing:-.015em;margin:0}
.name{display:flex;align-items:center;gap:12px;font-family:'Sofia Sans','Segoe UI',sans-serif;font-weight:700}
.name img{border-radius:22%;box-shadow:0 0 0 1px rgba(240,239,235,.16)}
p{margin:0;color:#C4BBC1}
.rule{height:4px;width:72px;border-radius:2px;background:linear-gradient(90deg,#4E82A6,#7A2F6E 55%,#C42D82)}
.win{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55),0 0 0 1px rgba(240,239,235,.14)}
.chrome{height:38px;background:#2B242A;display:flex;align-items:center;gap:7px;padding:0 14px}
.chrome i{width:11px;height:11px;border-radius:50%;background:#6E6570}.chrome span{margin-left:14px;flex:1;max-width:420px;background:#1C1619;color:#918790;font-size:12.5px;padding:5px 14px;border-radius:12px}
iframe{border:0;display:block;transform-origin:0 0}`;
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@700;800&family=Space+Grotesk:wght@400;500&display=swap" rel="stylesheet">';
const frame = (demo, w, h, zoom) => `<div class="win" style="width:${w}px"><div class="chrome"><i></i><i></i><i></i><span>shop.example.com</span></div>
<div style="height:${h}px;overflow:hidden"><iframe src="/?demo=${demo}" style="width:${Math.round(w / zoom)}px;height:${Math.round(h / zoom)}px;transform:scale(${zoom})"></iframe></div></div>`;

function slide(n) {
    const s = slides[n];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">${FONTS}<style>${BRAND}
body{width:1280px;height:800px;padding:38px 64px 0}
.name{font-size:17px;color:#C4BBC1;margin-bottom:16px}h1{font-size:46px;line-height:1.08}p{font-size:19px;margin:10px 0 22px;max-width:900px}
</style></head><body><div class="name"><img src="/icon.svg" width="30" height="30" alt="">Sitemap Link Checker</div>
<h1>${s[0]}</h1><p>${s[1]}</p>${frame(s[2], 1152, 580, 0.9)}</body></html>`;
}
const promo = `<!doctype html><html lang="en"><head><meta charset="utf-8">${FONTS}<style>${BRAND}
body{width:440px;height:280px;padding:0 34px;display:flex;flex-direction:column;justify-content:center}
h1{font-size:33px;line-height:1.05;margin:18px 0 10px}p{font-size:15.5px}
</style></head><body><img src="/icon.svg" width="68" height="68" alt="" style="border-radius:22%;box-shadow:0 0 0 1px rgba(240,239,235,.16)">
<h1>Sitemap Link Checker</h1><p>Find every broken link in your sitemap, right in your browser.</p></body></html>`;
const marquee = `<!doctype html><html lang="en"><head><meta charset="utf-8">${FONTS}<style>${BRAND}
body{width:1400px;height:560px;display:flex;align-items:center;gap:56px;padding-left:76px}
.copy{width:500px;flex:none}.name{font-size:21px;margin-bottom:26px}h1{font-size:52px;line-height:1.04;margin-bottom:18px}p{font-size:20px;line-height:1.4;margin-bottom:26px}
.win{flex:none;margin-top:150px}
</style></head><body><div class="copy"><div class="name"><img src="/icon.svg" width="46" height="46" alt="">Sitemap Link Checker</div>
<h1>Find every broken link in your sitemap</h1><p>Runs in your browser, on the site you are testing. Nothing is sent anywhere.</p><div class="rule"></div></div>
${frame('all', 900, 560, 1)}</body></html>`;

http.createServer((req, res) => {
    const url = new URL(req.url, ORIGIN), p = url.pathname;
    const send = (status, type, body, extra) => { res.writeHead(status, Object.assign({ 'content-type': type }, extra)); res.end(body); };
    if (p === '/') { return send(200, 'text/html', store); }
    if (p === '/checker.js') { return send(200, 'text/javascript', read('extension/checker.js')); }
    if (p === '/icon.svg') { return send(200, 'image/svg+xml', read('tools/icon.svg')); }
    if (p === '/slide') { return send(200, 'text/html', slide(+url.searchParams.get('n') || 1)); }
    if (p === '/promo') { return send(200, 'text/html', promo); }
    if (p === '/marquee') { return send(200, 'text/html', marquee); }
    if (p === '/sitemap.xml') {
        return send(200, 'application/xml', '<?xml version="1.0"?><sitemapindex>' + Object.keys(sitemaps).map((f) => `<sitemap><loc>${ORIGIN}/${f}</loc></sitemap>`).join('') + '</sitemapindex>');
    }
    if (sitemaps[p.slice(1)]) {
        return send(200, 'application/xml', '<?xml version="1.0"?><urlset>' + sitemaps[p.slice(1)].map((u) => `<url><loc>${ORIGIN}${u}</loc></url>`).join('') + '</urlset>');
    }
    if (redirects[p]) { return send(302, 'text/html', '', { location: redirects[p] }); }
    if (guarded.indexOf(p) > -1 && !/human=1/.test(req.headers.cookie || '')) {
        return send(403, 'text/html', '<!doctype html><title>Access to this page has been denied</title><h1>Before we continue...</h1><p>Press &amp; Hold to confirm you are a human.</p>');
    }
    if (guarded.indexOf(p) > -1) { return send(200, 'text/html', page('Brand: ' + p.split('/').pop())); }
    const hit = pages[p] || [404, 'Page Not Found', 'Sorry.'];
    return send(hit[0], 'text/html', page(hit[1], hit[2]));
}).listen(PORT, () => console.log('store images server on ' + ORIGIN));
