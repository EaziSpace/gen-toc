# Gen TOC: Automatic Table of Contents Generator

A Chrome extension that adds a slim, searchable table of contents to long pages and AI chats.

## Features

- **Out of the way**: a thin rail of ticks sits at the edge of the page. Hover it to open the full list; pin the panel to keep it open.
- **Real structure**: H1–H3 headings in page order, nested by level. Hidden (screen-reader-only) headings and the site's own header, navigation and footer are skipped.
- **AI chats**: on ChatGPT, Gemini and Grok, each of your prompts is a top-level entry with the answer's headings below it.
- **Follows along**: the section you are reading is highlighted on the rail and in the list, and the list updates by itself as content changes, including while an answer is still streaming.
- **Filter**: type to narrow the list. Matching ignores case and accents, so `tieng viet` finds "Tiếng Việt".
- **Keyboard**: `Alt+Shift+T` (`⌥⇧T` on macOS) opens the panel with the filter focused. Use `↑`/`↓` and `Enter` to jump, and `Esc` to close. On a site where Gen TOC is off, the shortcut shows it for that page only.
- **Fits the page**: follows the page's light or dark theme, and the page's CSS can't break it (the UI lives in a Shadow DOM).

## Installation

### From Chrome Web Store

1. Open [Gen TOC on the Chrome Web Store](https://chromewebstore.google.com/detail/gen-toc/linpojpeeboeomnagajacmmkgdeebkpl)
2. Click "Add to Chrome"
3. Confirm the installation

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the directory containing the extension files
5. The extension should now appear in your Chrome toolbar

To use it on local files, turn on "Allow access to file URLs" for Gen TOC on `chrome://extensions/`.

## Usage

1. Open a page with headings. On supported sites the rail appears on the right edge.
2. Hover the rail to open the list, then click an entry to scroll to it.
3. In the panel header, `⇄` moves it to the other side and the pin keeps it open.
4. Click the toolbar icon to open the popup, where you can:
   - turn Gen TOC on or off for the current site (applies immediately, no reload),
   - choose left or right,
   - see or change the shortcut,
   - manage the list of sites.

## Sites

Gen TOC is on by default for:

- ChatGPT (https://chatgpt.com/)
- Gemini (https://gemini.google.com/)
- Grok (https://grok.com/)
- `blog.*` sites and local files

Turn it on for any other site from the popup, or use the shortcut to show it once. Settings are stored in Chrome's extension storage (synced with your Chrome profile). Settings from version 1 are moved over automatically the first time each site is visited.

## Development

Plain JavaScript with no build step:

- `manifest.json`: extension configuration (Manifest V3)
- `site-rules.js`: shared rules: default sites, settings, and how chat prompts are found
- `content.js`: collects headings and renders the rail and panel
- `background.js`: keyboard shortcut, and refreshing open tabs after install or update
- `popup.html` / `popup.js` / `popup.css`: toolbar popup

After editing, reload the extension on `chrome://extensions/`. Open tabs where Gen TOC is on pick up the new version automatically; other tabs get it when the popup or shortcut is used there, or on reload.

## Release notes

See [docs/release-notes.md](docs/release-notes.md).

## License

MIT

## Contributing

Feel free to contribute to this project by submitting pull requests or issues. Suggestions for improvements and bug reports are always welcome!
