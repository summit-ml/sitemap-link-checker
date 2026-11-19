'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classify, sitemapAddress, robotsSitemaps, pickSitemap, declaredSitemaps, llmsLinks, swapOrigin, otherSites, duration, slowLimit, slowSite, timeLeft, norm, isHome, visibleText, csvCell, isLogin, canonicalOf, robotsOf, sameAsNotFound, needsHuman, codeOf, sortCodes, codePreview, matches, DEFAULT_PHRASES } = require('../extension/checker.js');

const base = { requestedUrl: 'https://shop.example/luggage/', finalUrl: 'https://shop.example/luggage/', status: 200, redirected: false, title: 'Luggage', heading: 'Luggage', text: 'luggage 20 results ' + 'carry-on and checked bags for every trip. '.repeat(6), phrases: DEFAULT_PHRASES };
const check = (overrides) => classify(Object.assign({}, base, overrides)).result;

test('a normal page is OK', () => {
    assert.strictEqual(check({}), 'OK');
});

test('404 and 410 are Not found, whatever the page says', () => {
    assert.strictEqual(check({ status: 404 }), 'Not found');
    assert.strictEqual(check({ status: 410, text: 'technical error' }), 'Not found');
});

test('5xx is an Error', () => {
    assert.strictEqual(check({ status: 500 }), 'Error');
    assert.strictEqual(check({ status: 503 }), 'Error');
});

test('401 asks for a sign-in; 403 and 429 are Blocked', () => {
    assert.strictEqual(check({ status: 401 }), 'Sign-in needed');
    assert.strictEqual(check({ status: 403 }), 'Blocked');
    assert.strictEqual(check({ status: 429 }), 'Blocked');
});

test('a bot-check page is Blocked whatever status it comes with', () => {
    const outcome = classify(Object.assign({}, base, { text: 'press & hold to confirm you are a human' }));
    assert.strictEqual(outcome.result, 'Blocked');
    assert.match(outcome.note, /press & hold/);
    assert.strictEqual(check({ status: 503, text: 'just a moment', html: '<div id="challenge-error-text">' }), 'Blocked');
    assert.strictEqual(check({ status: 404, text: '', html: '<div id="px-captcha"></div>' }), 'Blocked');
});

test('a redirect to a sign-in page is Sign-in needed', () => {
    assert.strictEqual(check({ redirected: true, finalUrl: 'https://shop.example/login?rurl=1', text: 'log in' }), 'Sign-in needed');
    assert.strictEqual(check({ redirected: true, finalUrl: 'https://host.example/on/demandware.store/Sites-x-Site/en_US/Login-Show' }), 'Sign-in needed');
    assert.strictEqual(check({ requestedUrl: 'https://shop.example/login', redirected: true, finalUrl: 'https://shop.example/account/login' }), 'Redirect');
});

test('isLogin does not match words that only contain login', () => {
    assert.ok(isLogin('https://shop.example/account/sign-in'));
    assert.ok(!isLogin('https://shop.example/blog/logins-explained'));
    assert.ok(!isLogin('https://shop.example/catalogin'));
});

test('needsHuman picks out the rows a person has to unblock', () => {
    assert.ok(needsHuman({ result: 'Blocked' }));
    assert.ok(needsHuman({ result: 'Sign-in needed' }));
    assert.ok(!needsHuman({ result: 'Error' }));
});

test('a page that loads but says it cannot find the item is Not found', () => {
    const outcome = classify(Object.assign({}, base, { text: 'sorry, we cannot find the product you are looking for' }));
    assert.strictEqual(outcome.result, 'Not found');
    assert.match(outcome.note, /we cannot find the product/);
});

test('an empty search or category page is No results', () => {
    assert.strictEqual(check({ text: 'search products (0) we are sorry, but no results were found for: zzz' }), 'No results');
    assert.strictEqual(check({ text: 'features products (0)' }), 'No results');
});

test('an error message on the page is an Error', () => {
    assert.strictEqual(check({ text: 'oops, technical error' }), 'Error');
});

test('a redirect to another page is a Redirect', () => {
    assert.strictEqual(check({ redirected: true, finalUrl: 'https://shop.example/new-luggage', text: 'luggage' }), 'Redirect');
});

test('a redirect to the home page is called out', () => {
    assert.strictEqual(check({ redirected: true, finalUrl: 'https://shop.example/' }), 'Redirect to home');
    assert.strictEqual(check({ redirected: true, finalUrl: 'https://host.example/s/brand/home' }), 'Redirect to home');
    assert.strictEqual(check({ redirected: true, finalUrl: 'https://host.example/s/brand' }), 'Redirect to home');
});

test('a redirect that only adds or drops a trailing slash or changes case is not a redirect', () => {
    assert.strictEqual(check({ requestedUrl: 'https://shop.example/luggage', redirected: true, finalUrl: 'https://shop.example/Luggage/' }), 'OK');
});

test('a page-content match wins over a redirect', () => {
    assert.strictEqual(check({ redirected: true, finalUrl: 'https://shop.example/search?cgid=x', text: 'no results were found' }), 'No results');
});

test('custom phrases are honoured and empty ones ignored', () => {
    assert.strictEqual(check({ text: 'this item has been discontinued', phrases: ['', 'has been discontinued'] }), 'Not found');
    assert.strictEqual(check({ phrases: [] }), 'OK');
});

test('norm ignores trailing slashes, case, query and encoding differences in the path', () => {
    assert.strictEqual(norm('https://shop.example/A/b/'), norm('https://shop.example/a/B'));
    assert.strictEqual(norm('https://shop.example/a?x=1'), norm('https://shop.example/a'));
    assert.strictEqual(norm('https://shop.example/women%27s'), norm("https://shop.example/women's"));
});

test('isHome recognises site roots', () => {
    assert.ok(isHome('https://shop.example/'));
    assert.ok(isHome('https://host.example/s/brand/'));
    assert.ok(isHome('https://host.example/on/demandware.store/Sites-x-Site/en_US/Home-Show'));
    assert.ok(!isHome('https://shop.example/luggage/'));
});

test('visibleText drops scripts, styles, templates, comments and tags', () => {
    const text = visibleText('<p>Hello&nbsp;there</p><script>var s = "technical error";</script><style>.x{}</style><template>page not found</template><!-- no results found -->');
    assert.strictEqual(text.trim(), 'Hello there');
});

test('csvCell quotes only when needed', () => {
    assert.strictEqual(csvCell('plain'), 'plain');
    assert.strictEqual(csvCell('a,b'), '"a,b"');
    assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
    assert.strictEqual(csvCell(null), '');
});

test('codeOf groups rows by status, and rows that never loaded under No code', () => {
    assert.strictEqual(codeOf({ status: 404 }), '404');
    assert.strictEqual(codeOf({ status: '' }), 'No code');
});

test('sortCodes puts error codes first and No code last', () => {
    assert.deepStrictEqual(sortCodes(['200', 'No code', '503', '404', '410']), ['404', '410', '503', '200', 'No code']);
});

test('matches combines the result, status code and search filters', () => {
    const row = { url: 'https://shop.example/luggage/', finalUrl: 'https://shop.example/luggage/', status: 404, result: 'Not found', title: 'Page Not Found', heading: '', note: 'The site answered 404' };
    assert.ok(matches(row, {}));
    assert.ok(matches(row, { result: 'All', codes: [], q: '' }));
    assert.ok(matches(row, { result: 'Not found', codes: ['404'], q: 'LUGGAGE' }));
    assert.ok(!matches(row, { result: 'Error' }));
    assert.ok(!matches(row, { codes: ['500', '503'] }));
    assert.ok(!matches(row, { q: 'handbags' }));
    assert.ok(matches({ url: 'https://other.example/', status: '', result: 'Skipped', note: '' }, { codes: ['404', 'No code'] }));
});

const long = (text) => text + ' ' + 'more words on the page. '.repeat(10);
const outcome = (overrides) => classify(Object.assign({}, base, overrides));

test('a page that matches the site\'s own not-found page is Not found', () => {
    const missing = { title: 'acme', heading: 'acme', length: base.text.length };
    assert.strictEqual(check({ title: 'Acme', heading: 'Acme', notFoundPage: missing }), 'Not found');
    assert.strictEqual(check({ notFoundPage: missing }), 'OK');
    assert.ok(!sameAsNotFound({ title: 'Acme', heading: 'Acme', text: 'x'.repeat(5000) }, missing));
    assert.ok(!sameAsNotFound({ title: '', heading: '', text: '' }, { title: '', heading: '', length: 0 }));
    assert.ok(!sameAsNotFound(base, null));
});

test('a title or heading that says not found or error decides the result', () => {
    assert.strictEqual(check({ title: 'Page not found | Acme' }), 'Not found');
    assert.strictEqual(check({ title: 'Acme', heading: '404' }), 'Not found');
    assert.strictEqual(check({ title: 'Acme', heading: 'This page doesn\u2019t exist' }), 'Not found');
    assert.strictEqual(check({ title: 'Something went wrong' }), 'Error');
    assert.strictEqual(check({ title: 'Error handling in forms' }), 'Error');
    assert.strictEqual(check({ title: 'Handling errors in forms' }), 'OK');
});

test('noindex in a meta tag or header is a Warning', () => {
    assert.strictEqual(outcome({ robots: 'noindex,follow,' }).result, 'Warning');
    assert.match(outcome({ robots: ',noindex' }).note, /noindex/);
    assert.strictEqual(check({ robots: 'index,follow,' }), 'OK');
});

test('a canonical with a different path is a Warning; a different host alone is not', () => {
    assert.match(outcome({ canonical: 'https://shop.example/bags/' }).note, /different address: https:\/\/shop\.example\/bags\//);
    assert.match(outcome({ canonical: 'https://shop.example/' }).note, /home page/);
    assert.strictEqual(check({ canonical: 'https://www.shop.example/Luggage?x=1' }), 'OK');
    assert.strictEqual(check({ canonical: '' }), 'OK');
});

test('a page with no title and heading, or almost no text, is a Warning', () => {
    assert.match(outcome({ title: '', heading: '' }).note, /No title/);
    assert.match(outcome({ text: 'loading' }).note, /Almost no text/);
    assert.match(outcome({ title: '', heading: '', text: 'loading' }).note, /No title.*Almost no text/);
});

test('warnings do not apply to redirects, files that are not pages, or broken pages', () => {
    assert.strictEqual(check({ text: 'x', isHtml: false }), 'OK');
    assert.strictEqual(check({ robots: 'noindex', redirected: true, finalUrl: 'https://shop.example/new' }), 'Redirect');
    assert.strictEqual(check({ robots: 'noindex', status: 404 }), 'Not found');
});

test('canonicalOf reads the canonical link and resolves it', () => {
    assert.strictEqual(canonicalOf('<link rel="stylesheet" href="/a.css"><link href="/bags" rel="canonical">', 'https://shop.example/x'), 'https://shop.example/bags');
    assert.strictEqual(canonicalOf("<LINK REL='alternate canonical' HREF='https://other.example/p?a=1&amp;b=2'>", 'https://shop.example/x'), 'https://other.example/p?a=1&b=2');
    assert.strictEqual(canonicalOf('<!-- <link rel="canonical" href="/old"> --><p>hi</p>', 'https://shop.example/x'), '');
});

test('robotsOf reads robots and googlebot meta tags only', () => {
    assert.strictEqual(robotsOf('<meta name="robots" content="NOINDEX, follow"><meta name="description" content="noindex">'), 'noindex, follow');
    assert.strictEqual(robotsOf('<meta content="noindex" name=googlebot>'), 'noindex');
    assert.strictEqual(robotsOf('<p>noindex</p>'), '');
});

test('sitemapAddress keeps the sitemap on the site being tested', () => {
    const origin = 'https://shop.example';
    assert.deepStrictEqual(sitemapAddress('/sitemap.xml', origin), { url: 'https://shop.example/sitemap.xml', path: '/sitemap.xml', error: '' });
    assert.strictEqual(sitemapAddress(' sitemaps/blog.xml ', origin).url, 'https://shop.example/sitemaps/blog.xml');
    assert.deepStrictEqual(sitemapAddress('https://shop.example/s/brand/sitemap_index.xml?a=1', origin), { url: 'https://shop.example/s/brand/sitemap_index.xml?a=1', path: '/s/brand/sitemap_index.xml?a=1', error: '' });
    assert.match(sitemapAddress('https://other.example/sitemap.xml', origin).error, /different site \(https:\/\/other\.example\)/);
    assert.match(sitemapAddress('', origin).error, /Enter the path/);
});

test('matches accepts several status codes at once', () => {
    assert.ok(matches({ status: 500, result: 'Error' }, { codes: ['404', '500'] }));
    assert.ok(!matches({ status: 200, result: 'OK' }, { codes: ['404', '500'] }));
});

test('codePreview summarizes the chosen status codes', () => {
    assert.strictEqual(codePreview([]), 'All');
    assert.strictEqual(codePreview(['500', '404']), '404, 500');
    assert.strictEqual(codePreview(['200', '404', '503']), '404, 503, 200');
    assert.strictEqual(codePreview(['200', '404', '503', '410', 'No code']), '404, 410 +3');
});

test('robotsSitemaps reads the Sitemap lines of robots.txt', () => {
    const text = 'User-agent: *\nDisallow: /cart\n# Sitemap: https://shop.example/old.xml\nSitemap: https://shop.example/sitemap_index.xml\n  sitemap:https://shop.example/news.xml\n';
    assert.deepStrictEqual(robotsSitemaps(text), ['https://shop.example/sitemap_index.xml', 'https://shop.example/news.xml']);
    assert.deepStrictEqual(robotsSitemaps('<html><p>Sitemap: none</p></html>'), []);
});

test('pickSitemap prefers an index on the same site and skips what it cannot read', () => {
    const origin = 'https://shop.example';
    assert.strictEqual(pickSitemap(['https://shop.example/news.xml', 'https://shop.example/sitemap_index.xml'], origin), '/sitemap_index.xml');
    assert.strictEqual(pickSitemap(['https://cdn.example/sitemap.xml', '/maps/sitemap.xml?lang=en'], origin), '/maps/sitemap.xml?lang=en');
    assert.strictEqual(pickSitemap(['https://shop.example/sitemap.xml.gz', 'https://other.example/sitemap.xml'], origin), '');
    assert.strictEqual(pickSitemap([], origin), '');
});

test('declaredSitemaps keeps every sitemap robots.txt lists, readable from this site', () => {
    const origin = 'https://dev.shop.example';
    assert.deepStrictEqual(
        declaredSitemaps(['https://dev.shop.example/products.xml', '/blog.xml', 'https://www.shop.example/pages.xml', 'https://dev.shop.example/products.xml', 'https://dev.shop.example/old.xml.gz', 'ftp://dev.shop.example/x.xml'], origin),
        ['https://dev.shop.example/products.xml', 'https://dev.shop.example/blog.xml', 'https://dev.shop.example/pages.xml']
    );
    assert.deepStrictEqual(declaredSitemaps([], origin), []);
});

test('llmsLinks reads Markdown links and bare addresses from llms.txt', () => {
    const text = [
        '# Shop', '', '> Bags and luggage.', '', '## Docs',
        '- [Shipping](https://shop.example/help/shipping.md): how we ship',
        '- [Returns](/help/returns "Returns policy")',
        '- [Shipping again](https://shop.example/help/shipping.md#rates)',
        '- [Email](mailto:help@shop.example)',
        'More at https://shop.example/about.',
        '## Optional', '- [Source](https://github.com/shop/site)'
    ].join('\n');
    assert.deepStrictEqual(llmsLinks(text, 'https://shop.example/llms.txt'), [
        'https://shop.example/help/shipping.md', 'https://shop.example/help/returns', 'https://github.com/shop/site', 'https://shop.example/about'
    ]);
});

test('llmsLinks ignores a web page served in place of llms.txt', () => {
    assert.deepStrictEqual(llmsLinks('<!doctype html><html><a href="https://shop.example/">Home</a></html>', 'https://shop.example/llms.txt'), []);
    assert.deepStrictEqual(llmsLinks('', 'https://shop.example/llms.txt'), []);
});

test('swapOrigin moves a link onto the site being tested and leaves the rest alone', () => {
    const here = 'https://dev.shop.example';
    assert.strictEqual(swapOrigin('https://www.shop.example/bags/tote?color=red#top', here), 'https://dev.shop.example/bags/tote?color=red#top');
    assert.strictEqual(swapOrigin('https://dev.shop.example/bags', here), 'https://dev.shop.example/bags');
    assert.strictEqual(swapOrigin('not a link', here), 'not a link');
});

test('otherSites counts links on other sites and names the main one', () => {
    const links = ['https://www.shop.example/a', 'https://www.shop.example/b', 'https://blog.shop.example/c', 'https://dev.shop.example/d', 'nope'];
    assert.deepStrictEqual(otherSites(links, 'https://dev.shop.example'), { count: 3, host: 'www.shop.example', hosts: 2 });
    assert.deepStrictEqual(otherSites(['https://dev.shop.example/d'], 'https://dev.shop.example'), { count: 0, host: '', hosts: 0 });
});

test('slowLimit judges a page against the run, with a floor of 3 seconds', () => {
    assert.strictEqual(slowLimit([200, 300, 400]), 3000);
    assert.strictEqual(slowLimit([4000, 5000, 6000, '', 5500]), 11000);
    assert.strictEqual(slowLimit([]), 3000);
});

test('a slow page is not a Warning by itself', () => {
    assert.strictEqual(check({ ms: 9000 }), 'OK');
});

test('duration and timeLeft read naturally', () => {
    assert.strictEqual(duration(420), '420 ms');
    assert.strictEqual(duration(1250), '1.3 s');
    assert.strictEqual(timeLeft(40000), 'under a minute left');
    assert.strictEqual(timeLeft(8.4 * 60000), 'about 8 min left');
});

test('slowSite reports the typical time only when most of a run is slow', () => {
    const slowRun = [2300, 2900, 3100, 3300, 3300, 3400, 4200, 6100, 6100, 6300, 7200];
    assert.strictEqual(slowSite(slowRun), 3400);
    assert.strictEqual(slowSite([200, 250, 300, 300, 320, 350, 400, 420, 9000, 9500]), 0);
    assert.strictEqual(slowSite([5000, 6000, 7000]), 0);
    assert.strictEqual(slowSite([]), 0);
});
