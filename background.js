/**
 * Background script to handle communication between popup and content scripts
 */

// Store information about tabs with injected content script
const injectedTabs = {};

// Message action constants
const ACTIONS = {
  PING: 'ping',
  CHECK_STATUS: 'checkContentScriptStatus',
  TOGGLE_TOC: 'toggleTOC',
  REFRESH_TOC: 'refreshTOC',
};

// Register listener when extension starts
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Listen for tab updates or creation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log(`Tab ${tabId} loaded completely`);
    
    // Check if the tab is a web page (not chrome://, extension://, etc.)
    if (tab.url && tab.url.startsWith('http')) {
      // Mark tab for checking
      checkContentScriptInjection(tabId);
    }
  }
});

// Listen for tab closure to clean up state
chrome.tabs.onRemoved.addListener((tabId) => {
  if (injectedTabs[tabId]) {
    delete injectedTabs[tabId];
    console.log(`Removed state for tab ${tabId}`);
  }
});

// Listen for messages from content script to mark tab as injected
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // If this is content script notifying successful injection
  if (message.action === ACTIONS.PING && sender.tab) {
    const tabId = sender.tab.id;
    console.log(`Received ping from content script in tab ${tabId}`);
    injectedTabs[tabId] = {
      injected: true,
      timestamp: Date.now()
    };
    sendResponse({ pong: true });
    return true;
  }
  
  // Handle other messages
  handleMessage(message, sender, sendResponse);
  return true;
});

/**
 * Handle messages sent to background script
 * @param {Object} message - The received message
 * @param {Object} sender - Sender information
 * @param {Function} sendResponse - Callback function to respond
 */
function handleMessage(message, sender, sendResponse) {
  console.log('Background received message:', message);
  console.log('Message action:', message.action);
  console.log('Is toggle action?', message.action === ACTIONS.TOGGLE_TOC);
  console.log('Is refresh action?', message.action === ACTIONS.REFRESH_TOC);
  
  // Determine tab ID
  const tabId = sender.tab ? sender.tab.id : message.tabId;
  
  if (!tabId) {
    console.error('No tab ID found');
    sendResponse({ error: 'No tab ID found' });
    return;
  }

  // Check tab status
  if (message.action === ACTIONS.CHECK_STATUS) {
    checkContentScriptStatus(tabId)
      .then(status => sendResponse(status))
      .catch(error => {
        console.error('Error checking content script status:', error);
        sendResponse({ ready: false, error: error.message });
      });
    return;
  }
  
  // Handle interaction messages with content script
  if (message.action === ACTIONS.TOGGLE_TOC || message.action === ACTIONS.REFRESH_TOC) {
    console.log('Handling action:', message.action, 'for tab:', tabId);
    handleContentScriptAction(tabId, message)
      .then(response => {
        console.log('Content script action response:', response);
        sendResponse(response);
      })
      .catch(error => {
        console.error(`Error handling ${message.action}:`, error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate we want to use sendResponse asynchronously
    return true;
  }
}

/**
 * Check if content script has been injected into the tab
 * @param {number} tabId - ID of the tab to check
 * @returns {Promise<Object>} - Content script status
 */
async function checkContentScriptStatus(tabId) {
  return new Promise((resolve, reject) => {
    // If we already know the tab is injected
    if (injectedTabs[tabId] && injectedTabs[tabId].injected) {
      console.log(`Tab ${tabId} already has content script injected`);
      resolve({ ready: true });
      return;
    }

    // Check by sending a ping
    try {
      chrome.tabs.sendMessage(tabId, { action: ACTIONS.PING }, response => {
        if (chrome.runtime.lastError) {
          console.log(`Content script not detected in tab ${tabId}, trying to inject`);
          // Try to inject content script
          injectContentScript(tabId)
            .then(() => {
              injectedTabs[tabId] = { injected: true, timestamp: Date.now() };
              resolve({ ready: true, injected: true });
            })
            .catch(err => {
              reject(new Error(`Failed to inject content script: ${err.message}`));
            });
        } else if (response && response.pong) {
          console.log(`Content script confirmed in tab ${tabId}`);
          injectedTabs[tabId] = { injected: true, timestamp: Date.now() };
          resolve({ ready: true });
        } else {
          reject(new Error('Content script responded but with unexpected format'));
        }
      });
    } catch (err) {
      reject(new Error(`Error checking content script: ${err.message}`));
    }
  });
}

/**
 * Check and inject content script if needed
 * @param {number} tabId - ID of the tab to check
 */
function checkContentScriptInjection(tabId) {
  chrome.tabs.sendMessage(tabId, { action: ACTIONS.PING }, response => {
    if (chrome.runtime.lastError) {
      console.log(`Content script not detected in tab ${tabId}, injecting it`);
      injectContentScript(tabId)
        .then(() => {
          console.log(`Successfully injected content script into tab ${tabId}`);
          injectedTabs[tabId] = { injected: true, timestamp: Date.now() };
        })
        .catch(err => {
          console.error(`Failed to inject content script into tab ${tabId}:`, err);
        });
    } else if (response && response.pong) {
      console.log(`Content script already exists in tab ${tabId}`);
      injectedTabs[tabId] = { injected: true, timestamp: Date.now() };
    }
  });
}

/**
 * Handle actions that interact with the content script
 * @param {number} tabId - Tab ID
 * @param {Object} message - Message to send
 * @returns {Promise<Object>} - Result of the action
 */
async function handleContentScriptAction(tabId, message) {
  return new Promise(async (resolve, reject) => {
    try {
      // Check if content script has been injected
      const status = await checkContentScriptStatus(tabId).catch(err => ({ ready: false, error: err.message }));
      
      if (!status.ready) {
        console.log(`Content script not ready in tab ${tabId}, cannot ${message.action}`);
        resolve({ success: false, error: 'Content script not ready', injected: status.injected });
        return;
      }
      
      // Map the action names from background script to content script
      let contentAction = message.action;
      if (message.action === ACTIONS.TOGGLE_TOC) {
        contentAction = 'toggle';
        console.log('Mapping TOGGLE_TOC to toggle for content script');
      } else if (message.action === ACTIONS.REFRESH_TOC) {
        contentAction = 'refresh';
        console.log('Mapping REFRESH_TOC to refresh for content script');
      }
      
      // Send message to content script
      chrome.tabs.sendMessage(tabId, { action: contentAction }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response || { success: true });
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Inject content script into tab
 * @param {number} tabId - ID of the tab to inject content script
 * @returns {Promise<void>} - Promise resolved when injection is successful
 */
async function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        // Give content script time to initialize
        setTimeout(resolve, 300);
      }
    });
  });
} 