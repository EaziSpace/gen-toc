# Any-TOC: Chat Table of Contents

A Chrome extension that extracts h1, h2, and h3 headings from the element with id 'main' on a webpage and displays them as a table of contents directly on the page.

## Features

- Automatically detects and extracts headings from the 'main' element
- Displays TOC directly on the webpage as a sidebar (can be toggled between left and right sides)
- Organizes headings in a hierarchical structure
- Allows you to quickly navigate to any section by clicking on a heading
- Supports refreshing the TOC if page content changes
- Highlights the heading when you navigate to it
- Can be collapsed when not needed with a convenient "TOC" button for reopening
- Remembers your preferred position (left/right) and visibility state

## Installation

### From Chrome Web Store (Coming Soon)

1. Visit the Chrome Web Store page for Any-TOC (link to be added)
2. Click "Add to Chrome"
3. Confirm the installation

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the directory containing the extension files
5. The extension should now appear in your Chrome toolbar

## Usage

1. Navigate to any webpage that has an element with id 'main' containing h1, h2, and h3 headings
2. The TOC sidebar will automatically appear on the right side of the page
3. You can:
   - Click on any heading in the TOC to scroll to that section
   - Click the "⇄" button to toggle between left and right sides
   - Click the "↻" button to refresh the TOC if the page content changes
   - Click the "✕" button to collapse the TOC (a "TOC" button will appear on the side of the page to reopen it)
4. You can also use the extension popup (by clicking its icon in the Chrome toolbar) for additional controls

## Customization

The extension works best on pages with a clear heading structure using h1, h2, and h3 tags inside an element with id 'main'. If your target website uses a different id or structure, you may need to modify the `content.js` file:

```javascript
// Find the main container, fallback to document body if not found
const mainContainer = document.getElementById('main') || document.body;
```

Change 'main' to the appropriate id for your target website.

## License

MIT

## Development

Feel free to contribute to this project by submitting pull requests or issues. 