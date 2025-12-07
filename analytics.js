let pollInterval;
let lastDataHash = null;

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const spaceId = urlParams.get('spaceId');

    if (!spaceId) {
        document.getElementById('space-title').textContent = 'NO SPACE ID';
        return;
    }

    // Initial load
    await loadData(spaceId);

    // Poll for updates every 30 seconds (not 5) to reduce flickering
    // Only update if data actually changed
    pollInterval = setInterval(() => loadData(spaceId), 3000);

    // Setup modal
    document.querySelector('.close-modal').onclick = () => {
        document.getElementById('propagation-modal').style.display = 'none';
    };
});

async function loadData(spaceId) {
    try {
        console.log('Loading data for space:', spaceId);
        const response = await fetch(`http://localhost:3000/api/spaces/${spaceId}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Received data from backend:', data);

        if (data.success && data.data) {
            console.log('Messages received:', data.data.messages);
            console.log('Space data:', data.data.space);
            updateDashboard(data.data);
        } else {
            console.warn('Veritas: No data found for space', spaceId);
            document.getElementById('space-title').textContent = 'WAITING FOR DATA...';

            // Show empty chart message
            const ctx = document.getElementById('truth-score-chart');
            if (ctx) {
                renderChart([]);
            }

            // Update average scores with no data
            updateAverageScores([]);
        }
    } catch (error) {
        console.error('Network error:', error);
        document.getElementById('space-title').textContent = 'CONNECTION ERROR';

        // Show error in chart area
        const canvas = document.getElementById('truth-score-chart');
        if (canvas && canvas.parentElement) {
            const parent = canvas.parentElement;
            if (!parent.querySelector('.error-message')) {
                const errorMsg = document.createElement('div');
                errorMsg.className = 'error-message';
                errorMsg.style.cssText = 'color: #ff4444; text-align: center; padding: 20px; font-family: monospace; font-size: 11px;';
                errorMsg.textContent = 'UNABLE TO CONNECT TO BACKEND';
                parent.appendChild(errorMsg);
            }
        }
    }
}

function updateDashboard(data) {
    const { space, messages } = data;

    // Header
    document.getElementById('space-title').textContent = (space.title || 'TWITTER SPACE').toUpperCase();
    document.getElementById('overall-score').textContent = space.overall_credibility_score;

    // Color code score
    const scoreEl = document.getElementById('overall-score');
    if (space.overall_credibility_score >= 80) scoreEl.style.color = 'var(--success-color)';
    else if (space.overall_credibility_score >= 50) scoreEl.style.color = 'var(--warning-color)';
    else scoreEl.style.color = 'var(--danger-color)';

    // Visualizations
    renderTimeline(messages);
    renderChart(messages);

    // Update average scores even if chart fails
    if (messages && messages.length > 0) {
        updateAverageScores(messages);
    }
}

// Keep track of timeline scale for zooming
let currentScale = 1;

function renderTimeline(messages) {
    const container = document.getElementById('timeline-container');

    // Clear container for web-based rendering (no SVG)
    container.innerHTML = '';
    // Don't override the CSS styles, just ensure the container is ready
    container.style.padding = '20px';
    container.style.background = '#000';

    // Improved topic assignment with multi-topic support
    const getTopics = (text) => {
        const t = text.toLowerCase();
        const foundTopics = new Set();

        // Topic 0: Vaccines/Health
        if (t.match(/\b(vaccine|vaccines|autism|covid|virus|doctor|health|medicine|herd|immunity|pandemic|shot|dose|medical)\b/)) {
            foundTopics.add(0);
        }

        // Topic 1: Social/Gender/Pay Gap
        if (t.match(/\b(gender|pay|gap|women|men|wage|sex|equality|rights|feminism|cents|dollar|earning)\b/)) {
            foundTopics.add(1);
        }

        // Topic 2: Politics/Border
        if (t.match(/\b(border|immigration|wall|migrants|aliens|crossing|mexico|trump|biden|election|vote|policy)\b/)) {
            foundTopics.add(2);
        }

        // Topic 3: Economy
        if (t.match(/\b(economy|jobs|inflation|tax|money|cost|price|market|trade|tariff|finance|wealth)\b/)) {
            foundTopics.add(3);
        }

        // Topic 4: Tech/AI/Autonomous
        if (t.match(/\b(ai|artificial|intelligence|tech|technology|robot|robotics|autonomous|vehicle|car|drive|driverless|lidar|vision|camera|sensor|neural|network|software|hardware|tesla|musk|optimus)\b/)) {
            foundTopics.add(4);
        }

        // If no specific topic found, mark as General (5)
        if (foundTopics.size === 0) {
            foundTopics.add(5);
        }

        return Array.from(foundTopics);
    };

    // Filter and process messages
    const filteredMessages = messages.filter(m => m.grok_verdict);

    if (filteredMessages.length === 0) {
        container.innerHTML = '<div style="color: #666; text-align: center; padding: 40px;">No messages to display</div>';
        return;
    }

    // Get score color - three colors only
    const getScoreColor = (score) => {
        if (score === null || score === undefined) return '#333333';

        // Three distinct colors matching the graph
        if (score <= 4) {
            // Red for low scores (1-4)
            return '#8b0000'; // Dark red from graph
        } else if (score <= 7) {
            // Yellow for medium scores (5-7)
            return '#fbbf24'; // Gold/yellow
        } else {
            // Green for high scores (8-10)
            return '#00ba7c'; // Green from graph (same for 8, 9, and 10)
        }
    };

    // Create timeline container
    const timeline = document.createElement('div');
    timeline.style.cssText = `
        width: 100%;
        max-width: 900px;
        margin: 0 auto;
        position: relative;
        padding: 40px 20px;
        min-height: 100%;
    `;

    // Add vertical line - minimal design
    const verticalLine = document.createElement('div');
    verticalLine.style.cssText = `
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1px;
        background: #333;
        transform: translateX(-50%);
    `;
    timeline.appendChild(verticalLine);

    // Get unique speakers for alternating sides
    const speakers = [...new Set(filteredMessages.map(m => m.speaker_display_name || m.speaker_username))];
    const speakerSides = {};
    speakers.forEach((speaker, idx) => {
        speakerSides[speaker] = idx % 2 === 0 ? 'left' : 'right';
    });

    // Create message blocks
    filteredMessages.forEach((message, index) => {
        const speaker = message.speaker_display_name || message.speaker_username;
        const side = speakerSides[speaker];
        const isLeft = side === 'left';

        // Message container
        const messageBlock = document.createElement('div');
        messageBlock.style.cssText = `
            display: flex;
            align-items: flex-start;
            margin-bottom: 48px;
            position: relative;
            ${isLeft ? 'flex-direction: row' : 'flex-direction: row-reverse'};
        `;

        // Timeline dot - minimal, color coded
        const timelineDot = document.createElement('div');
        timelineDot.className = 'timeline-dot';
        const dotColor = getScoreColor(message.truth_score);
        timelineDot.style.cssText = `
            position: absolute;
            left: 50%;
            top: 20px;
            width: 8px;
            height: 8px;
            background: ${dotColor};
            border: 1px solid #333;
            border-radius: 50%;
            transform: translateX(-50%);
            z-index: 3;
            cursor: pointer;
        `;

        // No connector line - cleaner look

        // Message card - minimal, monospace, on-brand
        const card = document.createElement('div');
        const cardColor = getScoreColor(message.truth_score);
        card.style.cssText = `
            width: 360px;
            ${isLeft ? 'margin-right: 30px' : 'margin-left: 30px'};
            background: #000;
            border: 1px solid #333;
            border-left: 2px solid ${cardColor};
            padding: 16px;
            position: relative;
            cursor: pointer;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 11px;
        `;

        // Card click handler - use same details panel as graph
        card.onclick = () => showChartPointDetails(message);

        // Speaker info - minimal and clean
        const speakerInfo = document.createElement('div');
        speakerInfo.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-bottom: 12px;
        `;

        const speakerName = document.createElement('div');
        speakerName.style.cssText = `
            font-size: 10px;
            font-weight: 500;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        `;
        speakerName.textContent = speaker;

        const messageNumber = document.createElement('div');
        messageNumber.style.cssText = `
            font-size: 9px;
            color: #444;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
        `;
        messageNumber.textContent = `${String(index + 1).padStart(3, '0')}`;

        speakerInfo.appendChild(speakerName);
        speakerInfo.appendChild(messageNumber);
        card.appendChild(speakerInfo);

        // Message content - monospace
        const messageContent = document.createElement('div');
        messageContent.style.cssText = `
            font-size: 12px;
            color: #aaa;
            line-height: 1.6;
            margin-bottom: 12px;
            max-height: 75px;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 4;
            -webkit-box-orient: vertical;
        `;
        messageContent.textContent = message.content || message.text || '';
        card.appendChild(messageContent);

        // Bottom info row - minimalist design
        const bottomRow = document.createElement('div');
        bottomRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            padding-top: 8px;
            border-top: 1px solid #222;
        `;

        // Truth score - clean and minimal
        const truthScore = document.createElement('div');
        truthScore.style.cssText = `
            display: flex;
            align-items: baseline;
            gap: 6px;
        `;

        const scoreValue = document.createElement('span');
        scoreValue.style.cssText = `
            font-size: 18px;
            font-weight: 400;
            color: ${cardColor};
        `;
        scoreValue.textContent = message.truth_score !== null ? message.truth_score : '—';

        const scoreSlash = document.createElement('span');
        scoreSlash.style.cssText = `
            font-size: 10px;
            color: #555;
        `;
        scoreSlash.textContent = '/10';

        truthScore.appendChild(scoreValue);
        truthScore.appendChild(scoreSlash);

        // Verdict - minimal badge
        const verdict = document.createElement('div');
        verdict.style.cssText = `
            font-size: 9px;
            font-weight: 500;
            color: ${cardColor};
            text-transform: uppercase;
            letter-spacing: 0.12em;
            padding: 3px 8px;
            border: 1px solid ${cardColor}40;
            background: transparent;
        `;
        verdict.textContent = message.grok_verdict || '';

        bottomRow.appendChild(truthScore);
        bottomRow.appendChild(verdict);
        card.appendChild(bottomRow);

        // Append card to message block
        messageBlock.appendChild(timelineDot);
        messageBlock.appendChild(card);

        // Add to timeline container
        timeline.appendChild(messageBlock);
    });

    // Append timeline to main container
    container.appendChild(timeline);
}

function getColor(verdict) {
    switch (verdict) {
        case 'True': return '#00ff00'; // Green
        case 'False': return '#ff0000'; // Red
        case 'Misleading': return '#ffd700'; // Yellow
        default: return '#666';
    }
}


let chartInstance;
let allMessages = []; // Store messages for click handling

function updateAverageScores(messages) {
    // Calculate average truth scores for each speaker
    const speakerScores = {};

    messages.forEach(msg => {
        if (msg.truth_score !== null && msg.truth_score !== undefined) {
            const speaker = msg.speaker_display_name || msg.speaker_username || 'Unknown';

            if (!speakerScores[speaker]) {
                speakerScores[speaker] = {
                    scores: [],
                    total: 0,
                    count: 0
                };
            }

            speakerScores[speaker].scores.push(msg.truth_score);
            speakerScores[speaker].total += msg.truth_score;
            speakerScores[speaker].count++;
        }
    });

    // Calculate averages
    const speakers = Object.keys(speakerScores).map(speaker => ({
        name: speaker,
        average: speakerScores[speaker].count > 0
            ? (speakerScores[speaker].total / speakerScores[speaker].count).toFixed(1)
            : 0,
        count: speakerScores[speaker].count
    }));

    // Sort by average (highest first)
    speakers.sort((a, b) => b.average - a.average);

    // Update the display (show only top 2 speakers)
    const speaker1El = document.getElementById('speaker1-avg');
    const speaker2El = document.getElementById('speaker2-avg');

    if (speakers.length >= 1 && speaker1El) {
        const speaker1 = speakers[0];
        speaker1El.querySelector('.speaker-name').textContent = speaker1.name.toUpperCase();
        const score1El = speaker1El.querySelector('.speaker-avg-score');
        score1El.textContent = speaker1.average + '/10';

        // Color coding based on score
        score1El.className = 'speaker-avg-score';
        if (speaker1.average >= 7) {
            score1El.classList.add('high-score');
        } else if (speaker1.average >= 5) {
            score1El.classList.add('medium-score');
        } else {
            score1El.classList.add('low-score');
        }
    }

    if (speakers.length >= 2 && speaker2El) {
        const speaker2 = speakers[1];
        speaker2El.querySelector('.speaker-name').textContent = speaker2.name.toUpperCase();
        const score2El = speaker2El.querySelector('.speaker-avg-score');
        score2El.textContent = speaker2.average + '/10';

        // Color coding based on score
        score2El.className = 'speaker-avg-score';
        if (speaker2.average >= 7) {
            score2El.classList.add('high-score');
        } else if (speaker2.average >= 5) {
            score2El.classList.add('medium-score');
        } else {
            score2El.classList.add('low-score');
        }
    }

    // Handle case with no data
    if (speakers.length === 0) {
        if (speaker1El) {
            speaker1El.querySelector('.speaker-name').textContent = 'NO DATA';
            speaker1El.querySelector('.speaker-avg-score').textContent = '--';
        }
        if (speaker2El) {
            speaker2El.querySelector('.speaker-name').textContent = 'NO DATA';
            speaker2El.querySelector('.speaker-avg-score').textContent = '--';
        }
    } else if (speakers.length === 1) {
        // Only one speaker
        if (speaker2El) {
            speaker2El.querySelector('.speaker-name').textContent = '--';
            speaker2El.querySelector('.speaker-avg-score').textContent = '--';
        }
    }

    // Remove loading state
    const widget = document.getElementById('average-score-widget');
    if (widget) {
        widget.classList.remove('loading');
    }
}

function renderChart(messages) {
    const canvas = document.getElementById('truth-score-chart');
    if (!canvas) {
        console.log('Chart canvas not found - chart may not be visible on this view');
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.error('Could not get chart context');
        return;
    }

    // Store messages globally for click handler
    allMessages = messages;

    // Update average scores
    updateAverageScores(messages);

    // Debug logging
    console.log('Rendering chart with messages:', messages);

    // Count messages with truth scores
    const messagesWithScores = messages.filter(m => m.truth_score !== null && m.truth_score !== undefined);
    console.log(`Messages with truth scores: ${messagesWithScores.length} out of ${messages.length}`);

    // Group messages by speaker and collect their scores chronologically
    const speakers = {};
    let minSequence = Infinity;
    let maxSequence = -Infinity;

    // Process messages in sequence order
    messages.forEach((m, globalIndex) => {
        // Use speaker_display_name or speaker_username as fallback
        const speakerName = m.speaker_display_name || m.speaker_username || 'Unknown Speaker';

        if (!speakers[speakerName]) {
            speakers[speakerName] = {
                dataPoints: [],
                messages: [], // Store message references
                color: null
            };
        }

        // Only add points where we have actual truth scores
        if (m.truth_score !== null && m.truth_score !== undefined) {
            const sequenceNum = m.sequence_number || globalIndex;

            // Track min and max for proper X-axis scaling
            minSequence = Math.min(minSequence, sequenceNum);
            maxSequence = Math.max(maxSequence, sequenceNum);

            speakers[speakerName].dataPoints.push({
                x: sequenceNum,
                y: m.truth_score
            });

            // Store the message reference for click handling
            speakers[speakerName].messages.push(m);
        }
    });

    // Filter out speakers with no data points
    const validSpeakers = Object.keys(speakers).filter(
        speaker => speakers[speaker].dataPoints.length > 0
    );

    console.log('Valid speakers with data:', validSpeakers);
    console.log('Speaker data:', speakers);
    console.log('X-axis range:', minSequence, 'to', maxSequence);

    // Define much darker colors for better visibility on black background
    const colors = [
        '#00ba7c',  // Dark green (same as LIVE text)
        '#8b0000',  // Dark red
        '#00ba7c',  // Dark green for additional speakers
        '#8b0000',  // Dark red for additional speakers
        '#006644',  // Even darker green variant
        '#660000',  // Even darker red variant
        '#004d33'   // Deep forest green
    ];

    // Create datasets for Chart.js
    const datasets = [];

    // Calculate average scores for coloring
    const speakerAverages = validSpeakers.map(s => {
        const points = speakers[s].dataPoints;
        const avg = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        return { speaker: s, avg };
    });

    // Sort by average score to determine colors
    speakerAverages.sort((a, b) => b.avg - a.avg); // Descending

    // Assign colors: Top half Dark Green (like LIVE text), Bottom half Dark Red
    const speakerColors = {};
    speakerAverages.forEach((item, i) => {
        // Simple binary: Top is Dark Green, Bottom is Dark Red
        // Using much darker colors for better visibility
        const isTop = i < speakerAverages.length / 2;
        speakerColors[item.speaker] = isTop ? '#00ba7c' : '#8b0000'; // Dark Green (like LIVE) / Dark Red
    });

    validSpeakers.forEach((speaker, idx) => {
        const color = speakerColors[speaker];
        const speakerData = speakers[speaker].dataPoints;

        // Sort data points by x value (sequence)
        speakerData.sort((a, b) => a.x - b.x);

        datasets.push({
            label: speaker,
            data: speakerData,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
            fill: false,
            tension: 0.2, // Slight curve for smoother lines
            showLine: true // Important: show the connecting line
        });
    });

    console.log('Chart datasets:', datasets);

    // Check if data actually changed before updating
    const dataHash = JSON.stringify(datasets);
    if (chartInstance && lastDataHash === dataHash) {
        console.log('Chart data unchanged, skipping update');
        return; // Don't update if data hasn't changed
    }
    lastDataHash = dataHash;

    // Calculate proper X-axis bounds
    const xMin = minSequence === Infinity ? 0 : Math.max(0, minSequence - 1);
    const xMax = maxSequence === -Infinity ? 10 : maxSequence + 1;

    // Show a message if no data available
    const chartContainer = document.getElementById('chart-container');
    if (datasets.length === 0) {
        // Remove existing chart if present
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        // Show informative message
        const canvas = document.getElementById('truth-score-chart');
        if (!canvas) {
            console.log('Chart canvas not found - skipping chart render');
            return;
        }
        const parent = canvas.parentElement;

        // Check if message already exists
        let noDataMsg = document.getElementById('no-chart-data-message');
        if (!noDataMsg) {
            noDataMsg = document.createElement('div');
            noDataMsg.id = 'no-chart-data-message';
            noDataMsg.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                text-align: center;
                color: #71767b;
                font-size: 14px;
                line-height: 1.5;
                padding: 20px;
            `;
            noDataMsg.innerHTML = `
                <div style="font-size: 16px; margin-bottom: 10px;">NO TRUTH SCORES AVAILABLE</div>
                <div style="font-size: 12px;">Messages need to be fact-checked to display truth scores</div>
                <div style="font-size: 11px; margin-top: 10px; color: #555;">
                    ${messagesWithScores.length} of ${messages.length} messages have been analyzed
                </div>
            `;
            parent.style.position = 'relative';
            parent.appendChild(noDataMsg);
        }

        // Hide canvas
        canvas.style.display = 'none';
        return;
    }

    // Remove no-data message if it exists and show canvas
    const noDataMsg = document.getElementById('no-chart-data-message');
    if (noDataMsg) {
        noDataMsg.remove();
    }
    const chartCanvas = document.getElementById('truth-score-chart');
    if (chartCanvas) {
        chartCanvas.style.display = 'block';
    }

    // Update or create chart
    if (chartInstance) {
        chartInstance.data.datasets = datasets;
        chartInstance.options.scales.x.min = xMin;
        chartInstance.options.scales.x.max = xMax;
        chartInstance.update('none'); // 'none' prevents animation on update
    } else {
        chartInstance = new Chart(ctx, {
            type: 'line', // Changed from 'scatter' to 'line' for better line display
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 0 // Disable animations to prevent flickering
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#fff',
                            font: {
                                family: 'monospace',
                                size: 11,
                                weight: '400'
                            },
                            padding: 15,
                            usePointStyle: true, // Use circles instead of rectangles
                            pointStyle: 'circle',
                            boxHeight: 6
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: Score ${context.parsed.y}/10 (Message #${context.parsed.x})`;
                            }
                        }
                    }
                },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const element = elements[0];
                        const datasetIndex = element.datasetIndex;
                        const pointIndex = element.index;

                        // Find the message that corresponds to this point
                        const sequence = chartInstance.data.datasets[datasetIndex].data[pointIndex].x;
                        const message = allMessages.find(m => m.sequence_number === sequence);

                        if (message) {
                            // Show details in the sidebar
                            showChartPointDetails(message);
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        min: xMin,
                        max: xMax,
                        title: {
                            display: true,
                            text: 'MESSAGE SEQUENCE',
                            color: '#999',
                            font: {
                                family: 'monospace',
                                size: 10
                            }
                        },
                        grid: {
                            color: '#333',
                            borderDash: [5, 5]
                        },
                        ticks: {
                            color: '#999',
                            stepSize: 1,
                            font: {
                                family: 'monospace',
                                size: 10
                            }
                        }
                    },
                    y: {
                        min: 0,
                        max: 11,  // Set to 11 to give padding above 10 so points aren't cut off
                        title: {
                            display: true,
                            text: 'TRUTH SCORE',
                            color: '#999',
                            font: {
                                family: 'monospace',
                                size: 10
                            }
                        },
                        grid: {
                            color: '#333',
                            borderDash: [5, 5]
                        },
                        ticks: {
                            color: '#999',
                            stepSize: 1,
                            max: 10,  // Don't show tick for 11
                            font: {
                                family: 'monospace',
                                size: 10
                            },
                            callback: function (value) {
                                // Simple 0-10 format (no "/10")
                                if (value <= 10 && value >= 0 && Number.isInteger(value)) {
                                    return value;
                                }
                                return '';  // Hide the 11 tick
                            }
                        }
                    }
                }
            }
        });
    }

    // If no data, show a message
    if (datasets.length === 0) {
        console.log('No truth scores available yet - messages need to be fact-checked');
        const canvas = document.getElementById('truth-score-chart');
        const parent = canvas.parentElement;
        if (!parent.querySelector('.no-data-message')) {
            const noDataMsg = document.createElement('div');
            noDataMsg.className = 'no-data-message';
            noDataMsg.style.cssText = 'color: #666; text-align: center; padding: 20px; font-family: monospace; font-size: 11px;';
            noDataMsg.textContent = 'NO TRUTH SCORES AVAILABLE YET';
            parent.appendChild(noDataMsg);
        }
    }
}

function showDetails(node) {
    const container = document.getElementById('node-details');
    container.innerHTML = `
        <div class="detail-item">
            <div class="detail-label">SPEAKER</div>
            <div class="detail-value">${node.speaker}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">CLAIM</div>
            <div class="detail-value quote">"${node.text}"</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">VERDICT</div>
            <div class="detail-value" style="color: ${getColor(node.verdict)}">
                ${node.verdict.toUpperCase()} (${node.score}/10)
            </div>
        </div>
        <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button class="dive-btn" id="dive-btn-${node.id}" style="flex: 1;">
                DIVE DEEPER
            </button>
            <button class="dive-btn" id="consistency-btn-${node.id}" style="flex: 1; border-color: #f91880; color: #f91880;">
                CHECK CONSISTENCY
            </button>
        </div>
    `;

    document.getElementById(`dive-btn-${node.id}`).onclick = () => diveDeeper(node.id, node.text);
    document.getElementById(`consistency-btn-${node.id}`).onclick = () => analyzeConsistency(node);
}

// Modal control functions
window.openConsistencyModal = function() {
    const modal = document.getElementById('consistency-modal');
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

window.closeConsistencyModal = function() {
    const modal = document.getElementById('consistency-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Set up event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Close modal when clicking outside
    const modal = document.getElementById('consistency-modal');
    if (modal) {
        modal.addEventListener('click', function(event) {
            if (event.target === modal) {
                closeConsistencyModal();
            }
        });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closeConsistencyModal();
        }
    });

    // Make sure X button works
    const closeButton = modal?.querySelector('.close-modal');
    if (closeButton) {
        closeButton.addEventListener('click', function(event) {
            event.preventDefault();
            closeConsistencyModal();
        });
    }
});

window.analyzeConsistency = async function (node) {
    const modal = document.getElementById('consistency-modal');
    const content = document.getElementById('consistency-content');

    // Open the modal
    openConsistencyModal();

    // Show loading state
    content.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
            <div class="loading-text">
                Analyzing past statements by ${node.speaker}...
            </div>
        </div>
    `;

    try {
        const response = await fetch('http://localhost:3000/api/debate/consistency', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                speaker: node.speaker,
                claim: node.text,
                topic: ['Economy', 'Foreign Policy', 'Healthcare'][node.topicId] || 'General'
            })
        });

        const data = await response.json();

        if (data.success) {
            content.innerHTML = `
                <div style="display: flex; gap: 30px; max-width: 100%;">
                    <div style="flex: 0 0 200px;">
                        <div style="border: 1px solid #333; padding: 20px; text-align: center; background: rgba(0, 186, 124, 0.05);">
                            <div style="color: #666; font-size: 11px; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.1em;">CONSISTENCY SCORE</div>
                            <div style="font-size: 36px; color: ${data.score >= 8 ? '#00ba7c' : data.score >= 5 ? '#cc9900' : '#8b0000'}; font-weight: bold; margin-bottom: 10px;">
                                ${data.score}/10
                            </div>
                            <div style="font-size: 12px; color: #e7e9ea; text-transform: uppercase; letter-spacing: 0.05em;">${data.verdict}</div>
                        </div>
                    </div>
                    <div style="flex: 1; max-width: calc(100% - 230px);">
                        <div style="margin-bottom: 25px;">
                            <div style="color: #999; font-size: 11px; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.1em;">ANALYSIS</div>
                            <div style="line-height: 1.6; color: #e7e9ea; font-size: 14px;">${data.analysis}</div>
                        </div>

                        <div>
                            <div style="color: #999; font-size: 11px; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.1em;">PAST STATEMENTS</div>
                            <div style="max-height: 300px; overflow-y: auto; padding-right: 10px;">
                                ${data.past_tweets.map(t => `
                                    <div style="background: rgba(255, 255, 255, 0.03); padding: 12px; margin-bottom: 8px; border-left: 2px solid #00ba7c; transition: background 0.2s;">
                                        <div style="font-size: 10px; color: #666; margin-bottom: 5px; text-transform: uppercase;">${t.date}</div>
                                        <div style="font-style: italic; color: #e7e9ea; font-size: 13px; line-height: 1.5;">"${t.text}"</div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            content.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <div style="color: #8b0000; font-size: 16px; margin-bottom: 10px;">Analysis Failed</div>
                    <div style="color: #666; font-size: 14px;">${data.error || 'Unable to analyze consistency at this time'}</div>
                </div>
            `;
        }
    } catch (e) {
        content.innerHTML = `<div style="color: #f91880;">Error: ${e.message}</div>`;
    }
}

// New function for showing details from chart clicks
function showChartPointDetails(message) {
    const container = document.getElementById('node-details');
    const speakerName = message.speaker_display_name || message.speaker_username || 'Unknown';
    const verdictColor = getVerdictColor(message.grok_verdict);


    // Parse the grok_response_raw to get detailed claims if available
    let claimsHTML = '';

    console.log('Checking claims for message:', message.id);
    console.log('grok_response_raw type:', typeof message.grok_response_raw);
    console.log('grok_response_raw:', message.grok_response_raw);

    try {
        if (message.grok_response_raw) {
            let grokData = message.grok_response_raw;

            // Handle if it's already an object
            if (typeof grokData === 'object' && grokData !== null) {
                // Already parsed
                console.log('grokData is already an object:', grokData);
                console.log('grokData.claims:', grokData.claims);
                console.log('Is grokData an array?', Array.isArray(grokData));
            } else if (typeof grokData === 'string') {
                // Parse once
                console.log('Parsing grokData string...');
                grokData = JSON.parse(grokData);

                // Check if it's still a string (double-encoded)
                if (typeof grokData === 'string') {
                    console.log('Double-encoded, parsing again...');
                    grokData = JSON.parse(grokData);
                }
            }

            console.log('Final parsed grokData:', grokData);
            console.log('Final grokData type:', typeof grokData);
            console.log('Final grokData keys:', grokData ? Object.keys(grokData) : 'null');

            // Handle both formats:
            // 1. {claims: [...], summary: "...", truth_score: X}
            // 2. Just an array of claims [...]
            let claimsArray;
            if (Array.isArray(grokData)) {
                claimsArray = grokData;
            } else if (grokData.claims && Array.isArray(grokData.claims)) {
                claimsArray = grokData.claims;
            }

            // Build claims section if available
            console.log('Claims array:', claimsArray);
            console.log('Claims array length:', claimsArray ? claimsArray.length : 0);

            if (claimsArray && claimsArray.length > 0) {
                // Store claims data for interaction
                const claimsData = claimsArray.map((claim, idx) => ({
                    ...claim,
                    id: `claim-${message.id}-${idx}`
                }));

                console.log('Processing claims data:', claimsData);

                // Store the grokData globally for access
                window.currentGrokData = grokData;
                window.currentMessageId = message.id;

                claimsHTML = `
                <div class="detail-item">
                    <div class="detail-label">CLAIMS (${claimsData.length} found)</div>
                    <div class="claims-list">
                        ${claimsData.map((claim, idx) => {
                    const sourcesCount = claim.sources ? claim.sources.length : 0;
                    console.log(`Processing claim ${idx}:`, claim.text, 'Score:', claim.score, 'Sources:', sourcesCount);
                    return `
                            <div class="claim-container" style="margin-bottom: 8px;">
                                <div class="claim-detail"
                                     id="${claim.id}"
                                     data-claim-idx="${idx}"
                                     data-message-id="${message.id}"
                                     style="border: 1px solid #333; padding: 12px; cursor: pointer;
                                            transition: all 0.2s ease; position: relative;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                        <div style="flex: 1;">
                                            <div style="color: #e7e9ea; font-size: 12px; line-height: 1.4;">
                                                "${claim.text}"
                                            </div>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 8px; margin-left: 16px;">
                                            <span style="color: ${getScoreColor(claim.score)}; font-size: 12px; font-weight: 600;">
                                                ${claim.score}/10
                                            </span>
                                            ${sourcesCount > 0 ? `
                                            <span class="sources-toggle" style="color: #71767b; font-size: 10px; text-transform: uppercase;">
                                                [${sourcesCount}] ▼
                                            </span>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                                ${(claim.explanation || sourcesCount > 0) ? `
                                <div class="claim-sources" id="sources-${claim.id}"
                                     style="display: none; border: 1px solid #333; border-top: none;
                                            padding: 8px 12px; background: rgba(0,0,0,0.5);">
                                    ${claim.explanation ? `
                                    <div style="padding: 8px 0 12px 0; border-bottom: 1px solid #333; margin-bottom: 8px;">
                                        <div style="color: #999; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">EXPLANATION</div>
                                        <div style="color: #e7e9ea; font-size: 11px; line-height: 1.4;">
                                            ${claim.explanation}
                                        </div>
                                    </div>
                                    ` : ''}
                                    ${claim.verdict ? `
                                    <div style="padding: 8px 0 12px 0; border-bottom: 1px solid #333; margin-bottom: 8px;">
                                        <div style="color: #999; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">VERDICT</div>
                                        <div style="color: ${getVerdictColor(claim.verdict)}; font-size: 11px; font-weight: 600;">
                                            ${claim.verdict.toUpperCase()}
                                        </div>
                                    </div>
                                    ` : ''}
                                    ${sourcesCount > 0 ? `
                                    <div style="padding-top: 4px;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                            <div style="color: #999; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em;">SOURCES</div>
                                            <button
                                                class="generate-sources-btn"
                                                data-message-id="${message.id}"
                                                data-claim-index="${idx}"
                                                data-claim-text="${claim.text.replace(/"/g, '&quot;')}"
                                                style="background: #000;
                                                       color: #fff;
                                                       border: 1px solid #fff;
                                                       padding: 4px 10px;
                                                       font-size: 8px;
                                                       font-weight: 600;
                                                       text-transform: uppercase;
                                                       letter-spacing: 0.05em;
                                                       cursor: pointer;
                                                       transition: all 0.2s ease;
                                                       font-family: 'SF Mono', Monaco, monospace;">
                                                Generate More
                                            </button>
                                        </div>
                                    </div>
                                    ` : ''}
                                    ${claim.sources ? claim.sources.map(source => {
                        let displayText = source.url || source;
                        let fullUrl = source.url || source;

                        try {
                            if (displayText.startsWith('http')) {
                                const url = new URL(displayText);
                                displayText = url.hostname.replace('www.', '');
                            }
                        } catch (e) {
                            if (displayText.length > 30) {
                                displayText = displayText.substring(0, 30) + '...';
                            }
                        }

                        return `
                                        <div class="source-item" data-url="${fullUrl}"
                                             style="padding: 4px 0; cursor: pointer; display: flex; align-items: center; gap: 8px;
                                                    transition: opacity 0.2s;">
                                            <span style="color: #71767b; font-size: 10px;">→</span>
                                            <span style="color: #71767b; font-size: 10px; flex: 1;">${displayText}</span>
                                        </div>
                                        `;
                    }).join('') : ''}
                                </div>
                                ` : ''}
                            </div>
                            `;
                }).join('')}
                    </div>
                </div>`;

                // Store claims data globally for click handler
                window.currentClaimsData = claimsData;
                console.log('Generated claimsHTML length:', claimsHTML.length);
            } else {
                console.log('No claims found or empty claims array');
            }
        } else {
            console.log('No grok_response_raw field');
        }
    } catch (e) {
        console.error('Error parsing grok response:', e, e.stack);
    }

    container.innerHTML = `
        <div class="detail-item">
            <div class="detail-label">SPEAKER</div>
            <div class="detail-value">@${speakerName}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">MESSAGE #${message.sequence_number}</div>
            <div class="detail-value quote" style="font-size: 12px; line-height: 1.5; color: #e7e9ea;">
                "${message.content}"
            </div>
        </div>
        <div class="detail-item">
            <div class="detail-label">OVERALL VERDICT</div>
            <div class="detail-value" style="color: ${verdictColor}; font-size: 14px; font-weight: 600;">
                ${(message.grok_verdict || 'UNVERIFIED').toUpperCase()} (${message.truth_score || 'N/A'}/10)
            </div>
        </div>
        ${message.grok_explanation ? `
        <div class="detail-item">
            <div class="detail-label">SUMMARY</div>
            <div class="detail-value" style="font-size: 11px; line-height: 1.5; color: #d6d9db;">
                ${message.grok_explanation}
            </div>
        </div>
        ` : ''}
        ${claimsHTML}
        <div style="margin-top: 20px; display: flex; gap: 10px;">
            <button class="dive-btn" id="dive-btn-${message.id}" style="flex: 1;">
                DIVE DEEPER →
            </button>
            <button class="dive-btn" id="consistency-btn-${message.id}" style="flex: 1; border-color: #f91880; color: #f91880;">
                CHECK CONSISTENCY
            </button>
        </div>
    `;

    // Don't auto-scroll - let user control scrolling
    // document.getElementById('details-widget').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Add click handler for dive deeper
    const diveBtn = document.getElementById(`dive-btn-${message.id}`);
    if (diveBtn) {
        diveBtn.onclick = () => diveDeeper(message.id, message.content);
    }

    // Add click handler for consistency check
    const consistencyBtn = document.getElementById(`consistency-btn-${message.id}`);
    if (consistencyBtn) {
        // Create a node object with the required properties for analyzeConsistency
        const node = {
            id: message.id,
            speaker: speakerName,
            text: message.content || message.text,
            truth_score: message.truth_score,
            grok_verdict: message.grok_verdict
        };
        consistencyBtn.onclick = () => analyzeConsistency(node);
    }

    // Add click handlers for claims (after HTML is inserted)
    document.querySelectorAll('.claim-detail').forEach(claimEl => {
        claimEl.addEventListener('click', function (e) {
            e.stopPropagation();
            const claimId = this.getAttribute('id');
            const sourcesDiv = document.getElementById(`sources-${claimId}`);
            const toggle = this.querySelector('.sources-toggle');

            if (sourcesDiv) {
                // Toggle the sources dropdown
                if (sourcesDiv.style.display === 'none' || !sourcesDiv.style.display) {
                    // Close all other dropdowns first
                    document.querySelectorAll('.claim-sources').forEach(sources => {
                        sources.style.display = 'none';
                    });
                    document.querySelectorAll('.sources-toggle').forEach(t => {
                        if (t.textContent.includes('▼')) {
                            t.innerHTML = t.innerHTML.replace('▼', '▼');
                        }
                    });

                    // Open this dropdown
                    sourcesDiv.style.display = 'block';
                    if (toggle) {
                        toggle.innerHTML = toggle.innerHTML.replace('▼', '▲');
                    }
                } else {
                    // Close this dropdown
                    sourcesDiv.style.display = 'none';
                    if (toggle) {
                        toggle.innerHTML = toggle.innerHTML.replace('▲', '▼');
                    }
                }
            }
        });

        // Add hover effects
        claimEl.addEventListener('mouseenter', function () {
            this.style.borderColor = '#555';
        });
        claimEl.addEventListener('mouseleave', function () {
            this.style.borderColor = '#333';
        });
    });

    // Add click handlers for source items
    document.querySelectorAll('.source-item').forEach(item => {
        item.addEventListener('click', function (e) {
            e.stopPropagation();
            const url = this.getAttribute('data-url');
            window.open(url, '_blank');
        });

        item.addEventListener('mouseenter', function () {
            this.style.opacity = '1';
        });
        item.addEventListener('mouseleave', function () {
            this.style.opacity = '0.8';
        });
    });

    // Add handlers for "Generate More Sources" buttons
    document.querySelectorAll('.generate-sources-btn').forEach(btn => {
        btn.addEventListener('click', async function (e) {
            e.stopPropagation();

            const messageId = this.getAttribute('data-message-id');
            const claimIndex = this.getAttribute('data-claim-index');
            const claimText = this.getAttribute('data-claim-text');

            // Pause polling to prevent race conditions
            console.log('⏸️  Pausing auto-refresh during source generation');
            if (window.pollInterval) {
                clearInterval(window.pollInterval);
            }

            // Update button state to loading
            const originalHTML = this.innerHTML;
            const originalBackground = this.style.background;
            const originalColor = this.style.color;
            this.disabled = true;
            this.style.opacity = '0.6';
            this.style.cursor = 'not-allowed';
            this.innerHTML = 'Generating...';

            try {
                const response = await fetch(`http://localhost:3000/api/claims/${messageId}/${claimIndex}/generate-sources`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        claimText: claimText
                    })
                });

                const data = await response.json();

                if (data.success) {
                    console.log('✅ Source generation successful!');
                    console.log('📊 Response data:', data);
                    console.log('🔗 New sources:', data.sources);

                    // Success - flash white background and reload the details panel
                    this.style.background = '#fff';
                    this.style.color = '#000';
                    this.style.border = '1px solid #000';
                    this.innerHTML = 'Generated!';

                    // Show success feedback
                    setTimeout(async () => {
                        console.log('🔄 Refreshing data from backend...');
                        const spaceId = window.currentSpaceId || new URLSearchParams(window.location.search).get('spaceId');
                        console.log('📍 Space ID:', spaceId);

                        // Save which dropdowns are currently open
                        const openDropdowns = new Set();
                        document.querySelectorAll('.claim-sources').forEach(sourcesDiv => {
                            if (sourcesDiv.style.display === 'block') {
                                openDropdowns.add(sourcesDiv.id);
                            }
                        });
                        console.log('💾 Saved open dropdowns:', Array.from(openDropdowns));

                        // Re-fetch the message from backend to get updated sources
                        const refreshResponse = await fetch(`http://localhost:3000/api/debate/debate-results/${spaceId}`);
                        const refreshData = await refreshResponse.json();

                        console.log('📥 Refresh response:', refreshData);

                        if (refreshData.success) {
                            console.log('🔍 Looking for message ID:', messageId);
                            console.log('📋 Available messages:', refreshData.messages.map(m => m.id));

                            // Find the updated message
                            const updatedMessage = refreshData.messages.find(m => m.id === messageId);

                            if (updatedMessage) {
                                console.log('✅ Found updated message:', updatedMessage);
                                console.log('🔗 Updated grok_response_raw:', updatedMessage.grok_response_raw);

                                // Reload the details panel with updated data
                                showChartPointDetails(updatedMessage);

                                // Restore dropdown states after a brief delay (to let DOM update)
                                setTimeout(() => {
                                    openDropdowns.forEach(dropdownId => {
                                        const dropdown = document.getElementById(dropdownId);
                                        if (dropdown) {
                                            dropdown.style.display = 'block';
                                            // Also update the toggle arrow
                                            const claimId = dropdownId.replace('sources-', '');
                                            const toggle = document.querySelector(`#${claimId} .sources-toggle`);
                                            if (toggle) {
                                                toggle.innerHTML = toggle.innerHTML.replace('▼', '▲');
                                            }
                                        }
                                    });
                                    console.log('✅ Restored dropdown states');
                                }, 100);

                                // Resume polling
                                console.log('▶️  Resuming auto-refresh');
                                const finalSpaceId = window.currentSpaceId || new URLSearchParams(window.location.search).get('spaceId');
                                window.pollInterval = setInterval(() => loadData(finalSpaceId), 3000);
                            } else {
                                console.error('❌ Message not found in refresh data');
                            }
                        } else {
                            console.error('❌ Refresh failed:', refreshData);
                        }
                    }, 800);
                } else {
                    throw new Error(data.error || 'Failed to generate sources');
                }
            } catch (error) {
                console.error('Error generating sources:', error);

                // Show error state
                this.style.background = '#dc2626';
                this.style.color = '#fff';
                this.style.border = '1px solid #dc2626';
                this.innerHTML = 'Failed';

                // Resume polling even on error
                console.log('▶️  Resuming auto-refresh after error');
                const spaceId = window.currentSpaceId || new URLSearchParams(window.location.search).get('spaceId');
                window.pollInterval = setInterval(() => loadData(spaceId), 3000);

                // Revert after delay
                setTimeout(() => {
                    this.disabled = false;
                    this.style.opacity = '1';
                    this.style.cursor = 'pointer';
                    this.style.background = originalBackground;
                    this.style.color = originalColor;
                    this.style.border = '1px solid #fff';
                    this.innerHTML = originalHTML;
                }, 2000);
            }
        });

        // Hover effects
        btn.addEventListener('mouseenter', function () {
            if (!this.disabled) {
                this.style.background = '#fff';
                this.style.color = '#000';
            }
        });
        btn.addEventListener('mouseleave', function () {
            if (!this.disabled) {
                this.style.background = '#000';
                this.style.color = '#fff';
            }
        });
    });
}

// Helper function to get color based on score
function getScoreColor(score) {
    if (score === null || score === undefined) return '#71767b';
    if (score >= 8) return '#00ba7c';  // Green
    if (score >= 5) return '#fbbf24';  // Yellow
    return '#dc2626';  // Red
}

// Helper function to get verdict color
function getVerdictColor(verdict) {
    switch (verdict?.toLowerCase()) {
        case 'true': return '#00ba7c';  // Green
        case 'false': return '#dc2626';  // Red
        case 'misleading': return '#f91880';  // Pink
        case 'mixed': return '#ffd700';  // Gold
        default: return '#71767b';  // Grey
    }
}

window.diveDeeper = async function (messageId, claimText) {
    const modal = document.getElementById('propagation-modal');
    modal.style.display = 'block';

    const container = document.getElementById('propagation-graph');

    // Check if we already have a graph rendered
    const isUpdate = container.querySelector('svg') !== null;
    let loadingToast = null;

    if (!isUpdate) {
        // Initial load - show full loading screen
        container.innerHTML = `
            <div style="color: #fff; text-align: center; padding: 50px;">
                <div style="display: inline-block; width: 30px; height: 30px; border: 2px solid #333; border-top-color: #ffd700; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <br><br>
                ANALYZING CLAIM PROPAGATION...
                <br>
                <span style="color: #666; font-size: 10px;">Tracing origin and spread across X</span>
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        `;
    } else {
        // Update mode - show toast
        loadingToast = document.createElement('div');
        loadingToast.style.cssText = `
            position: absolute; top: 20px; right: 20px; background: #333; color: #fff; 
            padding: 10px 20px; border-radius: 4px; font-size: 12px; z-index: 100;
            display: flex; align-items: center; gap: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        `;
        loadingToast.innerHTML = `
            <div style="width: 12px; height: 12px; border: 2px solid #666; border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <span>EXPANDING GRAPH...</span>
        `;
        container.appendChild(loadingToast);
    }

    try {
        const response = await fetch('http://localhost:3000/api/analytics/dive-deeper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messageId: messageId,
                claim: claimText
            })
        });

        const data = await response.json();

        if (loadingToast) loadingToast.remove();

        if (data.success && data.graph) {
            if (isUpdate && window.currentGraphData) {
                // Merge new data with existing data
                const existingNodes = new Set(window.currentGraphData.nodes.map(n => n.id));
                const existingLinks = new Set(window.currentGraphData.links.map(l => `${l.source.id || l.source}-${l.target.id || l.target}`));

                let newNodesCount = 0;

                data.graph.nodes.forEach(node => {
                    if (!existingNodes.has(node.id)) {
                        window.currentGraphData.nodes.push(node);
                        existingNodes.add(node.id);
                        newNodesCount++;
                    }
                });

                data.graph.links.forEach(link => {
                    const linkId = `${link.source}-${link.target}`;
                    if (!existingLinks.has(linkId)) {
                        window.currentGraphData.links.push(link);
                        existingLinks.add(linkId);
                    }
                });

                console.log(`Merged ${newNodesCount} new nodes into graph`);
                renderPropagationGraph(window.currentGraphData);

                // Show success toast
                const successToast = document.createElement('div');
                successToast.style.cssText = `
                    position: absolute; top: 20px; right: 20px; background: #00ba7c; color: #fff; 
                    padding: 10px 20px; border-radius: 4px; font-size: 12px; z-index: 100;
                    animation: fadeOut 2s forwards 2s;
                `;
                successToast.textContent = `ADDED ${newNodesCount} NEW NODES`;
                container.appendChild(successToast);

                // Add fadeOut animation style if not exists
                if (!document.getElementById('toast-style')) {
                    const style = document.createElement('style');
                    style.id = 'toast-style';
                    style.textContent = `@keyframes fadeOut { to { opacity: 0; visibility: hidden; } }`;
                    document.head.appendChild(style);
                }

            } else {
                // First render
                window.currentGraphData = data.graph;
                renderPropagationGraph(data.graph);
            }
        } else {
            if (isUpdate) {
                alert(`Failed to expand graph: ${data.error || 'Unknown error'}`);
            } else {
                container.innerHTML = `
                    <div style="color: #ff4444; text-align: center; padding: 50px;">
                        FAILED TO GENERATE GRAPH
                        <br><span style="color: #666; font-size: 10px;">${data.error || 'Unknown error'}</span>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Dive deeper error:', error);
        if (loadingToast) loadingToast.remove();

        if (isUpdate) {
            alert(`Network error: ${error.message}`);
        } else {
            container.innerHTML = `
                <div style="color: #ff4444; text-align: center; padding: 50px;">
                    NETWORK ERROR
                    <br><span style="color: #666; font-size: 10px;">${error.message}</span>
                </div>
            `;
        }
    }
}

function renderPropagationGraph(graphData) {
    const container = document.getElementById('propagation-graph');
    const detailsPanel = document.getElementById('propagation-details');

    // Clear previous content
    container.innerHTML = '';
    detailsPanel.innerHTML = '<div class="details-placeholder">SELECT A NODE TO VIEW DETAILS</div>';

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    // Create header with claim summary and stats
    const header = document.createElement('div');
    header.style.cssText = 'padding: 15px; border-bottom: 1px solid #333; font-size: 11px; position: absolute; top: 0; left: 0; width: 100%; background: rgba(0,0,0,0.8); z-index: 10;';
    header.innerHTML = `
        <div style="color: #999; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">CLAIM BEING TRACED</div>
        <div style="color: #fff; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">"${graphData.claim_summary || 'Unknown claim'}"</div>
        <div style="display: flex; gap: 15px; font-size: 10px;">
            <span style="color: #00ba7c;">● ${graphData.statistics?.supporters || 0} SUPPORTERS</span>
            <span style="color: #f91880;">● ${graphData.statistics?.contradictors || 0} CONTRADICTORS</span>
            <span style="color: #ffd700;">TOTAL: ${formatNumber(graphData.statistics?.total_impressions || 0)} IMPRESSIONS</span>
        </div>
    `;
    container.appendChild(header);

    // Create SVG container
    const svgContainer = document.createElement('div');
    svgContainer.style.cssText = `width: 100%; height: 100%; padding-top: 80px; box-sizing: border-box;`;
    container.appendChild(svgContainer);

    const svg = d3.select(svgContainer)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('viewBox', `0 0 ${width} ${height}`);

    // Prepare nodes and links
    const nodes = graphData.nodes || [];
    const links = graphData.links || [];

    // Calculate node sizes based on impressions (using log scale for better visualization)
    const maxImpressions = Math.max(...nodes.map(n => n.impressions || 1));
    const minSize = 8;
    const maxSize = 40;

    nodes.forEach(node => {
        const impressions = node.impressions || 1;
        // Log scale for sizing
        const logScale = Math.log10(impressions + 1) / Math.log10(maxImpressions + 1);
        node.radius = minSize + (maxSize - minSize) * logScale;
    });

    // Color based on stance
    function getStanceColor(stance) {
        switch (stance?.toLowerCase()) {
            case 'supports': return '#00ba7c';
            case 'contradicts': return '#f91880';
            case 'original': return '#ffd700';
            default: return '#71767b';
        }
    }

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(100).strength(0.5))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(d => d.radius + 5));

    // Create arrow markers for links
    svg.append('defs').selectAll('marker')
        .data(['retweet', 'quote', 'reply'])
        .join('marker')
        .attr('id', d => `arrow-${d}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 15)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('fill', '#666')
        .attr('d', 'M0,-5L10,0L0,5');

    // Draw links
    const link = svg.append('g')
        .attr('stroke-opacity', 0.6)
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke', '#444')
        .attr('stroke-width', d => d.type === 'retweet' ? 2 : 1)
        .attr('stroke-dasharray', d => d.type === 'reply' ? '4,2' : null)
        .attr('marker-end', d => `url(#arrow-${d.type})`);

    // Create node groups
    const node = svg.append('g')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .style('cursor', 'pointer')
        .call(drag(simulation))
        .on('click', (event, d) => {
            // Highlight selected node
            node.selectAll('circle').attr('stroke', '#333').attr('stroke-width', 1);
            d3.select(event.currentTarget).select('circle').attr('stroke', '#fff').attr('stroke-width', 3);

            // Update details panel
            updateDetailsPanel(d, graphData.origin);
        });

    // Draw circles
    node.append('circle')
        .attr('r', d => d.radius)
        .attr('fill', d => getStanceColor(d.stance))
        .attr('stroke', d => d.verified ? '#fff' : '#333')
        .attr('stroke-width', d => d.verified ? 2 : 1)
        .attr('opacity', 0.9);

    // Add verified badge for high-profile accounts
    node.filter(d => d.verified)
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', 4)
        .attr('font-size', d => Math.max(8, d.radius * 0.5))
        .attr('fill', '#fff')
        .text('✓');

    // Add tooltip (simple hover)
    node.append('title').text(d => `${d.display_name} (@${d.username})\n${d.tweet_text?.substring(0, 50)}...`);

    // Update positions on tick
    simulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Add legend
    const legend = document.createElement('div');
    legend.style.cssText = 'padding: 10px 15px; border-top: 1px solid #333; font-size: 9px; color: #666; display: flex; gap: 20px; position: absolute; bottom: 0; width: 100%; background: #000;';
    legend.innerHTML = `
        <span>NODE SIZE = IMPRESSIONS</span>
        <span>— RETWEET</span>
        <span>┄┄ REPLY</span>
        <span style="color: #fff;">✓ = VERIFIED</span>
    `;
    container.appendChild(legend);
}

function updateDetailsPanel(node, origin) {
    const detailsPanel = document.getElementById('propagation-details');

    // Helper to render a tweet card
    const renderCard = (data, title) => `
        <div style="color: #999; font-size: 10px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.1em;">${title}</div>
        <div class="tweet-card">
            <div class="tweet-header">
                <div>
                    <span class="tweet-author">${data.display_name}</span>
                    <span class="tweet-handle">${data.username}</span>
                    ${data.verified ? '<span style="color: #1d9bf0;">✓</span>' : ''}
                </div>
                <div style="color: #666;">${new Date(data.timestamp || Date.now()).toLocaleDateString()}</div>
            </div>
            <div class="tweet-content">${data.tweet_text}</div>
            <div class="tweet-stats">
                <span>👁 ${formatNumber(data.impressions || 0)}</span>
                <span>👥 ${formatNumber(data.followers || 0)} Followers</span>
                <span style="margin-left: auto; color: ${getVerdictColor(data.stance === 'supports' ? 'True' : data.stance === 'contradicts' ? 'False' : 'Unverified')}">${data.stance?.toUpperCase() || 'UNKNOWN'}</span>
            </div>
        </div>
    `;

    let html = '';

    // Always show original tweet first if it exists and isn't the selected node
    if (origin && node.id !== 'origin' && node.id !== origin.id) {
        html += renderCard(origin, 'ORIGINAL TWEET');
        html += '<div style="text-align: center; color: #333; margin: 10px 0;">↓</div>';
    }

    // Show selected node
    html += renderCard(node, 'SELECTED TWEET');

    // Add Explore More button for the selected node
    // Pass null for ID if it's a generated node (not a UUID) so backend generates new graph from claim
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node.id);
    const safeId = isUUID ? node.id : '';

    html += `
        <button class="dive-btn" id="explore-btn-${safeId || 'gen'}">
            EXPLORE MORE 
            <span style="float: right;">→</span>
        </button>
    `;

    detailsPanel.innerHTML = html;

    // Attach event listener safely
    setTimeout(() => {
        const btn = document.getElementById(`explore-btn-${safeId || 'gen'}`);
        if (btn) {
            btn.onclick = () => diveDeeper(safeId, node.tweet_text);
        }
    }, 0);
}


// Helper to format large numbers
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function drag(simulation) {
    function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
    }

    function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
    }

    function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
    }

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
}

