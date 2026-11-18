// Clicking the toolbar button opens the checker on the current tab.
// "activeTab" grants access to that one tab, only for that click, so the extension needs no
// standing access to any site.
chrome.action.onClicked.addListener(function (tab) {
    if (!tab || !tab.id) {
        return;
    }
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['checker.js'] }).catch(function (error) {
        // pages the browser does not allow extensions on (its own pages, the extension store)
        console.warn('Sitemap Link Checker could not open on this page:', error && error.message);
    });
});
