# Sitemap Link Checker

A browser extension that checks every link in a sitemap and tells you which ones open a real page, which redirect, and which land on a not-found, empty or error page.

It runs inside your browser, on the site you are testing. That means it works on sites a command-line crawler cannot reach: staging sites behind a password, sites behind bot protection, anything you have to be signed in to see.

Nothing is sent anywhere. The extension has no server, no analytics and no standing access to any site.

## Install

The extension is not in the browser stores yet. To load it from this repository:

1. Download or clone this repository.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the `extension` folder.

Prefer not to install anything? Open `bookmarklet/index.html` in your browser and follow the two steps there. It is the same checker as a bookmark.

## Use

1. Open the site you want to test. Any page will do.
2. Click the **Sitemap Link Checker** button in the toolbar. A panel opens over the page.
3. The sitemap address is filled in (`/sitemap_index.xml` on the current site). Change it if yours lives elsewhere, then click **Load sitemap**.
4. Tick the sitemap files to check and click **Check links**.
5. Filter the results to the problems, and click **Download CSV** to save them.

You can also paste a list of links, one per line, instead of loading a sitemap.

## Results

| Result | Meaning |
|---|---|
| OK | The link opened a normal page. |
| Redirect | The link sent the browser to a different address. The final address is shown. |
| Redirect to home | The link sent the browser to the home page, which usually means the page no longer exists. |
| Not found | The site answered 404 or 410, or the page shows a not-found message. |
| No results | The link opened a search or category page that lists nothing. |
| Error | The site returned an error, the page shows an error message, or the link could not be loaded. |
| Skipped | The link points to a different site. See the limits below. |

Each row also shows the page title and the reason for the result.

### Pages that load but say "not found"

Many sites answer `200 OK` for a page that only says "we can't find that". The checker catches these by looking for phrases in the page's visible text. The list is in the panel under **Not-found and error messages to look for**, one phrase per line:

- a phrase containing `no results` or `(0)` reports the page as **No results**
- a phrase containing `error` reports it as **Error**
- any other phrase reports it as **Not found**

If the checker misses a page on your site, copy the wording from that page into the list and run again. Text inside scripts, styles, templates and comments is ignored.

## Limits

- **One site at a time.** A browser only lets a page read responses from its own site. Run the checker on the site the sitemap belongs to. Links to other sites are listed as Skipped.
- **Redirect type is not reported.** The browser follows redirects itself, so the checker sees that a redirect happened and where it ended, not whether it was a 301 or a 302.
- **Scripted pages.** The checker reads the HTML the server returns. Content that only appears after scripts run is not seen.
- **Pace.** Three links are checked at a time, to stay gentle on the site.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Lets the extension open its panel on the tab you click the button on, for that click only. |
| `scripting` | Used to place the panel's script into that tab. |

The extension asks for no host permissions and cannot see any page you have not clicked the button on.

## Develop

```
npm test         # unit tests for the classification rules (Node 18 or newer, no dependencies)
npm run build    # rebuilds bookmarklet/index.html from extension/checker.js
npm run icons    # redraws the icons
```

- `extension/checker.js` is the whole checker: sitemap loading, link checking, the panel. The decision about each link is one pure function, `classify`, covered by `test/classify.test.js`.
- `extension/background.js` opens the checker when the toolbar button is clicked.
- `bookmarklet/index.html` is generated. Edit `tools/bookmarklet.template.html` and run the build.

After changing `checker.js`, run `npm test` and `npm run build`, then reload the extension on the extensions page.

## License

MIT. See [LICENSE](LICENSE).
