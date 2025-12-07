// Background service worker
chrome.runtime.onInstalled.addListener(() => {
    console.log('Veritas extension installed');
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'factCheck') {
        // Handle fact-checking requests
        console.log('Fact check request:', request.data);
        sendResponse({ status: 'processing' });
    }
    return true;
});
