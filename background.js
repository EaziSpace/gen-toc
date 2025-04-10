/**
 * Background script to handle communication between popup and content scripts
 */

// Lưu trữ thông tin về các tab đã inject content script
const injectedTabs = {};

// Message action constants
const ACTIONS = {
  PING: 'ping',
  CHECK_STATUS: 'checkContentScriptStatus',
  TOGGLE_TOC: 'toggleTOC',
  REFRESH_TOC: 'refreshTOC',
};

// Đăng ký listener khi extension khởi động
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Lắng nghe khi tab được tạo mới hoặc cập nhật
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log(`Tab ${tabId} loaded completely`);
    
    // Kiểm tra xem tab có phải là một trang web (không phải chrome://, extension://, etc.)
    if (tab.url && tab.url.startsWith('http')) {
      // Đánh dấu tab là cần kiểm tra
      checkContentScriptInjection(tabId);
    }
  }
});

// Lắng nghe khi tab bị đóng để xóa trạng thái
chrome.tabs.onRemoved.addListener((tabId) => {
  if (injectedTabs[tabId]) {
    delete injectedTabs[tabId];
    console.log(`Removed state for tab ${tabId}`);
  }
});

// Lắng nghe thông điệp từ content script để đánh dấu tab đã inject
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Nếu là content script thông báo đã inject thành công
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
  
  // Xử lý các thông điệp khác
  handleMessage(message, sender, sendResponse);
  return true;
});

/**
 * Xử lý các thông điệp gửi đến background script
 * @param {Object} message - Thông điệp nhận được
 * @param {Object} sender - Thông tin người gửi
 * @param {Function} sendResponse - Hàm callback để phản hồi
 */
function handleMessage(message, sender, sendResponse) {
  console.log('Background received message:', message);
  console.log('Message action:', message.action);
  console.log('Is toggle action?', message.action === ACTIONS.TOGGLE_TOC);
  console.log('Is refresh action?', message.action === ACTIONS.REFRESH_TOC);
  
  // Xác định ID của tab
  const tabId = sender.tab ? sender.tab.id : message.tabId;
  
  if (!tabId) {
    console.error('No tab ID found');
    sendResponse({ error: 'No tab ID found' });
    return;
  }

  // Kiểm tra trạng thái tab
  if (message.action === ACTIONS.CHECK_STATUS) {
    checkContentScriptStatus(tabId)
      .then(status => sendResponse(status))
      .catch(error => {
        console.error('Error checking content script status:', error);
        sendResponse({ ready: false, error: error.message });
      });
    return;
  }
  
  // Xử lý các loại thông điệp tương tác với content script
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
 * Kiểm tra xem content script đã được inject vào tab chưa
 * @param {number} tabId - ID của tab cần kiểm tra
 * @returns {Promise<Object>} - Trạng thái của content script
 */
async function checkContentScriptStatus(tabId) {
  return new Promise((resolve, reject) => {
    // Nếu đã biết tab được inject
    if (injectedTabs[tabId] && injectedTabs[tabId].injected) {
      console.log(`Tab ${tabId} already has content script injected`);
      resolve({ ready: true });
      return;
    }

    // Kiểm tra bằng cách gửi ping
    try {
      chrome.tabs.sendMessage(tabId, { action: ACTIONS.PING }, response => {
        if (chrome.runtime.lastError) {
          console.log(`Content script not detected in tab ${tabId}, trying to inject`);
          // Thử inject content script
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
 * Kiểm tra và inject content script nếu cần
 * @param {number} tabId - ID của tab cần kiểm tra
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
 * Xử lý các hành động tương tác với content script
 * @param {number} tabId - ID của tab
 * @param {Object} message - Thông điệp cần gửi
 * @returns {Promise<Object>} - Kết quả của hành động
 */
async function handleContentScriptAction(tabId, message) {
  return new Promise(async (resolve, reject) => {
    try {
      // Kiểm tra xem content script đã được inject chưa
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
      
      // Gửi thông điệp đến content script
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
 * Inject content script vào tab
 * @param {number} tabId - ID của tab cần inject content script
 * @returns {Promise<void>} - Promise giải quyết khi inject thành công
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
        // Cho content script thời gian để khởi chạy
        setTimeout(resolve, 300);
      }
    });
  });
} 