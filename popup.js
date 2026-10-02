/**
 * Popup: turn the TOC on or off for the current site, choose its side, and
 * manage the list of sites. Everything is saved to extension storage, and open
 * tabs apply the change right away.
 */
const Rules = globalThis.GenTocRules;
const $ = id => document.getElementById(id);

let currentKey = null;
let shortcut = '';

main().catch(() => showUnavailable('Something went wrong. Close and reopen the popup.'));

async function main() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  const [[tab], settings, commands] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    Rules.loadSettings(),
    chrome.commands.getAll()
  ]);
  shortcut = commands.find(command => command.name === 'toggle-toc')?.shortcut || '';

  renderShortcut();
  renderPosition(settings.position);
  renderSites(settings.sites);
  await renderCurrentSite(tab, settings);
}

async function renderCurrentSite(tab, settings) {
  const url = pageUrl(tab);
  if (!url) {
    showUnavailable("Gen TOC can't run on this page");
    return;
  }
  currentKey = Rules.siteKey(url);
  const toggle = $('site-toggle');
  $('site-name').textContent = Rules.siteLabel(currentKey);
  toggle.checked = Rules.isEnabled(url, settings.sites);
  toggle.disabled = false;
  toggle.addEventListener('change', async () => {
    if (await setSite(currentKey, toggle.checked)) renderStatus(await pageState(tab.id), toggle.checked);
  });

  const state = await pageState(tab.id);
  if (!state) {
    showUnavailable(url.protocol === 'file:'
      ? 'Turn on "Allow access to file URLs" for Gen TOC in chrome://extensions'
      : "Gen TOC can't run on this page");
    return;
  }
  renderStatus(state, toggle.checked);
}

function pageUrl(tab) {
  try {
    const url = new URL(tab?.url);
    return ['http:', 'https:', 'file:'].includes(url.protocol) ? url : null;
  } catch (error) {
    return null;
  }
}

// Asks the page for its state, injecting the content script first if the tab
// was opened before the extension was installed or updated.
async function pageState(tabId) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: 'getState' });
  try {
    return (await ask()) || null;
  } catch (error) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: Rules.CONTENT_FILES });
      return (await ask()) || null;
    } catch (injectError) {
      return null;
    }
  }
}

function renderStatus(state, on) {
  const status = $('site-status');
  if (!state) {
    status.textContent = on ? 'On' : 'Off';
  } else if (on) {
    status.textContent = state.count
      ? `On · ${state.count} ${state.count === 1 ? 'section' : 'sections'}`
      : 'On · nothing to list yet';
  } else if (state.temporary) {
    status.textContent = 'Off · shown on this page only';
  } else {
    status.textContent = shortcut ? `Off · press ${shortcut} to show once` : 'Off';
  }
}

function showUnavailable(message) {
  $('site-name').textContent = currentKey ? Rules.siteLabel(currentKey) : 'This page';
  $('site-status').textContent = message;
  $('site-toggle').disabled = true;
}

function renderShortcut() {
  $('shortcut-keys').textContent = shortcut || 'Not set';
  $('shortcut').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

function renderPosition(position) {
  const buttons = document.querySelectorAll('[data-position]');
  const select = value => {
    buttons.forEach(button => button.setAttribute('aria-checked', String(button.dataset.position === value)));
  };
  select(position === 'left' ? 'left' : 'right');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      select(button.dataset.position);
      chrome.storage.sync.set({ position: button.dataset.position });
    });
  });
}

function renderSites(sites) {
  const defaults = new Set(Rules.DEFAULT_SITES);
  const custom = Object.keys(sites).filter(key => !defaults.has(key) && sites[key] === true).sort();
  const keys = [...Rules.DEFAULT_SITES, ...custom];
  const list = $('sites-list');
  list.replaceChildren(...keys.map(key => siteRow(key, Rules.isEnabled(siteUrl(key), sites))));
  updateSitesCount();
}

function siteRow(key, enabled) {
  const li = document.createElement('li');
  li.dataset.key = key;
  const name = document.createElement('span');
  name.className = 'site-key';
  name.textContent = Rules.siteLabel(key);
  name.title = key;

  const label = document.createElement('label');
  label.className = 'switch small';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-label', `Show on ${Rules.siteLabel(key)}`);
  input.checked = enabled;
  input.addEventListener('change', async () => {
    if (!(await setSite(key, input.checked))) return;
    if (key === currentKey) {
      $('site-toggle').checked = input.checked;
      renderStatus(null, input.checked);
    }
  });
  const track = document.createElement('span');
  track.className = 'track';
  label.append(input, track);
  li.append(name, label);
  return li;
}

function siteUrl(key) {
  return new URL(key === 'file://' ? 'file:///' : `https://${key}/`);
}

// Saves the choice and mirrors it on every switch for that site. On failure the
// switches go back to what is stored.
async function setSite(key, enabled) {
  let saved = true;
  try {
    const { sites } = await Rules.loadSettings();
    await chrome.storage.sync.set({ sites: Rules.withSite(sites, key, enabled) });
  } catch (error) {
    saved = false;
    enabled = !enabled;
  }
  if (key === currentKey) $('site-toggle').checked = enabled;
  const row = document.querySelector(`#sites-list li[data-key="${CSS.escape(key)}"]`);
  if (row) row.querySelector('input').checked = enabled;
  else if (enabled) $('sites-list').append(siteRow(key, true));
  updateSitesCount();
  return saved;
}

function updateSitesCount() {
  const on = document.querySelectorAll('#sites-list input:checked').length;
  $('sites-count').textContent = `${on} on`;
}
