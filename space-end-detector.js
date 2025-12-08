// Space End Detector
// Monitors X Spaces for "Ended" status and triggers Supabase update

let isMonitoringSpaceEnd = false;
let spaceEndDetected = false;

/**
 * Start monitoring for space end
 */
function startSpaceEndMonitoring() {
    if (isMonitoringSpaceEnd) return;
    isMonitoringSpaceEnd = true;

    console.log('🔍 Started monitoring for Space end...');

    // Check immediately
    checkForSpaceEnd();

    // Then check every 5 seconds
    setInterval(() => {
        checkForSpaceEnd();
    }, 5000);
}

/**
 * Check if space has ended by looking for "Ended" text
 */
function checkForSpaceEnd() {
    if (spaceEndDetected) return;

    const currentUrl = window.location.href;
    const isSpacePage = currentUrl.includes('/spaces/');

    console.log(`🔍 Space End Check | URL: ${isSpacePage ? 'Space page ✓' : 'Not a Space page ✗'}`);
    console.log(`   Current URL: ${currentUrl}`);
    console.log(`   Looking for: "/spaces/" in URL`);

    if (!isSpacePage) return;

    const endedSpans = document.querySelectorAll('span.css-1jxf684');
    console.log(`   Found ${endedSpans.length} potential spans`);

    for (const span of endedSpans) {
        const text = span.textContent.trim();

        if (text === 'Ended') {
            const sheetDialog = span.closest('[data-testid="sheetDialog"]');
            const maskDialog = span.closest('[data-testid="mask"]');
            const parentDiv = span.parentElement;
            const parentStyle = parentDiv ? window.getComputedStyle(parentDiv) : null;
            const isGrayColor = parentStyle && parentStyle.color.includes('113, 118, 123');
            const isValidContext = sheetDialog || (maskDialog && isGrayColor);

            console.log(`   "Ended" found | Sheet: ${!!sheetDialog} | Mask: ${!!maskDialog} | Gray: ${isGrayColor} | Valid: ${isValidContext}`);

            if (isValidContext) {
                console.log(`✅ SPACE ENDED DETECTED`);
                console.log(`   Element:`, span);
                console.log(`   Container:`, sheetDialog || maskDialog);
                spaceEndDetected = true;
                handleSpaceEnd();
                break;
            } else {
                console.log(`   ⚠️  "Ended" ignored (wrong context)`);
            }
        }
    }
}

/**
 * Get the full DOM path of an element for debugging
 */
function getElementPath(element) {
    const path = [];
    let current = element;

    while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
            selector += '#' + current.id;
        }
        if (current.className) {
            selector += '.' + current.className.split(' ').join('.');
        }
        path.unshift(selector);
        current = current.parentElement;
    }

    return path.join(' > ');
}

/**
 * Handle space end - update Supabase
 */
async function handleSpaceEnd() {
    console.log('🎯 Handling space end...');

    // Debug: Check ALL storage contents first
    chrome.storage.local.get(null, (allData) => {
        console.log('📦 DEBUG: All Chrome storage contents:', allData);
        console.log('📦 DEBUG: Storage keys:', Object.keys(allData));
    });

    // Get the current space ID from chrome.storage
    chrome.storage.local.get(['currentSpaceId'], async (result) => {
        console.log('📦 DEBUG: Storage get result:', result);
        console.log('📦 DEBUG: currentSpaceId value:', result.currentSpaceId);

        const spaceId = result.currentSpaceId;

        if (!spaceId) {
            console.error('❌ No space ID found in storage');
            console.error('💡 CAUSE: Space was never created (backend was down or page loaded before space creation)');
            console.error('💡 FIX: Refresh the X Space page to trigger space creation, then try again');
            return;
        }

        console.log(`📝 Space ID: ${spaceId}`);

        try {
            // Call backend to mark space as ended
            const response = await fetch('http://localhost:3000/api/spaces/end', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    space_id: spaceId
                })
            });

            const data = await response.json();

            if (data.success) {
                console.log('✅ Space marked as ended in database');
                console.log('📊 Summary will be generated automatically');

                // Show notification to user
                showEndNotification();
            } else {
                console.error('❌ Failed to mark space as ended:', data.error);
            }
        } catch (error) {
            console.error('❌ Error calling backend:', error);
        }
    });
}

/**
 * Show notification that space ended
 */
function showEndNotification() {
    // Create a subtle notification overlay
    const notification = document.createElement('div');
    notification.id = 'veritas-end-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #000;
        color: #fff;
        border: 1px solid #0f0;
        padding: 15px 20px;
        border-radius: 4px;
        font-family: 'SF Mono', Monaco, monospace;
        font-size: 12px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0, 255, 0, 0.3);
    `;
    notification.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 5px;">✅ Space Ended - Veritas</div>
        <div style="color: #888; font-size: 11px;">Generating summary for X post...</div>
    `;

    document.body.appendChild(notification);

    // Remove notification after 5 seconds
    setTimeout(() => {
        notification.style.transition = 'opacity 0.3s';
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Start monitoring when script loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startSpaceEndMonitoring);
} else {
    startSpaceEndMonitoring();
}

console.log('🚀 Space End Detector loaded');
