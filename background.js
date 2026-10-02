/**
 * Background worker: handles the keyboard shortcut, brings open tabs up to
 * date after an install or update, and merges settings left by version 1.
 */
importScripts('site-rules.js');

const Rules = self.GenTocRules;

function injectContentScript(tabId) {
  return chrome.scripting.executeScript({ target: { tabId }, files: Rules.CONTENT_FILES });
}

// Chrome doesn't inject declared content scripts into pages that were already
// open, and copies from the previous version stop working. Give every open tab
// a fresh copy: it replaces the old UI and stays idle where the TOC is off.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install' && reason !== 'update') return;
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    if (tab.id) injectContentScript(tab.id).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-toc') return;
  const target = tab?.id ? tab : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!target?.id) return;
  try {
    await chrome.tabs.sendMessage(target.id, { type: 'toggle' });
  } catch (error) {
    // No content script in this tab yet (opened before install, or just updated).
    try {
      await injectContentScript(target.id);
      await chrome.tabs.sendMessage(target.id, { type: 'toggle' });
    } catch (injectError) {
      // Pages like chrome:// and the Web Store can't be scripted.
    }
  }
});

// Version 1 settings arrive from many tabs at once (a restored session, say).
// Merging them one at a time keeps one tab from overwriting another's.
let migrations = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'migrateLegacy') return false;
  migrations = migrations
    .then(() => mergeLegacySettings(message))
    .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});

async function mergeLegacySettings({ allowed, disallowed, position }) {
  const stored = await chrome.storage.sync.get(['sites', 'position']);
  let sites = stored.sites || {};
  // A choice already made in this version wins over the old one.
  const merge = (domains, enabled) => {
    for (const domain of Array.isArray(domains) ? domains : []) {
      if (typeof domain === 'string' && domain && !(domain in sites)) sites = Rules.withSite(sites, domain, enabled);
    }
  };
  merge(allowed, true);
  merge(disallowed, false);
  const patch = { sites };
  if (!stored.position && (position === 'left' || position === 'right')) patch.position = position;
  await chrome.storage.sync.set(patch);
}
