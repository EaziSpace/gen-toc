# Release notes

## 2.0.0

A redesigned table of contents that stays out of your way.

### New

- **Slim rail**: a thin strip of ticks sits at the edge of the page. Hover it to open the full list, or pin the panel to keep it open.
- **Built for AI chats**: on ChatGPT, Gemini and Grok, each of your prompts becomes a top-level entry, with the answer's headings listed below it.
- **Follows your reading**: the section you are reading is highlighted on the rail and in the list.
- **Filter**: type to narrow the list. Matching ignores case and accents.
- **Keyboard shortcut**: `Alt+Shift+T` (`⌥⇧T` on Mac) opens the list with the filter focused. Use `↑`/`↓` and `Enter` to jump, and `Esc` to close. On a site where Gen TOC is off, the shortcut shows it for that page only. You can change the shortcut at `chrome://extensions/shortcuts`.
- **Light and dark**: the panel follows the page's theme.
- **New popup**: one switch for the current site, a left/right choice, the shortcut, and your list of sites.

### Changed

- Headings are now listed top to bottom in page order, nested by level. Version 1 listed the newest heading first.
- Left or right is now one setting for all sites. If you used different sides on different sites, the first site you visit after updating decides.
- Turning Gen TOC on or off for a site takes effect right away, without reloading the page.
- Settings are kept in Chrome's extension storage and follow your Chrome profile when Chrome sync is on. The sites you turned on or off in version 1 carry over automatically the next time you visit each one.
- The collapsed "TOC" tab is gone; the rail takes its place.
- Permissions: adds `storage` to save your settings, and no longer uses `activeTab`.

### Fixed

- The list updates by itself as the page changes, including while an AI answer is still streaming.
- The panel no longer lists its own "Table of Contents" title.
- Clicking an entry twice no longer leaves a yellow highlight behind, and the highlight is readable on dark pages.
- Jumping to a heading lands below sticky headers, including on chat sites that scroll an inner area instead of the page.
- A site's own styles can no longer break the panel's layout.
