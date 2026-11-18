'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classify, norm, isHome, visibleText, csvCell, DEFAULT_PHRASES } = require('../extension/checker.js');

const base = { requestedUrl: 'https://shop.example/luggage/', finalUrl: 'https://shop.example/luggage/', status: 200, redirected: false, text: 'luggage 20 results', phrases: DEFAULT_PHRASES };
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

test('401 and 403 are reported as not allowed', () => {
    const outcome = classify(Object.assign({}, base, { status: 403 }));
    assert.strictEqual(outcome.result, 'Error');
    assert.match(outcome.note, /signed in/);
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
    assert.strictEqual(check({ redirected: true, finalUrl: 'https://shop.example/login?rurl=1', text: 'log in' }), 'Redirect');
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
