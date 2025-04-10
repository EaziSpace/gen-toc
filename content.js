/**
 * Content script that runs on the page and extracts headings
 * from the main content area to build a table of contents.
 */

// Constants for actions
const ACTIONS = {
  PING: 'ping',
  GET_HEADINGS: 'getHeadings',
  SCROLL_TO_HEADING: 'scrollToHeading',
  TOGGLE: 'toggle',
  REFRESH: 'refresh',
  SET_POSITION: 'setPosition',
  GET_POSITION: 'getPosition'
};

// Setup variables to control initialization
window.isInitialized = false;
let initTocTimeout;

// Notify that content script has been loaded
console.log('Content script loaded, sending ping to background');
sendPingToBackground();

// Run initTOC immediately when content script runs
try {
  initTOC();
} catch (e) {
  console.error('Error initializing TOC immediately:', e);
}

// Initialize TOC when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOnDOMContentLoaded);
} else {
  initOnDOMContentLoaded();
}

// Set periodic ping to ensure background knows we're ready
setInterval(sendPingToBackground, 10000);

/**
 * Send ping message to background script
 */
function sendPingToBackground() {
  try {
    chrome.runtime.sendMessage({ action: ACTIONS.PING }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Error sending ping to background:', chrome.runtime.lastError);
      } else {
        console.log('Background responded to ping:', response);
      }
    });
  } catch (e) {
    console.error('Exception sending ping:', e);
  }
}

/**
 * Initialize TOC when DOM is ready
 */
function initOnDOMContentLoaded() {
  console.log('DOM content loaded, initializing TOC');
  try {
    initTOC();
    
    // Try again after a delay if not successful
    initTocTimeout = setTimeout(() => {
      console.log('Timeout fired, initializing TOC again');
      try {
        initTOC();
      } catch (e) {
        console.error('Error initializing TOC on timeout:', e);
      }
    }, 1000);
  } catch (e) {
    console.error('Error initializing TOC on DOMContentLoaded:', e);
  }
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in content script:', message);
  console.log('Message action type:', typeof message.action);
  console.log('Message action value:', message.action);
  console.log('Comparing with TOGGLE:', message.action === ACTIONS.TOGGLE);
  console.log('Comparing with REFRESH:', message.action === ACTIONS.REFRESH);
  
  try {
    // Handle ping from background script to check connection
    if (message.action === ACTIONS.PING) {
      console.log('Received ping in content script');
      sendResponse({ pong: true });
      return true;
    }
    
    switch (message.action) {
      case ACTIONS.GET_HEADINGS:
        const headings = extractHeadings();
        sendResponse(headings);
        break;
        
      case ACTIONS.SCROLL_TO_HEADING:
        scrollToHeading(message.id, message.position);
        sendResponse({ success: true });
        break;
        
      case ACTIONS.TOGGLE:
        console.log('Toggle TOC message received');
        console.log('Toggle action matched successfully');
        toggleTOCSidebar();
        sendResponse({ success: true });
        break;
        
      case ACTIONS.REFRESH:
        console.log('Refresh TOC message received');
        console.log('Refresh action matched successfully');
        refreshTOC();
        sendResponse({ success: true });
        break;
        
      case ACTIONS.SET_POSITION:
        console.log('Set position message received:', message.position);
        setPosition(message.position);
        sendResponse({ success: true });
        break;
        
      case ACTIONS.GET_POSITION:
        console.log('Get position message received');
        const position = getCurrentPosition();
        sendResponse({ position: position });
        break;
        
      default:
        console.warn('Unknown action:', message.action);
        sendResponse({ error: 'Unknown action' });
    }
  } catch (e) {
    console.error('Error handling message:', e);
    sendResponse({ error: e.message });
  }
  
  return true; // Keep connection open to ensure sendResponse works
});

/**
 * Creates and injects the TOC sidebar
 */
function initTOC() {
  // If successfully initialized before, no need to do it again
  if (window.isInitialized) {
    console.log('TOC already initialized, skipping');
    return;
  }

  // Clear any pending timeout
  if (initTocTimeout) {
    clearTimeout(initTocTimeout);
    initTocTimeout = null;
  }

  // Check if TOC already exists to avoid duplicates
  if (document.getElementById('any-toc-sidebar')) {
    console.log('TOC sidebar already exists, skipping initialization');
    window.isInitialized = true;
    return;
  }
  
  console.log('Creating TOC sidebar elements');
  
  try {
    // Create the TOC sidebar container
    const tocSidebar = document.createElement('div');
    tocSidebar.id = 'any-toc-sidebar';
    tocSidebar.className = 'any-toc-sidebar';
    
    // Create header with title and controls
    const tocHeader = document.createElement('div');
    tocHeader.className = 'any-toc-header';
    
    const tocTitle = document.createElement('h2');
    tocTitle.textContent = 'Table of Contents';
    tocHeader.appendChild(tocTitle);
    
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'any-toc-controls';
    
    // Create toggle position button (left/right)
    const togglePosButton = document.createElement('button');
    togglePosButton.textContent = '⇄';
    togglePosButton.title = 'Toggle Position';
    togglePosButton.className = 'any-toc-button';
    togglePosButton.addEventListener('click', (e) => {
      console.log('Toggle position button clicked');
      togglePosition();
      e.stopPropagation();
    });
    
    // Create refresh button
    const refreshButton = document.createElement('button');
    refreshButton.textContent = '↻';
    refreshButton.title = 'Refresh TOC';
    refreshButton.className = 'any-toc-button';
    refreshButton.addEventListener('click', (e) => {
      console.log('Refresh button clicked');
      refreshTOC();
      e.stopPropagation();
    });
    
    // Create close/collapse button
    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.title = 'Close TOC';
    closeButton.className = 'any-toc-button';
    closeButton.addEventListener('click', (e) => {
      console.log('Close button clicked');
      toggleTOCSidebar();
      e.stopPropagation();
    });
    
    controlsContainer.appendChild(togglePosButton);
    controlsContainer.appendChild(refreshButton);
    controlsContainer.appendChild(closeButton);
    tocHeader.appendChild(controlsContainer);
    
    tocSidebar.appendChild(tocHeader);
    
    // Create container for the TOC list
    const tocContainer = document.createElement('div');
    tocContainer.className = 'any-toc-container';
    
    const loadingElement = document.createElement('div');
    loadingElement.id = 'any-toc-loading';
    loadingElement.textContent = 'Scanning page for headings...';
    
    const noHeadingsElement = document.createElement('div');
    noHeadingsElement.id = 'any-toc-no-headings';
    noHeadingsElement.textContent = 'No headings found';
    noHeadingsElement.style.display = 'none';
    
    const tocList = document.createElement('ul');
    tocList.id = 'any-toc-list';
    
    tocContainer.appendChild(loadingElement);
    tocContainer.appendChild(noHeadingsElement);
    tocContainer.appendChild(tocList);
    
    tocSidebar.appendChild(tocContainer);
    
    // Create collapsed button that appears when sidebar is closed
    const collapsedButton = document.createElement('div');
    collapsedButton.id = 'any-toc-collapsed';
    collapsedButton.className = 'any-toc-collapsed';
    collapsedButton.title = 'Show Table of Contents';
    collapsedButton.textContent = 'TOC';
    collapsedButton.addEventListener('click', (e) => {
      console.log('Collapsed button clicked');
      toggleTOCSidebar();
      e.stopPropagation();
    });
    
    // Insert the TOC elements into the page
    console.log('Appending TOC elements to document body');
    document.body.appendChild(tocSidebar);
    document.body.appendChild(collapsedButton);
    
    // Style is now loaded from content.css
    
    // Load the TOC content
    console.log('Loading TOC content');
    refreshTOC();
    
    // Save position preference if set
    const position = localStorage.getItem('any-toc-position');
    console.log('Saved position:', position);
    if (position === 'left') {
      tocSidebar.classList.add('left');
      collapsedButton.classList.add('left');
    }
    
    // Set visibility based on saved preference
    const visibility = localStorage.getItem('any-toc-visibility');
    console.log('Saved visibility:', visibility);
    if (visibility === 'hidden') {
      tocSidebar.classList.add('hidden');
      collapsedButton.classList.add('visible');
    } else {
      // Make sure collapsed button is not visible by default
      collapsedButton.classList.remove('visible');
    }
    
    console.log('TOC initialization completed successfully');
    window.isInitialized = true;
    
  } catch (error) {
    console.error('Error initializing TOC:', error);
  }
}

/**
 * Toggles the TOC sidebar visibility
 */
window.toggleTOCSidebar = function() {
  console.log('toggleTOCSidebar called');
  
  const tocSidebar = document.getElementById('any-toc-sidebar');
  const collapsedButton = document.getElementById('any-toc-collapsed');
  
  if (!tocSidebar || !collapsedButton) {
    console.error('TOC elements not found in the DOM');
    return;
  }
  
  console.log('Current state - sidebar hidden:', tocSidebar.classList.contains('hidden'));
  console.log('Current state - collapsed visible:', collapsedButton.classList.contains('visible'));
  
  if (tocSidebar.classList.contains('hidden')) {
    console.log('Showing sidebar');
    tocSidebar.classList.remove('hidden');
    collapsedButton.classList.remove('visible');
    localStorage.setItem('any-toc-visibility', 'visible');
  } else {
    console.log('Hiding sidebar');
    tocSidebar.classList.add('hidden');
    collapsedButton.classList.add('visible');
    localStorage.setItem('any-toc-visibility', 'hidden');
  }
};

/**
 * Toggles the position of the TOC sidebar (left or right)
 */
window.togglePosition = function() {
  console.log('togglePosition called');
  
  const tocSidebar = document.getElementById('any-toc-sidebar');
  const collapsedButton = document.getElementById('any-toc-collapsed');
  
  if (!tocSidebar || !collapsedButton) {
    console.error('TOC elements not found in the DOM');
    return;
  }
  
  if (tocSidebar.classList.contains('left')) {
    setPosition('right');
  } else {
    setPosition('left');
  }
};

/**
 * Sets the position of the TOC sidebar (left or right)
 * @param {string} position - 'left' or 'right'
 */
window.setPosition = function(position) {
  console.log('setPosition called with:', position);
  
  const tocSidebar = document.getElementById('any-toc-sidebar');
  const collapsedButton = document.getElementById('any-toc-collapsed');
  
  if (!tocSidebar || !collapsedButton) {
    console.error('TOC elements not found in the DOM');
    return;
  }
  
  if (position === 'left') {
    console.log('Moving to left side');
    tocSidebar.classList.add('left');
    collapsedButton.classList.add('left');
    localStorage.setItem('any-toc-position', 'left');
  } else {
    console.log('Moving to right side');
    tocSidebar.classList.remove('left');
    collapsedButton.classList.remove('left');
    localStorage.setItem('any-toc-position', 'right');
  }
  
  return position;
};

/**
 * Refreshes the TOC content
 */
window.refreshTOC = function() {
  const tocList = document.getElementById('any-toc-list');
  const loadingElement = document.getElementById('any-toc-loading');
  const noHeadingsElement = document.getElementById('any-toc-no-headings');
  
  // Clear existing content
  tocList.innerHTML = '';
  loadingElement.style.display = 'block';
  noHeadingsElement.style.display = 'none';
  
  // Get headings and build TOC
  const headings = extractHeadings();
  
  if (headings && headings.length > 0) {
    buildTOC(headings);
  } else {
    loadingElement.style.display = 'none';
    noHeadingsElement.style.display = 'block';
  }
};

/**
 * Builds the TOC from the extracted headings
 * @param {Array} headings - Array of heading objects
 */
function buildTOC(headings) {
  const tocList = document.getElementById('any-toc-list');
  const loadingElement = document.getElementById('any-toc-loading');
  
  loadingElement.style.display = 'none';
  
  headings.forEach(heading => {
    const listItem = document.createElement('li');
    const link = document.createElement('a');
    
    // Set the text and class based on heading level
    link.textContent = heading.text;
    link.classList.add(`any-toc-h${heading.level}`);
    link.classList.add('any-toc-link');
    
    // Set up click handler to scroll to the heading
    link.addEventListener('click', () => {
      scrollToHeading(heading.id, heading.position);
    });
    
    listItem.appendChild(link);
    tocList.appendChild(listItem);
  });
}

/**
 * Extracts all h1, h2, h3 headings from the #main element
 * @returns {Array} An array of heading objects containing text, level, and position
 */
window.extractHeadings = function() {
  const headings = [];
  
  // Find the main container, fallback to document body if not found
  const mainContainer = document.getElementById('main') || document.body;
  
  // Find all h1, h2, h3 elements inside the main container
  const headingElements = mainContainer.querySelectorAll('h1, h2, h3');
  
  // If no headings are found, return empty array
  if (headingElements.length === 0) {
    return headings;
  }
  
  // Extract information from each heading
  headingElements.forEach((heading, index) => {
    // Get the heading text and trim whitespace
    const text = heading.textContent.trim();
    
    // Skip empty headings
    if (!text) return;
    
    // Extract the heading level from the tag name (h1 -> 1, h2 -> 2, etc.)
    const level = parseInt(heading.tagName.substring(1), 10);
    
    // Get the position of the heading for scrolling
    const position = heading.getBoundingClientRect().top + window.pageYOffset;
    
    // Add a unique ID to the heading if it doesn't have one
    if (!heading.id) {
      heading.id = `toc-heading-${index}`;
    }
    
    // Add the heading data to our array
    headings.push({
      text,
      level,
      id: heading.id,
      position
    });
  });
  
  return headings;
};

/**
 * Scrolls the page to the heading with the given ID
 * @param {string} id - The ID of the heading element
 * @param {number} position - The Y position of the heading
 */
window.scrollToHeading = function(id, position) {
  // Try to find the element by ID
  const element = document.getElementById(id);
  
  if (element) {
    // If element exists, scroll to it with smooth behavior
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
    
    // Add a temporary highlight effect
    const originalBackground = element.style.backgroundColor;
    element.style.backgroundColor = '#fffad1';
    
    // Remove the highlight after 2 seconds
    setTimeout(() => {
      element.style.backgroundColor = originalBackground;
    }, 2000);
  } else {
    // Fallback to using the stored position
    window.scrollTo({
      top: position,
      behavior: 'smooth'
    });
  }
};

/**
 * Gets the current position of the TOC
 * @returns {string} The current position ('left' or 'right')
 */
function getCurrentPosition() {
  const sidebar = document.getElementById('any-toc-sidebar');
  
  // Check if sidebar exists and is visible
  if (sidebar && getComputedStyle(sidebar).display !== 'none') {
    return sidebar.classList.contains('left') ? 'left' : 'right';
  }
  
  // If sidebar is not visible, check the saved position
  return localStorage.getItem('any-toc-position') || 'right';
} 