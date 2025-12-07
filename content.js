// Content script - runs on web pages
console.log('Veritas content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyze') {
        console.log('Starting debate analysis...');
        analyzeDebate();
        sendResponse({ status: 'started' });
    }
    return true;
});

function analyzeDebate() {
    // Extract text from page
    const pageText = document.body.innerText;
    console.log('Extracted text:', pageText.substring(0, 200) + '...');

    // Send to background for processing
    chrome.runtime.sendMessage({
        action: 'factCheck',
        data: { text: pageText }
    });
}
