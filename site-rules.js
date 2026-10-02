/**
 * Rules shared by the content script, the popup and the background worker:
 * which sites show the TOC, how settings are stored, and how user prompts are
 * found on the supported AI chat sites.
 */
(function (root) {
  // Sites where the TOC is on unless the user turns it off.
  const DEFAULT_SITES = ['chatgpt.com', 'gemini.google.com', 'grok.com'];

  const DEFAULT_SETTINGS = {
    sites: {},          // site key -> true/false, only where it differs from the default
    position: 'right',  // 'left' | 'right'
    pinned: false       // keep the panel open instead of opening on hover
  };

  // Injected together, in this order, wherever the content script is needed.
  const CONTENT_FILES = ['site-rules.js', 'content.js'];

  // On chat sites each user prompt becomes a top-level entry, with the headings
  // of the answer below it. `text` points at the prompt's visible text.
  const CHAT_SITES = [
    { domain: 'chatgpt.com', prompt: '[data-message-author-role="user"]', text: '.whitespace-pre-wrap' },
    { domain: 'gemini.google.com', prompt: 'user-query', text: '.query-text-line' },
    { domain: 'grok.com', prompt: '[data-testid="user-message"]', text: '.message-bubble' }
  ];

  const FILE_KEY = 'file://';

  function matchesDomain(hostname, domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
  }

  function siteKey(url) {
    return url.protocol === 'file:' ? FILE_KEY : url.hostname;
  }

  function siteLabel(key) {
    return key === FILE_KEY ? 'Local files' : key;
  }

  function isDefaultEnabled(key) {
    if (key === FILE_KEY) return true;
    return DEFAULT_SITES.some(domain => matchesDomain(key, domain)) || key.startsWith('blog.');
  }

  function isEnabled(url, sites) {
    const key = siteKey(url);
    if (sites && Object.prototype.hasOwnProperty.call(sites, key)) return sites[key] === true;
    return isDefaultEnabled(key);
  }

  // Returns a copy of `sites` with the key set, dropping entries that match the default.
  function withSite(sites, key, enabled) {
    const next = { ...sites };
    if (enabled === isDefaultEnabled(key)) delete next[key];
    else next[key] = enabled;
    return next;
  }

  function chatSiteFor(hostname) {
    return CHAT_SITES.find(site => matchesDomain(hostname, site.domain)) || null;
  }

  function promptText(element, site) {
    const parts = [...element.querySelectorAll(site.text)].map(node => node.textContent);
    const raw = parts.length ? parts.join(' ') : element.textContent;
    return (raw || '').replace(/\s+/g, ' ').replace(/^you said:?\s*/i, '').trim().slice(0, 200);
  }

  function loadSettings() {
    return chrome.storage.sync.get(DEFAULT_SETTINGS);
  }

  root.GenTocRules = {
    DEFAULT_SITES,
    DEFAULT_SETTINGS,
    CONTENT_FILES,
    siteKey,
    siteLabel,
    isDefaultEnabled,
    isEnabled,
    withSite,
    chatSiteFor,
    promptText,
    loadSettings
  };
})(globalThis);
