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

// Ensure global namespace availability
window.anyTOC = window.anyTOC || {};

// Define core functions early to ensure they're available
function refreshTOC(force = false) {
  try {
    // Will be replaced by the full implementation later
    if (window.refreshTOC && window.refreshTOC !== refreshTOC) {
      return window.refreshTOC(force);
    }
    console.log('refreshTOC stub called - will be replaced by full implementation');
    return false;
  } catch (e) {
    console.error('Error in refreshTOC stub:', e);
    return false;
  }
}

// Ensure global functions are available
window.refreshTOC = window.refreshTOC || refreshTOC;
window.anyTOC.refreshTOC = window.refreshTOC;

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
    // Check if chrome and chrome.runtime are available
    if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) {
      console.log('Chrome runtime unavailable, extension context may be invalid');
      return;
    }
    
    chrome.runtime.sendMessage({ action: ACTIONS.PING }, (response) => {
      // Check again here in case context was invalidated during the async call
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
    // Check if extension context is valid - more comprehensive check
    if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) {
      console.error('Chrome runtime not available, extension context may be invalid');
      return;
    }
    
    initTOC();
    
    // Ensure periodic refresh is set up
    try {
      if (typeof setupPeriodicRefresh === 'function') {
        setupPeriodicRefresh();
      }
    } catch (e) {
      console.error('Error setting up periodic refresh:', e);
    }
    
    // Try again after a delay if not successful
    initTocTimeout = setTimeout(() => {
      console.log('Timeout fired, initializing TOC again');
      try {
        // Check extension context again before retry
        if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) {
          console.error('Chrome runtime not available on retry, extension context may be invalid');
          return;
        }
        initTOC();
        
        // Second attempt to set up periodic refresh
        if (typeof setupPeriodicRefresh === 'function' && !window.tocRefreshInterval) {
          setupPeriodicRefresh();
        }
      } catch (e) {
        console.error('Error initializing TOC on timeout:', e);
      }
    }, 1000);
  } catch (e) {
    console.error('Error initializing TOC on DOMContentLoaded:', e);
  }
}

// Listen for messages from popup or background script - more comprehensive check
if (typeof chrome !== 'undefined' && chrome && chrome.runtime && chrome.runtime.onMessage) {
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
}

/**
 * Refreshes the TOC content
 */
window.refreshTOC = function(force = false) {
  try {
    const tocList = document.getElementById('any-toc-list');
    const loadingElement = document.getElementById('any-toc-loading');
    const noHeadingsElement = document.getElementById('any-toc-no-headings');
    
    // Ensure the function is defined and available as a window property
    window.refreshTOC = window.refreshTOC || this;
    
    if (!tocList || !loadingElement || !noHeadingsElement) {
      console.error('TOC elements not found, cannot refresh');
      return;
    }
    
    // Use throttling to prevent too many refreshes
    if (!force && window.lastRefreshTime) {
      const now = Date.now();
      const elapsed = now - window.lastRefreshTime;
      if (elapsed < 500) { // Minimum 500ms between refreshes unless forced
        console.log('Refresh throttled, skipping (last refresh was ' + elapsed + 'ms ago)');
        return;
      }
    }
    
    window.lastRefreshTime = Date.now();
    
    // Clear existing content
    tocList.innerHTML = '';
    loadingElement.style.display = 'block';
    noHeadingsElement.style.display = 'none';
    
    console.log('Refreshing TOC - scanning for headings');
    // Get headings and build TOC
    const headings = extractHeadings();
    
    if (headings && headings.length > 0) {
      console.log(`Found ${headings.length} headings, building TOC`);
      buildTOC(headings);
      return true;
    } else {
      console.log('No headings found on initial scan, will retry after delay');
      // Try again after a delay if no headings found initially
      setTimeout(() => {
        try {
          console.log('Retrying heading extraction');
          const retryHeadings = extractHeadings();
          if (retryHeadings && retryHeadings.length > 0) {
            console.log(`Found ${retryHeadings.length} headings on retry, building TOC`);
            buildTOC(retryHeadings);
          } else {
            console.log('No headings found after retry');
            if (loadingElement && noHeadingsElement) {
              loadingElement.style.display = 'none';
              noHeadingsElement.style.display = 'block';
            }
          }
        } catch (e) {
          console.error('Error during delayed heading extraction:', e);
        }
      }, 1500); // 1.5 second delay for retry
      return false;
    }
  } catch (e) {
    console.error('Error in refreshTOC:', e);
    return false;
  }
};

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
    
    // Setup mutation observer to detect content changes
    setupContentChangeDetection();
    
    // Setup automatic periodic refresh every 2 seconds
    setupPeriodicRefresh();
    
    console.log('TOC initialization completed successfully');
    window.isInitialized = true;
    
    // Add an additional delayed refresh to handle dynamic content
    setTimeout(() => {
      console.log('Executing final delayed refresh to catch late-loaded content');
      refreshTOC();
    }, 3000);
    
  } catch (error) {
    console.error('Error initializing TOC:', error);
  }
}

/**
 * Sets up automatic periodic refresh for the TOC
 */
function setupPeriodicRefresh() {
  console.log('Setting up periodic TOC refresh every 2 seconds');
  
  // Clear any existing interval to avoid duplicates
  if (window.tocRefreshInterval) {
    clearInterval(window.tocRefreshInterval);
  }
  
  // Store the interval ID so we can clear it if needed
  window.tocRefreshInterval = setInterval(() => {
    try {
      const tocSidebar = document.getElementById('any-toc-sidebar');
      
      // Check if user is currently interacting with the TOC
      if (window.isUserInteractingWithTOC) {
        console.log('User is interacting with TOC, skipping auto-refresh');
        return;
      }
      
      // Only refresh if the sidebar exists and is visible
      if (tocSidebar && !tocSidebar.classList.contains('hidden')) {
        // Check if page content has actually changed since last refresh
        const currentBodyHTML = document.body.innerHTML.length;
        
        if (!window.lastBodyLength || Math.abs(currentBodyHTML - window.lastBodyLength) > 50) {
          console.log('Page content changed, auto-refresh triggered');
          window.lastBodyLength = currentBodyHTML;
          if (typeof refreshTOC === 'function') {
            refreshTOC();
          } else if (window.refreshTOC && typeof window.refreshTOC === 'function') {
            window.refreshTOC();
          }
        } else {
          console.log('Page content unchanged, skipping auto-refresh');
        }
      } else {
        console.log('Auto-refresh skipped, TOC is hidden or not initialized');
      }
    } catch (e) {
      console.error('Error during periodic refresh:', e);
    }
  }, 2000); // Refresh every 2 seconds
  
  // Add event listener to pause refresh interval when tab becomes inactive
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Tab is inactive, clear the interval to save resources
      if (window.tocRefreshInterval) {
        console.log('Tab inactive, pausing TOC refresh interval');
        clearInterval(window.tocRefreshInterval);
        window.tocRefreshInterval = null;
      }
    } else {
      // Tab is active again, restart the interval if it was cleared
      if (!window.tocRefreshInterval) {
        console.log('Tab active again, resuming TOC refresh interval');
        setupPeriodicRefresh();
      }
    }
  });
  
  // Set up event listeners to detect user interaction with TOC
  const tocSidebar = document.getElementById('any-toc-sidebar');
  if (tocSidebar) {
    tocSidebar.addEventListener('mouseenter', () => {
      window.isUserInteractingWithTOC = true;
    });
    
    tocSidebar.addEventListener('mouseleave', () => {
      window.isUserInteractingWithTOC = false;
    });
    
    // Also track clicks to prevent refresh while user is clicking
    tocSidebar.addEventListener('mousedown', () => {
      window.isUserInteractingWithTOC = true;
      // Set a timeout to reset after a while in case mouseup isn't caught
      setTimeout(() => {
        window.isUserInteractingWithTOC = false;
      }, 5000);
    });
    
    tocSidebar.addEventListener('mouseup', () => {
      // Small delay to complete the click action
      setTimeout(() => {
        window.isUserInteractingWithTOC = false;
      }, 500);
    });
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
    
    // Immediately refresh the TOC when showing it
    if (typeof refreshTOC === 'function') {
      refreshTOC(true); // Force refresh
    } else if (window.refreshTOC && typeof window.refreshTOC === 'function') {
      window.refreshTOC(true); // Force refresh
    }
    
    // Make sure periodic refresh is running
    if (!window.tocRefreshInterval && typeof setupPeriodicRefresh === 'function') {
      setupPeriodicRefresh();
    }
  } else {
    console.log('Hiding sidebar');
    tocSidebar.classList.add('hidden');
    collapsedButton.classList.add('visible');
    localStorage.setItem('any-toc-visibility', 'hidden');
    
    // No need to constantly refresh when hidden, can optionally clear interval here
    // if (window.tocRefreshInterval) {
    //   clearInterval(window.tocRefreshInterval);
    //   window.tocRefreshInterval = null;
    // }
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
 * Extracts all h1, h2, h3 headings from the page
 * @returns {Array} An array of heading objects containing text, level, and position
 */
window.extractHeadings = function() {
  const headings = [];
  
  // Look in multiple possible content containers
  const containers = [
    document.getElementById('main'),
    document.getElementById('content'),
    document.getElementById('article'),
    document.querySelector('article'),
    document.querySelector('main'),
    document.querySelector('.content'),
    document.querySelector('.article'),
    document.body // Fallback to body if none of the above are found
  ];
  
  // Find the first non-null container
  let mainContainer = null;
  for (const container of containers) {
    if (container) {
      mainContainer = container;
      console.log('Found content container:', container.tagName, container.id || container.className);
      break;
    }
  }
  
  if (!mainContainer) {
    console.error('Could not find any valid content container');
    mainContainer = document.body;
  }
  
  // Find all h1, h2, h3, h4 elements inside the main container
  console.log('Searching for headings in container');
  let headingElements = mainContainer.querySelectorAll('h1, h2, h3, h4');
  
  // If no headings are found in the main container, try the entire document
  if (headingElements.length === 0) {
    console.log('No headings found in main container, searching entire document');
    const allHeadings = document.querySelectorAll('h1, h2, h3, h4');
    
    if (allHeadings.length === 0) {
      console.log('No headings found in entire document');
      return headings;
    }
    
    // Use all headings from the document
    console.log(`Found ${allHeadings.length} headings in document`);
    headingElements = allHeadings;
  } else {
    console.log(`Found ${headingElements.length} headings in main container`);
  }
  
  // Extract information from each heading
  headingElements.forEach((heading, index) => {
    // Get the heading text and trim whitespace
    const text = heading.textContent.trim();
    
    // Skip empty headings
    if (!text) {
      console.log('Skipping empty heading');
      return;
    }
    
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
    
    console.log(`Added heading: ${text.substring(0, 30)}${text.length > 30 ? '...' : ''} (h${level})`);
  });
  
  console.log(`Total headings extracted: ${headings.length}`);
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

/**
 * Sets up a mutation observer to detect content changes and refresh TOC
 */
function setupContentChangeDetection() {
  console.log('Setting up mutation observer for content changes');
  
  // Create a throttled refresh function to avoid excessive updates
  let refreshTimeout = null;
  const throttledRefresh = () => {
    if (refreshTimeout) {
      clearTimeout(refreshTimeout);
    }
    refreshTimeout = setTimeout(() => {
      console.log('Content changed, refreshing TOC');
      refreshTOC();
    }, 2000); // Wait 2 seconds after changes before refreshing
  };
  
  // Create mutation observer
  const observer = new MutationObserver((mutations) => {
    // Check if any of the mutations might affect headings
    const hasRelevantChanges = mutations.some(mutation => {
      // Check for added/removed nodes that might be or contain headings
      if (mutation.type === 'childList') {
        // Check added nodes
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // If the node is a heading or contains headings
            if (/^H[1-4]$/i.test(node.tagName) || node.querySelector('h1, h2, h3, h4')) {
              console.log('Detected new heading content');
              return true;
            }
          }
        }
        
        // Check if removed nodes contained headings
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (/^H[1-4]$/i.test(node.tagName) || 
                (node.querySelector && node.querySelector('h1, h2, h3, h4'))) {
              console.log('Detected removed heading content');
              return true;
            }
          }
        }
      }
      
      return false;
    });
    
    if (hasRelevantChanges) {
      throttledRefresh();
    }
  });
  
  // Start observing the document body
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  console.log('Mutation observer setup complete');
} 