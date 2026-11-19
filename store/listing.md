# Chrome Web Store listing

Text to paste into the Developer Dashboard. The images are in this folder.

## Store listing tab

**Name** (from the manifest)

Sitemap Link Checker

**Summary** (from the manifest, 132 characters at most)

Check every link in a sitemap from the site you are on: real page, redirect, not found, no results or error.

**Description**

Sitemap Link Checker checks every link in a sitemap and tells you which ones open a real page, which redirect, and which land on a not-found, empty or error page.

It runs inside your browser, on the site you are testing. That means it works where a command-line crawler cannot: staging sites behind a password, sites behind bot protection, and anything you have to be signed in to see.

HOW TO USE IT
1. Open the site you want to test.
2. Click the Sitemap Link Checker button. A panel opens over the page.
3. The sitemap address is found for you (from the page, or the site's robots.txt). Click Load sitemap.
4. Tick the sitemap files to check and click Check links.
5. Filter the results and download them as CSV.

WHAT IT FINDS
- Not found: 404 and 410, and pages that answer 200 but are really the site's not-found page
- No results: search and category pages that list nothing
- Errors: server errors and pages that show an error message
- Redirects, including redirects to the home page
- Warnings: pages marked noindex, pages whose canonical points elsewhere, and pages with no title or almost no text

BUILT FOR REAL SITES
- Sign-ins and bot checks: if the site pushes back, the run pauses, tells you what to do, and picks up where it left off
- Staging sites: check a production sitemap's links on the staging site you are on
- Every sitemap in robots.txt is found for you, and the links in the site's llms.txt can be checked too
- Filters for result and status code, search, copy links, and CSV export
- Recheck only the problems after a fix
- Response time for every page, and a note when the whole site is slow

PRIVATE BY DESIGN
Nothing is sent anywhere. The extension has no server and no analytics, and it only has access to the tab you click its button on.

Open source (MIT): https://github.com/summit-ml/sitemap-link-checker

**Category**

Developer Tools

**Language**

English

**Images**

| Slot | File |
|---|---|
| Store icon, 128×128 | `../extension/icons/icon-128.png` |
| Screenshots, 1280×800 | `screenshot-1-results.png` to `screenshot-5-sitemap-files.png` |
| Small promo tile, 440×280 | `promo-small-440x280.png` |
| Marquee promo tile, 1400×560 | `promo-marquee-1400x560.png` |

## Privacy tab

**Single purpose**

Checks the links listed in a website's sitemap, on the site the user is viewing, and reports which ones are broken, redirected, empty or blocked.

**Permission justifications**

- `activeTab`: The checker opens as a panel on the page the user is viewing when they click the toolbar button. activeTab grants access to that one tab for that click, so the extension needs no standing access to any site.
- `scripting`: Used to place the checker's panel script into the tab the user clicked the button on.

**Remote code**

No. All code is in the package.

**Data usage**

The extension does not collect or use any user data. Tick none of the data categories, and certify the three disclosures (no sale of data, no unrelated use, no use for creditworthiness).

**Privacy policy URL**

Not required when no user data is collected. If the dashboard asks for one, the README's opening section states the policy: https://github.com/summit-ml/sitemap-link-checker#readme

## Distribution tab

- Visibility: Public
- Regions: All regions
- Pricing: Free
