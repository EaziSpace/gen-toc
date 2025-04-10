# Gen TOC: Automatic Table of Contents Generator

A Chrome extension that automatically generates a table of contents for any webpage by extracting headings and displaying them in a convenient sidebar.

## Features

- **Universal Compatibility**: Works on most websites with proper heading structure
- **Smart Detection**: Automatically scans and extracts H1-H6 headings from webpages
- **User-Friendly Interface**: 
  - Toggleable sidebar that can be positioned on left or right side
  - Easy navigation to any section by clicking on heading
  - Collapsible design with quick-access TOC button
- **Automatic Updates**: Refreshes when page content changes
- **Customizable**: Works with various website structures
- **State Persistence**: Remembers your preferred position and visibility settings

## Installation

### From Chrome Web Store (Coming Soon)

1. Visit the Chrome Web Store page for Gen TOC
2. Click "Add to Chrome"
3. Confirm the installation

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the directory containing the extension files
5. The extension should now appear in your Chrome toolbar

## Usage

1. Navigate to any webpage with heading elements (h1-h6)
2. The TOC sidebar will automatically appear on the right side of the page
3. You can:
   - Click on any heading in the TOC to scroll to that section
   - Click the "⇄" button to toggle between left and right sides
   - Click the "↻" button to refresh the TOC if the page content changes
   - Click the "✕" button to collapse the TOC (a "TOC" button will appear for reopening)
4. Use the extension popup (by clicking its icon in the Chrome toolbar) for additional controls

## Default Supported Websites

The extension comes pre-configured to work with popular websites including:
- ChatGPT (https://chatgpt.com/)
- Grok (https://grok.com/)
- Gemini (https://gemini.google.com/)

## Customization

While the extension works on most websites out of the box, you can configure it to work on additional sites by adding domains to the allowed list through the popup interface.

## Development

This project uses vanilla JavaScript for the extension's functionality:
- `manifest.json`: Extension configuration
- `content.js`: Main functionality for TOC generation
- `background.js`: Background service worker
- `popup.html/js`: User interface for configuration

## License

MIT

## Contributing

Feel free to contribute to this project by submitting pull requests or issues. Suggestions for improvements and bug reports are always welcome! 