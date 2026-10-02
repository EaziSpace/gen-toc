/**
 * Gen TOC content script.
 *
 * Collects the page's headings (and, on AI chat sites, the user's prompts) and
 * shows them as a slim rail on the edge of the page. Hovering the rail, or the
 * keyboard shortcut, opens a filterable panel. The UI lives in a shadow root so
 * page styles can't reach it, and nothing is ever written onto page elements.
 */
(() => {
  const Rules = globalThis.GenTocRules;
  // Only HTML pages: SVG and XML documents have no body and their elements no style.
  if (!Rules || !chrome.runtime?.id || !(document.documentElement instanceof HTMLElement)) return;

  // A newer copy of this script (injected after an extension update) takes over.
  const TEARDOWN_EVENT = 'gen-toc:teardown';
  document.dispatchEvent(new CustomEvent(TEARDOWN_EVENT));

  const HEADINGS = 'h1, h2, h3';
  const PAGE_CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
  const CONTENT_SECTIONS = 'article, section, main, [role="main"], [role="article"]';
  // Headings shown or hidden by an attribute (tabs, <details>), and theme switches on <html>/<body>.
  const WATCHED_ATTRIBUTES = ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-expanded', 'data-theme', 'data-color-mode'];
  const LEGACY_KEYS = ['any-toc-allowed-domains', 'any-toc-disallowed-domains', 'any-toc-position', 'any-toc-visibility', 'any-toc-config'];
  const LEGACY_NODES = ['any-toc-sidebar', 'any-toc-collapsed'];

  const RESCAN_DELAY = 250;     // wait for a burst of DOM changes to settle...
  const RESCAN_MAX_WAIT = 1000; // ...but refresh at least this often while a chat answer streams
  const OPEN_DELAY = 120;
  const CLOSE_DELAY = 300;
  const TICK_MIN_STEP = 4;
  const TICK_MAX_STEP = 9;
  const HOLD_TRAVEL = 2000; // longest a jump's smooth scroll may take to arrive
  const MIGRATION_WAIT = 1500;

  const pageUrl = new URL(location.href);
  const siteKey = Rules.siteKey(pageUrl);
  const chatSite = Rules.chatSiteFor(pageUrl.hostname);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const darkScheme = matchMedia('(prefers-color-scheme: dark)');

  const MESSAGE_HANDLERS = {
    getState: () => pageState(),
    toggle: () => {
      toggleFromShortcut();
      return pageState();
    }
  };

  let alive = true;
  let settings = { ...Rules.DEFAULT_SETTINGS };
  let enabled = false;
  let temporary = false; // shown through the shortcut on a site that is turned off
  let ui = null;
  let items = [];
  let activeIndex = -1;
  let colorContext = null;

  const ready = init().catch(() => {});
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
  document.addEventListener(TEARDOWN_EVENT, teardown, { once: true });

  async function init() {
    removeLegacyUi();
    // Give the migration a moment so a site turned on in version 1 shows up
    // right away, but never let a slow or missing worker hold the TOC back;
    // if it finishes later, the storage change applies it.
    const migration = migrateLegacySettings().catch(() => {});
    await Promise.race([migration, new Promise(resolve => setTimeout(resolve, MIGRATION_WAIT))]);
    try {
      settings = await Rules.loadSettings();
    } catch (error) {
      // Storage can be unavailable while the extension reloads; defaults still work.
    }
    enabled = Rules.isEnabled(pageUrl, settings.sites);
    sync();
  }

  // An extension update, reload or uninstall leaves this copy running with no
  // extension behind it; remove the UI as soon as that is noticed.
  function contextAlive() {
    if (chrome.runtime?.id) return true;
    teardown();
    return false;
  }

  function sync() {
    if (!alive) return;
    const show = enabled || temporary;
    if (show && !ui) mount();
    else if (!show && ui) unmount();
    if (ui) applySettings();
  }

  function teardown() {
    alive = false;
    unmount();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch (error) {
      // The extension context is already gone.
    }
    document.removeEventListener(TEARDOWN_EVENT, teardown);
  }

  function onMessage(message, sender, sendResponse) {
    const handler = message && MESSAGE_HANDLERS[message.type];
    if (!handler) return false;
    ready.then(handler).then(sendResponse, () => sendResponse(null));
    return true;
  }

  // Re-read everything rather than patching from `changes`, so a change that
  // arrives while init() is still loading can't be applied to stale settings.
  async function onStorageChanged(changes, area) {
    if (area !== 'sync') return;
    await ready;
    try {
      settings = await Rules.loadSettings();
    } catch (error) {
      return;
    }
    if (!alive) return;
    enabled = Rules.isEnabled(pageUrl, settings.sites);
    if (enabled) temporary = false;
    sync();
  }

  function saveSettings(patch) {
    if (!contextAlive()) return;
    Object.assign(settings, patch);
    enabled = Rules.isEnabled(pageUrl, settings.sites);
    if (enabled) temporary = false;
    sync();
    chrome.storage.sync.set(patch).catch(() => {});
  }

  function pageState() {
    return {
      enabled,
      temporary,
      shown: !!ui,
      count: ui ? items.length : collectItems().length
    };
  }

  // Version 1 kept its settings in each site's localStorage. The background
  // worker merges them (one tab at a time); the old keys go once it confirms.
  async function migrateLegacySettings() {
    let legacy;
    try {
      legacy = Object.fromEntries(LEGACY_KEYS.map(key => [key, localStorage.getItem(key)]));
    } catch (error) {
      return;
    }
    if (Object.values(legacy).every(value => value === null)) return;
    const response = await chrome.runtime.sendMessage({
      type: 'migrateLegacy',
      allowed: parseList(legacy['any-toc-allowed-domains']),
      disallowed: parseList(legacy['any-toc-disallowed-domains']),
      position: legacy['any-toc-position']
    });
    if (response?.ok) LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
  }

  // Version 1's sidebar is still in pages that were open during the upgrade.
  function removeLegacyUi() {
    LEGACY_NODES.forEach(id => document.getElementById(id)?.remove());
  }

  function parseList(json) {
    try {
      const value = JSON.parse(json);
      return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
    } catch (error) {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Mounting

  function mount() {
    const host = document.createElement('gen-toc-root');
    host.style.cssText = 'all: initial !important;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${STYLES}</style>${TEMPLATE}`;
    const find = selector => shadow.querySelector(selector);

    ui = {
      host,
      shadow,
      dock: find('.dock'),
      rail: find('.rail'),
      ticks: find('.ticks'),
      panel: find('.panel'),
      count: find('.count'),
      filter: find('.filter'),
      list: find('.list'),
      empty: find('.empty'),
      temp: find('.temp'),
      always: find('.always'),
      pin: find('.pin'),
      swap: find('.swap'),
      open: false,
      reason: null,      // why the panel is open: 'hover' | 'keyboard' | 'pin'
      returnFocus: null,
      visible: [],
      query: '',
      selected: -1,
      perTick: 1,
      scroller: null,
      listDirty: true,
      pinSuppressed: false, // the shortcut hid a pinned panel on this page only
      held: null,        // { el, settled, until }: entry just jumped to, kept active while it stays at the top
      lineFloor: 0,      // where the last jump placed its entry, so the active line sits below sticky headers
      openTimer: 0,
      closeTimer: 0,
      rescanTimer: 0,
      rescanSince: 0,
      frame: 0,
      themeFrame: 0,
      observer: new MutationObserver(onMutations)
    };

    bindUi();
    document.documentElement.appendChild(host);
    ui.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES
    });
    document.addEventListener('scroll', onPageScroll, { capture: true, passive: true });
    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('visibilitychange', contextAlive);
    window.addEventListener('resize', onResize, { passive: true });
    darkScheme.addEventListener('change', scheduleTheme);

    applyTheme();
    rescan();
  }

  function unmount() {
    if (!ui) return;
    ui.observer.disconnect();
    [ui.openTimer, ui.closeTimer, ui.rescanTimer].forEach(clearTimeout);
    cancelAnimationFrame(ui.frame);
    cancelAnimationFrame(ui.themeFrame);
    document.removeEventListener('scroll', onPageScroll, true);
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    document.removeEventListener('visibilitychange', contextAlive);
    window.removeEventListener('resize', onResize);
    darkScheme.removeEventListener('change', scheduleTheme);
    ui.host.remove();
    ui = null;
    items = [];
    activeIndex = -1;
  }

  function bindUi() {
    const { shadow, dock, rail, list, panel } = ui;
    dock.addEventListener('pointerenter', onDockEnter);
    dock.addEventListener('pointerleave', onDockLeave);
    rail.addEventListener('click', event => {
      if (!contextAlive()) return;
      const tick = event.target.closest('.tick');
      if (tick) jumpTo(Number(tick.dataset.i));
      else openPanel('hover');
    });
    rail.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openPanel('keyboard', true);
    });
    list.addEventListener('click', event => {
      if (!contextAlive()) return;
      const button = event.target.closest('.item');
      if (button) jumpTo(Number(button.dataset.i));
    });
    ui.filter.addEventListener('input', renderList);
    panel.addEventListener('keydown', onPanelKey);
    panel.addEventListener('focusout', () => {
      if (ui.reason === 'hover') scheduleClose();
    });
    ui.pin.addEventListener('click', () => {
      ui.pinSuppressed = false;
      saveSettings({ pinned: !settings.pinned });
    });
    ui.swap.addEventListener('click', () => {
      saveSettings({ position: settings.position === 'left' ? 'right' : 'left' });
    });
    ui.always.addEventListener('click', () => {
      saveSettings({ sites: Rules.withSite(settings.sites, siteKey, true) });
    });
    // Keep keystrokes typed into the panel away from the page's own shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input']) {
      shadow.addEventListener(type, event => event.stopPropagation());
    }
  }

  function applySettings() {
    ui.host.dataset.position = settings.position === 'left' ? 'left' : 'right';
    const pinLabel = settings.pinned ? 'Unpin panel' : 'Keep panel open';
    ui.pin.setAttribute('aria-pressed', String(!!settings.pinned));
    ui.pin.setAttribute('aria-label', pinLabel);
    ui.pin.title = pinLabel;
    ui.temp.hidden = !temporary;
    ui.always.textContent = `Always show on ${Rules.siteLabel(siteKey)}`;

    if (settings.pinned && !ui.pinSuppressed) {
      openPanel('pin');
    } else if (ui.open && ui.reason === 'pin') {
      if (ui.dock.matches(':hover')) ui.reason = 'hover';
      else closePanel();
    }
  }

  // ---------------------------------------------------------------------------
  // Collecting entries

  function collectItems() {
    const selector = chatSite ? `${chatSite.prompt}, ${HEADINGS}` : HEADINGS;
    const root = contentRoot(selector);
    const skipPageChrome = root === document.body;
    const found = [];

    for (const el of root.querySelectorAll(selector)) {
      if (chatSite && el.parentElement?.closest(chatSite.prompt)) continue;
      const isPrompt = !!chatSite && el.matches(chatSite.prompt);
      if (!isPrompt && skipPageChrome && inPageChrome(el)) continue;
      if (!isVisible(el)) continue;
      const text = isPrompt ? Rules.promptText(el, chatSite) : headingText(el);
      if (!text && !isPrompt) continue;
      found.push({
        el,
        text,
        kind: isPrompt ? 'prompt' : 'heading',
        tag: isPrompt ? 0 : Number(el.tagName[1])
      });
    }
    return withLevels(found);
  }

  function contentRoot(selector) {
    const articles = document.querySelectorAll('article');
    const candidates = [
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      articles.length === 1 ? articles[0] : null,
      document.getElementById('content')
    ];
    return candidates.find(node => node && node.querySelector(selector)) || document.body || document.documentElement;
  }

  // The site's own header, navigation and footer, but not an article's header.
  function inPageChrome(el) {
    const region = el.closest(PAGE_CHROME);
    return !!region && !region.parentElement?.closest(CONTENT_SECTIONS);
  }

  // Screen-reader-only headings ("ChatGPT said:", "You said") are 1px boxes.
  // checkVisibility() also catches content that keeps its size while hidden,
  // like a closed <details>, and visibility: hidden.
  function isVisible(el) {
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function headingText(el) {
    return cleanText(el.textContent).replace(/^[#¶§]\s*/, '').replace(/\s*[#¶§]$/, '');
  }

  function cleanText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  // Headings are ranked against the smallest heading tag in their section (the
  // whole page, or one chat answer) so the outermost level always starts at 1.
  function withLevels(found) {
    let section = [];
    let base = 1;
    let prompts = 0;
    const flush = () => {
      const min = Math.min(...section.map(item => item.tag));
      section.forEach(item => { item.level = Math.min(4, base + item.tag - min); });
      section = [];
    };

    for (const item of found) {
      if (item.kind !== 'prompt') {
        section.push(item);
        continue;
      }
      if (section.length) flush();
      prompts += 1;
      item.level = 1;
      if (!item.text) item.text = `Prompt ${prompts}`;
      base = 2;
    }
    if (section.length) flush();
    found.forEach(item => { item.key = fold(item.text); });
    return found;
  }

  function sameItems(a, b) {
    return a.length === b.length &&
      a.every((item, i) => item.el === b[i].el && item.text === b[i].text && item.level === b[i].level);
  }

  // Case- and accent-insensitive search key ("Tiếng Việt" matches "tieng viet").
  function fold(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // Keeping up with the page

  function onMutations(records) {
    if (!ui) return;
    let relevant = false;
    for (const record of records) {
      if (record.target === ui.host) continue;
      relevant = true;
      if (record.type === 'attributes' && (record.target === document.documentElement || record.target === document.body)) {
        scheduleTheme();
      }
    }
    if (relevant) scheduleRescan();
  }

  function scheduleRescan() {
    if (!ui) return;
    const now = performance.now();
    if (!ui.rescanSince) ui.rescanSince = now;
    clearTimeout(ui.rescanTimer);
    const wait = Math.min(RESCAN_DELAY, Math.max(0, ui.rescanSince + RESCAN_MAX_WAIT - now));
    ui.rescanTimer = setTimeout(() => {
      if (!ui) return;
      ui.rescanSince = 0;
      rescan();
    }, wait);
  }

  function rescan() {
    if (!ui || !contextAlive()) return;
    if (!ui.host.isConnected) document.documentElement.appendChild(ui.host);

    const next = collectItems();
    if (sameItems(items, next)) {
      updateActive();
      return;
    }
    const selectedEl = items[ui.selected]?.el;
    const activeEl = items[activeIndex]?.el;
    items = next;
    ui.selected = selectedEl ? items.findIndex(item => item.el === selectedEl) : -1;
    ui.scroller = items.length ? scrollParent(items[0].el) : null;
    ui.lineFloor = ui.scroller ? landingLine(ui.scroller) : 0;
    ui.count.textContent = items.length ? String(items.length) : '';
    renderRail();
    if (ui.open) renderList();
    else ui.listDirty = true;
    if (ui.held) {
      activeIndex = items.findIndex(item => item.el === ui.held.el);
      if (activeIndex < 0) ui.held = null;
    }
    if (!ui.held) activeIndex = computeActive();
    markActive(items[activeIndex]?.el !== activeEl);
  }

  function onPageScroll() {
    if (!ui || ui.frame || !contextAlive()) return;
    ui.frame = requestAnimationFrame(() => {
      if (!ui) return;
      ui.frame = 0;
      updateActive();
    });
  }

  function onResize() {
    if (!ui || ui.frame) return;
    ui.frame = requestAnimationFrame(() => {
      if (!ui) return;
      ui.frame = 0;
      renderRail();
      if (!ui.held) activeIndex = computeActive();
      markActive(false);
    });
  }

  function updateActive() {
    if (!ui || isHeld()) return;
    const next = computeActive();
    if (next === activeIndex) return;
    activeIndex = next;
    markActive(true);
  }

  // After a jump the chosen entry stays active, even if the next heading of a
  // short section also lands near the top. The hold ends once the entry has
  // arrived and then leaves the top area, whoever scrolled it away.
  function isHeld() {
    const held = ui.held;
    if (!held) return false;
    const top = held.el.isConnected ? held.el.getBoundingClientRect().top : -Infinity;
    const nearTop = top >= -8 && top <= activeLine();
    if (!held.settled) {
      if (nearTop || performance.now() > held.until) held.settled = true;
      return true;
    }
    if (nearTop) return true;
    ui.held = null;
    return false;
  }

  function activeLine() {
    return Math.max(100, window.innerHeight * 0.2, ui.lineFloor + 24);
  }

  // The active entry is the last one whose top has passed a line near the top
  // of the viewport. At the very bottom of the page, the last visible entry wins.
  function computeActive() {
    const count = items.length;
    if (!count) return -1;
    const line = activeLine();
    let low = 0;
    let high = count - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (items[mid].el.getBoundingClientRect().top <= line) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (isScrolledToBottom()) {
      for (let i = count - 1; i > found; i--) {
        const rect = items[i].el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) return i;
      }
    }
    return found;
  }

  function isScrolledToBottom() {
    const scroller = ui.scroller || document.scrollingElement;
    if (!scroller || scroller.scrollTop <= 0) return false;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
  }

  function scheduleTheme() {
    if (!ui || ui.themeFrame) return;
    ui.themeFrame = requestAnimationFrame(() => {
      if (!ui) return;
      ui.themeFrame = 0;
      applyTheme();
    });
  }

  function applyTheme() {
    const theme = pageLooksDark() ? 'dark' : 'light';
    if (ui && ui.host.dataset.theme !== theme) ui.host.dataset.theme = theme;
  }

  function pageLooksDark() {
    const html = document.documentElement;
    const body = document.body;
    for (const node of [html, body]) {
      if (!node) continue;
      const hint = `${node.className} ${node.getAttribute('data-theme') || ''} ${node.getAttribute('data-color-mode') || ''}`.toLowerCase();
      if (/\bdark\b|dark-theme|theme-dark/.test(hint)) return true;
      if (/\blight\b|light-theme|theme-light/.test(hint)) return false;
    }
    for (const node of [body, html]) {
      if (!node) continue;
      const color = toRgba(getComputedStyle(node).backgroundColor);
      if (color.a > 0.5) return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255 < 0.5;
    }
    if (getComputedStyle(html).colorScheme.trim() === 'dark') return true;
    return darkScheme.matches;
  }

  // Computed colors can come back as rgb(), oklch(), color()...; let canvas normalize them.
  function toRgba(color) {
    colorContext ||= new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = 'rgba(0, 0, 0, 0)';
    colorContext.fillStyle = color;
    colorContext.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorContext.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  }

  // ---------------------------------------------------------------------------
  // Rendering

  function renderRail() {
    const count = items.length;
    ui.rail.hidden = count === 0;
    if (!count && ui.open && ui.reason === 'hover') closePanel();
    updateDockVisibility();
    if (!count) {
      ui.ticks.replaceChildren();
      return;
    }
    // Long pages share one tick between several entries so the rail stays short.
    const maxHeight = Math.min(window.innerHeight * 0.5, 420);
    const perTick = Math.max(1, Math.ceil((count * TICK_MIN_STEP) / maxHeight));
    const tickCount = Math.ceil(count / perTick);
    const step = Math.min(TICK_MAX_STEP, maxHeight / tickCount);
    ui.perTick = perTick;
    ui.ticks.style.setProperty('--gap', `${Math.max(1, (step - 2) / 2)}px`);

    const fragment = document.createDocumentFragment();
    for (let t = 0; t < tickCount; t++) {
      const start = t * perTick;
      const level = Math.min(...items.slice(start, start + perTick).map(item => item.level));
      const tick = document.createElement('div');
      tick.className = `tick lv-${level}`;
      tick.dataset.i = String(start);
      fragment.append(tick);
    }
    ui.ticks.replaceChildren(fragment);
  }

  function renderList() {
    ui.listDirty = false;
    const query = fold(ui.filter.value.trim());
    const visible = [];
    items.forEach((item, i) => {
      if (!query || item.key.includes(query)) visible.push(i);
    });
    ui.visible = visible;

    const scrollTop = ui.list.scrollTop;
    const fragment = document.createDocumentFragment();
    for (const i of visible) {
      const item = items[i];
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `item lv-${item.level}${item.kind === 'prompt' ? ' prompt' : ''}`;
      button.dataset.i = String(i);
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = item.text;
      button.append(label);
      button.title = item.text;
      li.append(button);
      fragment.append(li);
    }
    const queryChanged = query !== ui.query;
    ui.list.replaceChildren(fragment);
    // Re-rendering for page changes keeps the reader's place in the list.
    ui.list.scrollTop = queryChanged ? 0 : scrollTop;
    ui.empty.hidden = visible.length > 0;
    ui.empty.textContent = items.length ? 'No matching headings' : 'No headings on this page yet';

    // A new query starts the keyboard selection at its first match.
    if (queryChanged) ui.selected = query ? (visible[0] ?? -1) : -1;
    else if (query && !visible.includes(ui.selected)) ui.selected = visible[0] ?? -1;
    ui.query = query;
    markActive(queryChanged && !query);
    markSelected(queryChanged);
  }

  // `reveal` scrolls the list to the entry; only done when it actually changed,
  // so the list doesn't jump while the reader scrolls it.
  function markActive(reveal) {
    if (!ui) return;
    ui.ticks.querySelector('.active')?.classList.remove('active');
    ui.list.querySelector('.item.active')?.classList.remove('active');
    if (activeIndex < 0) return;
    ui.ticks.children[Math.floor(activeIndex / ui.perTick)]?.classList.add('active');
    const button = ui.list.querySelector(`.item[data-i="${activeIndex}"]`);
    if (!button) return;
    button.classList.add('active');
    if (reveal && ui.open && !ui.filter.value && ui.selected < 0) keepVisible(ui.list, button);
  }

  function markSelected(reveal) {
    ui.list.querySelector('.item.selected')?.classList.remove('selected');
    if (ui.selected < 0) return;
    const button = ui.list.querySelector(`.item[data-i="${ui.selected}"]`);
    if (!button) return;
    button.classList.add('selected');
    if (reveal) keepVisible(ui.list, button);
  }

  // Scrolls only the panel's list; scrollIntoView could move the page too.
  function keepVisible(container, element) {
    const box = container.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.top < box.top) container.scrollTop -= box.top - rect.top + 8;
    else if (rect.bottom > box.bottom) container.scrollTop += rect.bottom - box.bottom + 8;
  }

  // ---------------------------------------------------------------------------
  // Opening, closing and keyboard

  function openPanel(reason, focus = false) {
    if (!contextAlive()) return;
    clearTimeout(ui.openTimer);
    clearTimeout(ui.closeTimer);
    if (reason === 'hover' && settings.pinned && !ui.pinSuppressed) reason = 'pin';
    const wasOpen = ui.open;
    // Hovering never downgrades a panel opened from the keyboard or pinned.
    if (!wasOpen || reason !== 'hover') ui.reason = reason;
    ui.open = true;
    ui.dock.classList.add('open');
    ui.panel.hidden = false;
    if (!wasOpen) {
      rescan(); // catch anything the observer could not see
      if (!ui || !ui.open) return;
    }
    updateDockVisibility();
    if (ui.listDirty) renderList();
    if (!wasOpen) markActive(true);

    if (focus) {
      if (!ui.shadow.activeElement) ui.returnFocus = document.activeElement;
      if (ui.selected < 0 && activeIndex >= 0) {
        ui.selected = activeIndex;
        markSelected(true);
      }
      ui.filter.focus({ preventScroll: true });
    }
  }

  function closePanel() {
    if (!ui || !ui.open) return;
    clearTimeout(ui.openTimer);
    clearTimeout(ui.closeTimer);
    const hadFocus = !!ui.shadow.activeElement;
    ui.open = false;
    ui.reason = null;
    ui.selected = -1;
    ui.panel.hidden = true;
    ui.dock.classList.remove('open');
    updateDockVisibility();
    if (ui.filter.value) {
      ui.filter.value = '';
      ui.listDirty = true;
    }
    if (hadFocus) restoreFocus();
  }

  function restoreFocus() {
    ui.shadow.activeElement?.blur();
    ui.returnFocus?.focus?.({ preventScroll: true });
    ui.returnFocus = null;
  }

  // A panel opened from the keyboard closes after use, unless it is pinned.
  function finishKeyboardUse() {
    if (settings.pinned && !ui.pinSuppressed) {
      ui.reason = 'pin';
      updateDockVisibility();
    } else {
      closePanel();
    }
  }

  // With nothing to list, only a panel opened from the keyboard is shown (to say
  // so); a pinned panel stays out of the way until entries appear.
  function updateDockVisibility() {
    ui.dock.hidden = items.length === 0 && !(ui.open && ui.reason === 'keyboard');
  }

  function toggleFromShortcut() {
    if (!ui) {
      temporary = true;
      sync();
      if (ui) openPanel('keyboard', true);
      return;
    }
    // A pinned panel waiting for entries is hidden, so it counts as closed here.
    if (!ui.open || ui.dock.hidden) {
      ui.pinSuppressed = false;
      openPanel('keyboard', true);
      return;
    }
    if (temporary) {
      temporary = false;
      sync();
      return;
    }
    // Hide a pinned panel on this page only; the pin setting itself stays.
    if (settings.pinned) ui.pinSuppressed = true;
    closePanel();
  }

  function onDockEnter() {
    if (!contextAlive()) return;
    clearTimeout(ui.closeTimer);
    if (!ui.open) ui.openTimer = setTimeout(() => openPanel('hover'), OPEN_DELAY);
  }

  function onDockLeave() {
    clearTimeout(ui.openTimer);
    if (ui.open && ui.reason === 'hover') scheduleClose();
  }

  function scheduleClose() {
    clearTimeout(ui.closeTimer);
    ui.closeTimer = setTimeout(() => {
      if (!ui || !ui.open || ui.reason !== 'hover') return;
      if (ui.dock.matches(':hover') || ui.shadow.activeElement === ui.filter) return;
      closePanel();
    }, CLOSE_DELAY);
  }

  function onOutsidePointer(event) {
    if (!ui || !ui.open || ui.reason !== 'keyboard') return;
    if (event.composedPath().includes(ui.host)) return;
    finishKeyboardUse();
  }

  function onPanelKey(event) {
    if (event.isComposing) return; // IME (e.g. Vietnamese Telex) is still composing
    if (event.key === 'Escape') {
      event.preventDefault();
      if (ui.filter.value) {
        ui.filter.value = '';
        renderList();
      } else {
        finishKeyboardUse();
        if (ui.open) restoreFocus();
      }
      return;
    }
    if (event.target !== ui.filter) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = ui.selected >= 0 ? ui.selected : ui.visible[0];
      if (target !== undefined) jumpTo(target);
    }
  }

  function moveSelection(delta) {
    const visible = ui.visible;
    if (!visible.length) return;
    let position = visible.indexOf(ui.selected);
    if (position < 0) position = delta > 0 ? 0 : visible.length - 1;
    else position = Math.min(visible.length - 1, Math.max(0, position + delta));
    ui.selected = visible[position];
    markSelected();
  }

  // ---------------------------------------------------------------------------
  // Jumping to an entry

  function jumpTo(index) {
    const item = items[index];
    if (!item) return;
    if (!item.el.isConnected) {
      scheduleRescan();
      return;
    }
    scrollToElement(item.el);
    flash(item.el);

    activeIndex = index;
    ui.held = { el: item.el, settled: false, until: performance.now() + HOLD_TRAVEL };
    markActive(true);

    if (ui.reason === 'keyboard') finishKeyboardUse();
  }

  // Chat sites scroll an inner container rather than the window, and most sites
  // have a sticky header that would otherwise cover the target.
  function scrollToElement(el) {
    const scroller = scrollParent(el);
    const landing = landingLine(scroller);
    ui.lineFloor = landing;
    const behavior = reducedMotion.matches ? 'auto' : 'smooth';
    (isPageScroller(scroller) ? window : scroller).scrollBy({ top: el.getBoundingClientRect().top - landing, behavior });
  }

  // Where a jump puts its entry: just below the scroller's top edge and any sticky header.
  function landingLine(scroller) {
    const box = isPageScroller(scroller) ? { top: 0, left: 0, width: window.innerWidth } : scroller.getBoundingClientRect();
    return stickyHeaderBottom(scroller, box) + 12;
  }

  function isPageScroller(scroller) {
    return scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
  }

  function scrollParent(el) {
    for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && node.scrollHeight > node.clientHeight + 1) {
        return node;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function stickyHeaderBottom(scroller, box) {
    let bottom = box.top;
    const probes = document.elementsFromPoint(box.left + box.width / 2, box.top + 2).slice(0, 3);
    for (const probe of probes) {
      if (probe === ui.host) continue;
      for (let node = probe; node && node !== scroller && node !== document.body && node !== document.documentElement; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position !== 'fixed' && position !== 'sticky') continue;
        const rect = node.getBoundingClientRect();
        if (rect.height < window.innerHeight * 0.4) bottom = Math.max(bottom, rect.bottom);
        break;
      }
    }
    return bottom;
  }

  // A Web Animation leaves no trace on the element once it finishes, so
  // repeated clicks can't leave a highlight behind.
  function flash(el) {
    if (typeof el.animate !== 'function') return;
    const glow = 'rgba(59, 130, 246, 0.26)';
    const clear = 'rgba(59, 130, 246, 0)';
    el.animate(
      [
        { backgroundColor: glow, boxShadow: `0 0 0 6px ${glow}`, borderRadius: '4px' },
        { backgroundColor: clear, boxShadow: `0 0 0 6px ${clear}`, borderRadius: '4px' }
      ],
      { duration: reducedMotion.matches ? 700 : 1400, delay: reducedMotion.matches ? 0 : 300, easing: 'ease-out' }
    );
  }

  // ---------------------------------------------------------------------------
  // Markup and styles

  const ICON = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const TEMPLATE = `
    <div class="dock" hidden>
      <nav class="rail" aria-label="Table of contents" tabindex="0" hidden><div class="ticks"></div></nav>
      <section class="panel" aria-label="Table of contents" hidden>
        <header class="head">
          <span class="title">Contents</span>
          <span class="count"></span>
          <button type="button" class="icon swap" title="Move to the other side" aria-label="Move to the other side">
            ${ICON('<path d="m8 3-4 4 4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>')}
          </button>
          <button type="button" class="icon pin" aria-pressed="false">
            ${ICON('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>')}
          </button>
        </header>
        <label class="search">
          ${ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}
          <input class="filter" type="text" placeholder="Filter headings" aria-label="Filter headings" spellcheck="false" autocomplete="off">
        </label>
        <ol class="list"></ol>
        <p class="empty" hidden></p>
        <footer class="temp" hidden>
          <span>Shown on this page only.</span>
          <button type="button" class="link always"></button>
        </footer>
      </section>
    </div>`;

  const PROMPT_ICON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z'/%3E%3C/svg%3E\")";

  const STYLES = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }

    .dock {
      --bg: #ffffff;
      --fg: #1f2328;
      --muted: #656d76;
      --line: rgba(15, 23, 42, 0.1);
      --hover: rgba(15, 23, 42, 0.06);
      --tick: rgba(15, 23, 42, 0.26);
      --accent: #2563eb;
      --accent-soft: rgba(37, 99, 235, 0.12);
      --shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.08);
      position: fixed;
      top: 50%;
      right: 14px;
      transform: translateY(-50%);
      z-index: 2147483646;
      display: flex;
      flex-direction: row-reverse;
      align-items: center;
      gap: 6px;
      color: var(--fg);
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    :host([data-theme="dark"]) .dock {
      --bg: #1f2023;
      --fg: #e8e8ea;
      --muted: #9ba1a8;
      --line: rgba(255, 255, 255, 0.1);
      --hover: rgba(255, 255, 255, 0.07);
      --tick: rgba(255, 255, 255, 0.3);
      --accent: #7aa7ff;
      --accent-soft: rgba(122, 167, 255, 0.16);
      --shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3);
    }
    :host([data-position="left"]) .dock { right: auto; left: 14px; flex-direction: row; }

    .rail {
      display: flex;
      flex-direction: column;
      padding: 10px 8px;
      border-radius: 10px;
      cursor: pointer;
      outline: none;
      transition: background-color 0.15s;
    }
    .rail:hover, .dock.open .rail { background: var(--hover); }
    .rail:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
    .ticks { display: flex; flex-direction: column; align-items: flex-end; }
    :host([data-position="left"]) .ticks { align-items: flex-start; }
    .tick {
      flex: none;
      width: var(--w);
      height: 2px;
      margin: var(--gap) 0;
      border-radius: 2px;
      background: var(--tick);
      transition: width 0.15s, background-color 0.15s;
    }
    .tick.lv-1 { --w: 16px; }
    .tick.lv-2 { --w: 11px; }
    .tick.lv-3 { --w: 7px; }
    .tick.lv-4 { --w: 5px; }
    .tick.active { width: calc(var(--w) + 6px); background: var(--accent); }

    .panel {
      display: flex;
      flex-direction: column;
      width: 300px;
      max-height: min(70vh, 560px);
      overflow: hidden;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 12px;
      box-shadow: var(--shadow);
      animation: slide-in 0.14s ease-out;
    }
    :host([data-position="left"]) .panel { animation-name: slide-in-left; }
    @keyframes slide-in { from { opacity: 0; transform: translateX(6px); } }
    @keyframes slide-in-left { from { opacity: 0; transform: translateX(-6px); } }

    .head { display: flex; align-items: center; gap: 4px; padding: 10px 8px 6px 14px; }
    .title { font-weight: 600; }
    .count { margin-right: auto; padding-left: 4px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }

    button { font: inherit; color: inherit; }
    .icon {
      all: unset;
      box-sizing: border-box;
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 7px;
      color: var(--muted);
      cursor: pointer;
    }
    .icon:hover { background: var(--hover); color: var(--fg); }
    .icon:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
    .icon[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
    .icon svg { width: 15px; height: 15px; }

    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 34px;
      margin: 2px 10px 8px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--muted);
      cursor: text;
    }
    .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .search svg { flex: none; width: 14px; height: 14px; }
    .filter { all: unset; box-sizing: border-box; flex: 1; min-width: 0; color: var(--fg); font: inherit; }
    .filter::placeholder { color: var(--muted); }

    .list {
      flex: 1 1 auto;
      min-height: 0;
      margin: 0;
      padding: 0 6px 8px;
      list-style: none;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }
    .list li:has(> .prompt):not(:first-child) { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--line); }
    .item {
      all: unset;
      box-sizing: border-box;
      position: relative;
      display: block;
      width: 100%;
      padding: 5px 8px 5px calc(12px + var(--indent, 0px));
      border-radius: 7px;
      color: var(--muted);
      cursor: pointer;
    }
    /* Clamped inside the padding box, so a cut-off third line can't peek through. */
    .item .label {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .item.lv-1 { color: var(--fg); font-weight: 500; }
    .item.lv-2 { --indent: 12px; }
    .item.lv-3 { --indent: 24px; }
    .item.lv-4 { --indent: 36px; }
    .item.prompt { padding-left: 32px; }
    .item.prompt::after {
      content: "";
      position: absolute;
      top: 8px;
      left: 12px;
      width: 13px;
      height: 13px;
      background: currentColor;
      opacity: 0.7;
      -webkit-mask: ${PROMPT_ICON} center / contain no-repeat;
      mask: ${PROMPT_ICON} center / contain no-repeat;
    }
    .item:hover, .item.selected { background: var(--hover); color: var(--fg); }
    .item:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
    .item.active { color: var(--accent); }
    .item.active::before {
      content: "";
      position: absolute;
      top: 7px;
      bottom: 7px;
      left: 3px;
      width: 3px;
      border-radius: 3px;
      background: var(--accent);
    }

    .empty { margin: 4px 14px 14px; color: var(--muted); }
    .temp {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 9px 14px 11px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }
    .link { all: unset; color: var(--accent); font-weight: 500; cursor: pointer; }
    .link:hover { text-decoration: underline; }
    .link:focus-visible { box-shadow: 0 0 0 2px var(--accent); border-radius: 3px; }

    @media (prefers-reduced-motion: reduce) {
      .panel { animation: none; }
      .tick, .rail { transition: none; }
    }
    @media print { .dock { display: none !important; } }
  `;
})();
