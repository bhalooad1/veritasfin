// Process Debate Script - External file for CSP compliance
let processing = false;

// Event listener instead of inline onclick (CSP compliant)
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('processBtn').addEventListener('click', processDebate);

    // Allow Ctrl+Enter to submit
    document.getElementById('transcript').addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.key === 'Enter') {
            processDebate();
        }
    });
});

async function processDebate() {
    if (processing) return;

    const transcript = document.getElementById('transcript').value.trim();
    if (!transcript) {
        alert('Please paste the debate transcript');
        return;
    }

    console.log('Starting debate processing...');
    console.log('Transcript length:', transcript.length, 'characters');

    processing = true;
    const btn = document.getElementById('processBtn');
    const status = document.getElementById('status');

    btn.disabled = true;
    btn.textContent = 'PROCESSING...';

    // Show processing indicator with steps
    status.className = 'active processing';
    status.innerHTML = `
        <div class="processing-indicator">
            <div class="spinner"></div>
            <span class="pulse">PROCESSING DEBATE...</span>
        </div>
        <div class="processing-steps">
            <div class="step active" id="step-1">
                <span class="step-icon"></span>
                <span>CREATING DEBATE SPACE</span>
            </div>
            <div class="step pending" id="step-2">
                <span class="step-icon"></span>
                <span>PARSING TRANSCRIPT</span>
            </div>
            <div class="step pending" id="step-3">
                <span class="step-icon"></span>
                <span>ANALYZING WITH GROK</span>
            </div>
            <div class="step pending" id="step-4">
                <span class="step-icon"></span>
                <span>GENERATING RESULTS</span>
            </div>
        </div>
    `;

    try {
        // Step 1: Create the debate space
        console.log('Step 1: Creating debate space...');
        const createStartTime = Date.now();

        // Extract participants dynamically from transcript
        // Look for patterns like "SPEAKER NAME:" or "Name:" at start of lines
        // Allow optional leading whitespace and Mixed Case (e.g. "Speaker A:")
        const speakerRegex = /^\s*([A-Z][a-zA-Z0-9\s\.]+):/gm;
        // Helper to Title Case names
        const toTitleCase = (str) => {
            return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        };

        const foundSpeakers = new Set();
        let match;
        while ((match = speakerRegex.exec(transcript)) !== null) {
            const name = match[1].trim();
            if (name.length > 2 && name !== 'SPEAKER' && name !== 'MODERATOR') {
                foundSpeakers.add(toTitleCase(name));
            }
        }

        // Default if none found (fallback)
        let participants = Array.from(foundSpeakers).map(name => ({ name }));
        if (participants.length === 0) {
            participants = [{ name: 'Speaker 1' }, { name: 'Speaker 2' }];
        }

        console.log('Identified participants:', participants);

        const createResponse = await fetch('http://localhost:3000/api/debate/create-debate-space', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Debate Analysis ' + new Date().toISOString().split('T')[0],
                description: 'Auto-processed debate transcript',
                participants: participants
            })
        });

        const createData = await createResponse.json();
        console.log('Create space response time:', Date.now() - createStartTime, 'ms');
        console.log('Create space response:', createData);

        if (!createData.success) {
            throw new Error('Failed to create debate space');
        }

        const spaceId = createData.space_id;
        console.log('Space created with ID:', spaceId);

        // Update step indicators
        updateStep(1, 'completed');
        updateStep(2, 'active');

        // Step 2: Parse transcript
        updateStep(2, 'completed');
        updateStep(3, 'active');

        // Step 3: Process the transcript with Grok
        console.log('Step 2: Analyzing transcript...');
        console.log('Sending transcript to Grok for analysis...');
        const analyzeStartTime = Date.now();

        const analyzeResponse = await fetch('http://localhost:3000/api/debate/analyze-transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: transcript,
                space_id: spaceId,
                auto_fact_check: true
            })
        });

        const analyzeData = await analyzeResponse.json();
        console.log('Analyze response time:', Date.now() - analyzeStartTime, 'ms');
        console.log('Analyze response:', analyzeData);
        console.log('Messages created:', analyzeData.messages_inserted);
        console.log('Messages processed with Grok:', analyzeData.messages_processed);
        console.log('Grok analysis completed:', analyzeData.grok_analysis_completed);

        // DETAILED DEBUG INFO
        console.group('🔍 DETAILED DEBUG INFO');
        console.log('Response status:', analyzeResponse.status);
        console.log('Response headers:', analyzeResponse.headers);
        console.log('Full response data:', JSON.stringify(analyzeData, null, 2));

        if (analyzeData.debug_info) {
            console.log('Backend debug info:', analyzeData.debug_info);
        }

        if (analyzeData.grok_error) {
            console.error('❌ Grok error:', analyzeData.grok_error);
        }

        console.log('Expected messages:', analyzeData.expected_messages || 'unknown');
        console.log('Actually processed:', analyzeData.messages_processed || 0);

        // Display full Grok response for debugging
        if (analyzeData.grok_full_response) {
            console.group('🤖 FULL GROK RESPONSE');
            console.log(JSON.stringify(analyzeData.grok_full_response, null, 2));
            console.groupEnd();
        }

        console.groupEnd();

        if (!analyzeData.success) {
            throw new Error('Failed to analyze transcript');
        }

        // Update step indicators
        updateStep(3, 'completed');
        updateStep(4, 'completed');

        // Success!
        console.log('Processing complete! Displaying results...');
        status.className = 'active success';

        const analyticsUrl = chrome.runtime.getURL(`analytics.html?spaceId=${spaceId}`);

        const grokStatus = analyzeData.grok_analysis_completed ?
            `<span style="color: #00ba7c;">✓ GROK ANALYSIS COMPLETE - ${analyzeData.messages_processed} MESSAGES FACT-CHECKED</span>` :
            `<span style="color: #ffd700;">⚠ GROK ANALYSIS NOT COMPLETED</span>`;

        status.innerHTML = `
            <strong>SUCCESS!</strong><br><br>
            SPACE ID: ${spaceId}<br>
            MESSAGES CREATED: ${analyzeData.messages_inserted}<br>
            ${grokStatus}<br><br>
            <strong>STATISTICS:</strong><br>
            ${analyzeData.statistics.messages_per_speaker.map(s =>
            `${s.speaker}: ${s.count} messages (${s.words} words)`
        ).join('<br>')}<br><br>
            <a href="${analyticsUrl}" class="view-button" target="_blank">
                VIEW IN ANALYTICS →
            </a><br><br>
            <small>URL: ${analyticsUrl}</small>
        `;

        // Reset button
        btn.textContent = 'PROCESS ANOTHER DEBATE';
        btn.disabled = false;

    } catch (error) {
        console.error('Error:', error);

        status.className = 'active error';
        status.innerHTML = `ERROR: ${error.message}`;

        btn.textContent = 'TRY AGAIN';
        btn.disabled = false;
    } finally {
        processing = false;
    }
}

function updateStep(stepNumber, state) {
    const step = document.getElementById(`step-${stepNumber}`);
    if (step) {
        step.className = `step ${state}`;
    }
}

// Function to process debate with Grok
async function processWithGrok(spaceId) {
    const grokStatus = document.getElementById('grok-status');
    grokStatus.innerHTML = '<br>PROCESSING WITH GROK...<br><span style="color: #ffd700;">This may take a few minutes...</span>';

    try {
        const response = await fetch(`http://localhost:3000/api/debate/process-debate-with-grok/${spaceId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            grokStatus.innerHTML = `
                <br><strong style="color: #00ba7c;">GROK ANALYSIS COMPLETE!</strong><br>
                PROCESSED: ${data.processed} messages<br>
                ERRORS: ${data.errors}<br>
                AVERAGE TRUTH SCORE: ${data.statistics.averageTruthScore}%<br>
                <br>
                <span style="color: #00ba7c;">✓ Truth scores now available in analytics</span>
            `;
        } else {
            throw new Error(data.error || 'Failed to process with Grok');
        }
    } catch (error) {
        console.error('Grok processing error:', error);
        grokStatus.innerHTML = `
            <br><strong style="color: #f91880;">GROK PROCESSING ERROR</strong><br>
            ${error.message}
        `;
    }
}
