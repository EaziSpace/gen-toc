/**
 * Popup script that handles user interactions with the extension popup UI
 * and communicates with the content script to control the TOC sidebar.
 */

document.addEventListener('DOMContentLoaded', function() {
  // Get references to UI elements
  const statusText = document.getElementById('status');
  const refreshButton = document.getElementById('refresh-toc');
  const toggleButton = document.getElementById('toggle-toc');
  const leftPositionButton = document.getElementById('position-left');
  const rightPositionButton = document.getElementById('position-right');
  const pageStatusText = document.getElementById('page-status');
  const allowPageButton = document.getElementById('allow-page');
  const disallowPageButton = document.getElementById('disallow-page');
  const thankYouMessage = document.querySelector('.thank-you-message');
  
  // Add a simple fade-in effect for the thank you message
  if (thankYouMessage) {
    thankYouMessage.style.opacity = '0';
    setTimeout(() => {
      thankYouMessage.style.transition = 'opacity 0.8s ease-in-out';
      thankYouMessage.style.opacity = '1';
    }, 500);
  }
  
  // Set initial status
  updateStatus('Checking content script status...');
  
  // Check if the content script is active on the current tab
  getCurrentTab().then(tab => {
    checkContentScriptAndExecuteAction(tab.id, 'ping')
      .then(result => {
        if (result && result.success) {
          updateStatus('Content script is active');
          
          // Check if page is allowed to use TOC
          if (result.allowed) {
            enableControls();
            updatePageStatus(true);
            
            // Check current position and update UI
            checkTOCPosition(tab.id);
          } else {
            disableControls();
            updatePageStatus(false);
          }
        } else {
          throw new Error('Content script not detected');
        }
      })
      .catch(error => {
        console.error('Error checking content script status:', error);
        updateStatus('Content script not active', true);
        disableControls();
        updatePageStatus(false, false);
      });
  });
  
  // Handle refresh button click
  refreshButton.addEventListener('click', function() {
    updateStatus('Refreshing TOC...');
    console.log('Refresh button clicked, sending refresh action');
    
    getCurrentTab().then(tab => {
      console.log('Sending refresh message to tab:', tab.id);
      // Route through the background script for proper action mapping
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({
          action: 'refreshTOC',
          tabId: tab.id
        }).then((response) => {
          console.log('Refresh response:', response);
          updateStatus('TOC refreshed successfully');
        }).catch(error => {
          console.error('Error refreshing TOC:', error);
          updateStatus('Failed to refresh TOC', true);
        });
      }
    });
  });
  
  // Handle toggle button click
  toggleButton.addEventListener('click', function() {
    updateStatus('Toggling TOC visibility...');
    console.log('Toggle button clicked, sending toggle action');
    
    getCurrentTab().then(tab => {
      console.log('Sending toggle message to tab:', tab.id);
      // Route through the background script for proper action mapping
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({
          action: 'toggleTOC',
          tabId: tab.id
        }).then((response) => {
          console.log('Toggle response:', response);
          updateStatus('TOC toggled successfully');
        }).catch(error => {
          console.error('Error toggling TOC:', error);
          updateStatus('Failed to toggle TOC', true);
        });
      }
    });
  });
  
  // Handle left position button click
  leftPositionButton.addEventListener('click', function() {
    leftPositionButton.classList.add('active');
    rightPositionButton.classList.remove('active');
    
    getCurrentTab().then(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'setPosition',
        position: 'left'
      }).then(() => {
        console.log('TOC position set to left');
      }).catch(error => {
        console.error('Error setting TOC position:', error);
      });
    });
  });
  
  // Handle right position button click
  rightPositionButton.addEventListener('click', function() {
    rightPositionButton.classList.add('active');
    leftPositionButton.classList.remove('active');
    
    getCurrentTab().then(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'setPosition',
        position: 'right'
      }).then(() => {
        console.log('TOC position set to right');
      }).catch(error => {
        console.error('Error setting TOC position:', error);
      });
    });
  });
  
  // Handle allow page button click
  allowPageButton.addEventListener('click', function() {
    getCurrentTab().then(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'callFunction',
        functionName: 'addCurrentDomainToAllowList'
      }).then(response => {
        if (response && response.success) {
          pageStatusText.textContent = 'Page will be allowed after reload';
          pageStatusText.className = 'success';
          setTimeout(() => {
            chrome.tabs.reload(tab.id);
          }, 1000);
        } else {
          pageStatusText.textContent = 'Failed to add page to allowed list';
          pageStatusText.className = 'error';
        }
      }).catch(error => {
        console.error('Error allowing page:', error);
        pageStatusText.textContent = 'Error updating page permissions';
        pageStatusText.className = 'error';
      });
    });
  });
  
  // Handle disallow page button click
  disallowPageButton.addEventListener('click', function() {
    getCurrentTab().then(tab => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'callFunction',
        functionName: 'removeCurrentDomainFromAllowList'
      }).then(response => {
        if (response && response.success) {
          pageStatusText.textContent = 'Page will be disallowed after reload';
          pageStatusText.className = 'success';
          setTimeout(() => {
            chrome.tabs.reload(tab.id);
          }, 1000);
        } else {
          pageStatusText.textContent = 'Failed to remove page from allowed list';
          pageStatusText.className = 'error';
        }
      }).catch(error => {
        console.error('Error disallowing page:', error);
        pageStatusText.textContent = 'Error updating page permissions';
        pageStatusText.className = 'error';
      });
    });
  });
  
  /**
   * Enables all control buttons
   */
  function enableControls() {
    toggleButton.disabled = false;
    refreshButton.disabled = false;
    leftPositionButton.disabled = false;
    rightPositionButton.disabled = false;
  }
  
  /**
   * Disables all control buttons
   */
  function disableControls() {
    toggleButton.disabled = true;
    refreshButton.disabled = true;
    leftPositionButton.disabled = true;
    rightPositionButton.disabled = true;
  }
  
  /**
   * Checks the current TOC position and updates UI accordingly
   */
  function checkTOCPosition(tabId) {
    chrome.tabs.sendMessage(tabId, {
      action: 'getPosition'
    }).then(response => {
      if (response && response.position) {
        const position = response.position;
        if (position === 'left') {
          leftPositionButton.classList.add('active');
          rightPositionButton.classList.remove('active');
        } else {
          rightPositionButton.classList.add('active');
          leftPositionButton.classList.remove('active');
        }
      }
    }).catch(error => {
      console.error('Error checking TOC position:', error);
      // Fallback to right if we can't determine the position
      rightPositionButton.classList.add('active');
      leftPositionButton.classList.remove('active');
    });
  }
  
  /**
   * Updates the page status text and buttons based on whether the page is allowed
   * @param {boolean} isAllowed - Whether the page is allowed to use TOC
   * @param {boolean} scriptActive - Whether the content script is active
   */
  function updatePageStatus(isAllowed, scriptActive = true) {
    if (!scriptActive) {
      pageStatusText.textContent = 'Content script not active on this page';
      pageStatusText.className = 'error';
      allowPageButton.classList.add('hidden');
      disallowPageButton.classList.add('hidden');
      return;
    }
    
    if (isAllowed) {
      pageStatusText.textContent = 'TOC is enabled on this page';
      pageStatusText.className = 'success';
      allowPageButton.classList.add('hidden');
      disallowPageButton.classList.remove('hidden');
    } else {
      pageStatusText.textContent = 'TOC is disabled on this page';
      pageStatusText.className = '';
      allowPageButton.classList.remove('hidden');
      disallowPageButton.classList.add('hidden');
    }
  }
});

/**
 * Gets the current active tab
 * @returns {Promise<object>} Promise that resolves with the current tab
 */
function getCurrentTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      if (tabs && tabs.length > 0) {
        resolve(tabs[0]);
      } else {
        reject(new Error('No active tab found'));
      }
    });
  });
}

/**
 * Checks if the content script is loaded and executes the specified action
 * @param {number} tabId - The ID of the tab to check
 * @param {string} action - The action to execute on the content script
 * @returns {Promise<object>} Promise that resolves with the action result
 */
function checkContentScriptAndExecuteAction(tabId, action) {
  return new Promise((resolve, reject) => {
    // For ping action, use message passing
    if (action === 'ping') {
      chrome.tabs.sendMessage(tabId, { action: 'ping' })
        .then(response => {
          if (response && response.pong) {
            // Include information about whether the page is allowed
            resolve({ 
              success: true, 
              allowed: response.allowed || false 
            });
          } else {
            throw new Error('No valid response from content script');
          }
        })
        .catch(error => {
          console.log('Ping failed, content script might not be injected:', error);
          
          // If ping failed, inject the content script and try again
          injectContentScript(tabId)
            .then(() => {
              // Wait a moment for the script to initialize
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action: 'ping' })
                  .then(response => {
                    if (response && response.pong) {
                      // Include information about whether the page is allowed
                      resolve({ 
                        success: true, 
                        allowed: response.allowed || false
                      });
                    } else {
                      throw new Error('No valid response after injection');
                    }
                  })
                  .catch(secondError => {
                    console.error('Ping failed after injection:', secondError);
                    reject(new Error('Failed to ping after injecting content script'));
                  });
              }, 500);
            })
            .catch(injectionError => {
              console.error('Content script injection failed:', injectionError);
              reject(new Error('Failed to inject content script'));
            });
        });
    } else if (action === 'callFunction') {
      // Special case to call functions on the window object
      executeContentScriptFunction(tabId, arguments[2])
        .then(result => {
          resolve({ success: true, result });
        })
        .catch(error => {
          reject(error);
        });
    } else {
      // For other actions, use the legacy approach until fully migrated
      executeContentScriptAction(tabId, action)
        .then(result => {
          resolve({ success: true, result });
        })
        .catch(error => {
          reject(error);
        });
    }
  });
}

/**
 * Injects the content script into the tab
 * @param {number} tabId - The ID of the tab to inject into
 * @returns {Promise<void>} Promise that resolves when injection is complete
 */
function injectContentScript(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
}

/**
 * Executes an action in the content script
 * @param {number} tabId - The ID of the tab to execute in
 * @param {string} action - The name of the action function to execute
 * @param {Array} args - Arguments for the action function
 * @returns {Promise<any>} Promise that resolves with the action result
 */
function executeContentScriptAction(tabId, action, args = []) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func: (actionName, actionArgs) => {
      // Check if function exists in window scope
      if (typeof window[actionName] === 'function') {
        return window[actionName](...actionArgs);
      } else {
        throw new Error(`Function ${actionName} not found in content script`);
      }
    },
    args: [action, args]
  }).then(results => results[0].result);
}

/**
 * Executes a function on the window object in the content script
 * @param {number} tabId - The ID of the tab to execute in
 * @param {string} functionName - The name of the function to call on window object
 * @param {Array} args - Arguments for the function
 * @returns {Promise<any>} Promise that resolves with the function result
 */
function executeContentScriptFunction(tabId, functionName, args = []) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, {
        action: 'callFunction',
        functionName: functionName,
        args: args
      }).then(response => {
        resolve(response);
      }).catch(error => {
        reject(error);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Updates the status message in the popup
 * @param {string} message - The message to display
 * @param {boolean} isError - Whether this is an error message
 */
function updateStatus(message, isError = false) {
  const statusText = document.getElementById('status');
  statusText.textContent = message;
  
  if (isError) {
    statusText.classList.add('error');
  } else {
    statusText.classList.remove('error');
  }
} 