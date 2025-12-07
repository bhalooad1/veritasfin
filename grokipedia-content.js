// Grokipedia Content Script
// Injects a chat widget and handles scrolling to relevant sections

console.log('Veritas: Grokipedia integration loaded');

// Global variable to store context
let currentClaimText = '';

// Check for URL fragment to scroll to specific section
// Format: #veritas-claim=[claim_text]
function handleScrollToClaim() {
    const hash = window.location.hash;
    if (hash.startsWith('#veritas-claim=')) {
        currentClaimText = decodeURIComponent(hash.replace('#veritas-claim=', ''));
        console.log('Veritas: Scrolling to claim context:', currentClaimText);

        // Try to find the text in the page
        const elements = document.body.getElementsByTagName('p');
        let found = false;

        for (let i = 0; i < elements.length; i++) {
            const element = elements[i];
            if (element.textContent.toLowerCase().includes(currentClaimText.toLowerCase())) {
                console.log('Veritas: Found element, scrolling...');
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.style.backgroundColor = 'rgba(255, 212, 0, 0.3)';
                element.style.transition = 'background-color 0.5s';
                found = true;
                break;
            }
        }

        if (!found) {
            console.log('Veritas: Exact text not found, showing widget anyway');
        }

        createGrokChatWidget(currentClaimText);
    }
}

function createGrokChatWidget(contextText, anchorElement) {
    if (document.getElementById('veritas-grok-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'veritas-grok-widget';
    widget.innerHTML = `
        <div class="veritas-header">
            <h3>Grok Chat</h3>
            <button class="veritas-close">×</button>
        </div>
        <div class="veritas-chat-body" id="veritas-chat-messages">
            <div class="message system">
                Context: "${contextText ? contextText.substring(0, 100) + '...' : 'General Chat'}"
                <br><br>
                Ask me anything about this claim or this article.
            </div>
        </div>
        <div class="veritas-chat-input">
            <input type="text" id="veritas-chat-input" placeholder="Ask Grok...">
            <button id="veritas-send-btn">Send</button>
        </div>
    `;

    // Styling - Minimal Swiss
    Object.assign(widget.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        width: '350px',
        height: '500px',
        backgroundColor: '#000',
        color: '#fff',
        border: '1px solid #fff',
        zIndex: '10000',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
    });

    // Add styles for inner elements
    const style = document.createElement('style');
    style.textContent = `
        #veritas-grok-widget .veritas-header {
            padding: 15px;
            border-bottom: 1px solid #fff;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #000;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }
        #veritas-grok-widget .veritas-chat-body {
            flex-grow: 1;
            padding: 15px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        #veritas-grok-widget .veritas-chat-input {
            padding: 10px;
            border-top: 1px solid #333;
            display: flex;
            gap: 8px;
            align-items: center;
            background: #000;
        }
        #veritas-grok-widget input {
            flex-grow: 1;
            padding: 6px 10px;
            border: 1px solid #333;
            background: #111;
            color: #fff;
            font-family: inherit;
            font-size: 11px;
            outline: none;
        }
        #veritas-grok-widget input:focus {
            border-color: #666;
        }
        #veritas-grok-widget button {
            background: #fff;
            color: #000;
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            font-family: inherit;
            text-transform: uppercase;
            font-weight: bold;
            font-size: 10px;
            letter-spacing: 0.05em;
        }
        #veritas-grok-widget button:hover {
            background: #ccc;
        }
        .message {
            padding: 8px 12px;
            border: 1px solid #333;
            max-width: 85%;
            font-size: 11px;
            line-height: 1.4;
            margin-bottom: 4px;
        }
        .message.system {
            background: transparent;
            color: #666;
            align-self: center;
            width: 100%;
            text-align: center;
            border: none;
            font-style: italic;
            font-size: 10px;
        }
        .message.user {
            background: #222;
            color: white;
            align-self: flex-end;
            border-color: #444;
        }
        .message.grok {
            background: #000;
            color: #ddd;
            align-self: flex-start;
            border-color: #333;
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(widget);

    // Chat logic
    const input = widget.querySelector('input');
    const sendBtn = widget.querySelector('button');
    const chatBody = widget.querySelector('.veritas-chat-body');

    function addMessage(text, type) {
        const msg = document.createElement('div');
        msg.className = `message ${type}`;
        msg.textContent = text;
        chatBody.appendChild(msg);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    async function handleSend() {
        const text = input.value.trim();
        if (!text) return;

        addMessage(text, 'user');
        input.value = '';

        // Add loading indicator
        const loadingId = 'loading-' + Date.now();
        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'message grok';
        loadingMsg.id = loadingId;
        loadingMsg.textContent = 'Thinking...';
        chatBody.appendChild(loadingMsg);
        chatBody.scrollTop = chatBody.scrollHeight;

        try {
            chrome.runtime.sendMessage({
                type: 'GROK_CHAT_REQUEST',
                payload: {
                    message: text,
                    context: currentClaimText // Use global variable
                }
            }, (response) => {
                const loader = document.getElementById(loadingId);
                if (loader) loader.remove();

                if (chrome.runtime.lastError) {
                    addMessage('Extension Error: ' + chrome.runtime.lastError.message, 'system');
                    return;
                }

                if (response && response.success) {
                    addMessage(response.reply, 'grok');
                } else {
                    addMessage('Error: ' + (response?.error || 'Failed to get response'), 'system');
                }
            });
        } catch (e) {
            const loader = document.getElementById(loadingId);
            if (loader) loader.remove();
            addMessage('Integration error: ' + e.message, 'system');
        }
    }

    // Event Listeners with null checks
    if (sendBtn && input) {
        sendBtn.addEventListener('click', handleSend);
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSend();
        });
    }

    // Close button
    const closeBtn = widget.querySelector('.veritas-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            widget.style.display = 'none';
        });
    }
}

// Run on load with slight delay to ensure DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(handleScrollToClaim, 1000));
} else {
    setTimeout(handleScrollToClaim, 1000);
}
