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
    document.getElementById('space-title').textContent = (space.title || 'X SPACE').toUpperCase();

    // Calculate real-time overall score from messages (out of 100)
    let overallScore = space.overall_credibility_score;
    if (messages && messages.length > 0) {
        const messagesWithScores = messages.filter(m => m.truth_score !== null && m.truth_score !== undefined);
        if (messagesWithScores.length > 0) {
            const avgTruthScore = messagesWithScores.reduce((sum, m) => sum + m.truth_score, 0) / messagesWithScores.length;
            // Convert 1-10 scale to 0-100
            overallScore = Math.round(avgTruthScore * 10);
        }
    }

    // Display score out of 100
    document.getElementById('overall-score').textContent = `${overallScore}/100`;

    // Color code score (thresholds for 0-100 scale)
    const scoreEl = document.getElementById('overall-score');
    if (overallScore >= 70) scoreEl.style.color = 'var(--success-color)';
    else if (overallScore >= 40) scoreEl.style.color = 'var(--warning-color)';
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
                <div style="font-size: 16px;">NO TRUTH SCORES AVAILABLE</div>
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
window.openConsistencyModal = function () {
    const modal = document.getElementById('consistency-modal');
    if (modal) {
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }
}

window.closeConsistencyModal = function () {
    const modal = document.getElementById('consistency-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = ''; // Restore scrolling
    }
}

// Set up event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function () {
    // Close modal when clicking outside
    const modal = document.getElementById('consistency-modal');
    if (modal) {
        modal.addEventListener('click', function (event) {
            if (event.target === modal) {
                closeConsistencyModal();
            }
        });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeConsistencyModal();
        }
    });

    // Make sure X button works
    const closeButton = modal?.querySelector('.close-modal');
    if (closeButton) {
        closeButton.addEventListener('click', function (event) {
            event.preventDefault();
            closeConsistencyModal();
        });
    }
});

// Cache for consistency analysis per claim
window.consistencyCache = window.consistencyCache || new Map();

window.analyzeConsistency = async function (node) {
    const modal = document.getElementById('consistency-modal');
    const content = document.getElementById('consistency-content');

    // Open the modal
    openConsistencyModal();

    // Generate cache key
    const cacheKey = `${node.speaker}-${node.text?.substring(0, 50)}`;

    // Check cache first
    if (window.consistencyCache.has(cacheKey)) {
        const cachedData = window.consistencyCache.get(cacheKey);
        renderConsistencyResult(content, cachedData, node);
        return;
    }

    // Render function that takes explicit state - no closures
    const showStep = (xState, webState, analysisState, activeStatus) => {
        const speakerName = node.speaker || 'user';
        const steps = [
            { id: 'x', state: xState, label: `Searching ${speakerName}'s X history` },
            { id: 'web', state: webState, label: 'Searching web for past statements' },
            { id: 'analysis', state: analysisState, label: 'Analyzing consistency' }
        ];

        content.innerHTML = `
            <div style="padding: 30px;">
                <div style="color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 20px;">ANALYZING CONSISTENCY</div>
                ${steps.map(s => {
            // state: 'pending' | 'active' | 'done'
            const isDone = s.state === 'done';
            const isActive = s.state === 'active';
            const color = isDone ? '#00ba7c' : isActive ? '#f91880' : '#444';
            const opacity = isDone || isActive ? 1 : 0.4;

            let icon;
            if (isDone) {
                icon = '✓';
            } else if (isActive) {
                icon = `<div style="width: 16px; height: 16px; border: 2px solid #333; border-top-color: #f91880; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>`;
            } else {
                icon = '○';
            }

            return `
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; opacity: ${opacity};">
                            <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; color: ${color}; font-size: 14px;">
                                ${icon}
                            </div>
                            <div style="flex: 1;">
                                <div style="color: ${isActive ? '#e7e9ea' : isDone ? '#00ba7c' : '#666'}; font-size: 12px;">${s.label}</div>
                                ${isActive && activeStatus ? `<div style="color: #666; font-size: 10px; margin-top: 2px;">${activeStatus}</div>` : ''}
                            </div>
                        </div>
                    `;
        }).join('')}
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </div>
        `;
    };

    // Simple wait helper
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ===== STEP 1: X HISTORY =====
    showStep('active', 'pending', 'pending', 'Fetching recent posts...');

    try {
        // Start the API call but don't await yet
        const fetchPromise = fetch('http://localhost:3000/api/debate/consistency', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                speaker: node.speaker,
                claim: node.text
            })
        }).then(response => response.json());

        // Show X step as active for a brief moment
        await delay(1500);

        // X done - show checkmark
        showStep('done', 'pending', 'pending', null);
        await delay(400);

        // ===== STEP 2: WEB SEARCH =====
        // Now wait for the actual API response during this step
        showStep('done', 'active', 'pending', 'Searching web sources...');

        // Actually wait for the API response here - this is where the real work happens
        const data = await fetchPromise;

        // Web done - show checkmark
        showStep('done', 'done', 'pending', null);
        await delay(400);

        // ===== STEP 3: ANALYSIS =====
        showStep('done', 'done', 'active', 'Comparing statements...');
        await delay(600);
        showStep('done', 'done', 'active', 'Finalizing...');
        await delay(400);

        if (data.success) {
            // Cache the result
            window.consistencyCache.set(cacheKey, data);
            renderConsistencyResult(content, data, node);
        } else {
            content.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <div style="color: #8b0000; font-size: 16px; margin-bottom: 10px;">Analysis Failed</div>
                    <div style="color: #666; font-size: 14px;">${data.error || 'Unable to analyze consistency at this time'}</div>
                </div>
            `;
        }
    } catch (e) {
        content.innerHTML = `<div style="color: #f91880; padding: 40px; text-align: center;">Error: ${e.message}</div>`;
    }
}

// Helper to render consistency analysis result
function renderConsistencyResult(content, data, node) {
    // Get score color helper
    const getScoreColorByValue = (score) => {
        if (score === null || score === undefined || score < 0) return '#71767b';
        if (score >= 7) return '#00ba7c';
        if (score >= 4) return '#fbbf24';
        return '#f91880';
    };

    const mainScore = data.score;
    const xScore = data.x_score ?? null;
    const webScore = data.web_score ?? null;
    const mainColor = getScoreColorByValue(mainScore);
    const xColor = getScoreColorByValue(xScore);
    const webColor = getScoreColorByValue(webScore);

    // Check if we have insufficient data
    const isInsufficientData = data.verdict === 'Insufficient Data' || data.topic_match === false;

    // Don't truncate analysis - show full text
    let analysis = data.analysis || 'No analysis available';

    // Get stance color for past statements
    const getStanceColor = (stance) => {
        switch (stance?.toLowerCase()) {
            case 'supports': case 'consistent': return '#00ba7c';
            case 'contradicts': case 'inconsistent': return '#f91880';
            default: return '#71767b';
        }
    };

    content.innerHTML = `
        <div style="display: flex; gap: 20px; height: 100%; overflow: hidden;">
            <div style="flex: 0 0 180px;">
                <!-- Main Score -->
                <div style="border: 1px solid #333; padding: 20px; text-align: center; margin-bottom: 12px;">
                    <div style="color: #666; font-size: 9px; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.1em;">OVERALL CONSISTENCY</div>
                    <div style="font-size: 36px; color: ${mainColor}; font-weight: 500; margin-bottom: 6px; font-family: 'SF Mono', Monaco, monospace;">
                        ${isInsufficientData ? '—' : `${mainScore}/10`}
                    </div>
                    <div style="font-size: 10px; color: ${isInsufficientData ? '#71767b' : '#e7e9ea'}; text-transform: uppercase; letter-spacing: 0.05em;">
                        ${data.verdict || 'Unknown'}
                    </div>
                    ${data.confidence ? `<div style="font-size: 9px; color: #666; margin-top: 8px;">${data.confidence.toUpperCase()} CONFIDENCE</div>` : ''}
                </div>
                
                <!-- Sub-scores -->
                <div style="display: flex; gap: 8px;">
                    <div style="flex: 1; border: 1px solid #333; padding: 12px; text-align: center;">
                        <div style="color: #666; font-size: 8px; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.05em;">𝕏 HISTORY</div>
                        <div style="font-size: 18px; color: ${xColor}; font-weight: 500; font-family: 'SF Mono', Monaco, monospace;">
                            ${xScore !== null ? `${xScore}/10` : '—'}
                        </div>
                        <div style="font-size: 8px; color: #555; margin-top: 4px;">${data.x_posts_found || 0} posts</div>
                    </div>
                    <div style="flex: 1; border: 1px solid #333; padding: 12px; text-align: center;">
                        <div style="color: #666; font-size: 8px; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.05em;">WEB</div>
                        <div style="font-size: 18px; color: ${webColor}; font-weight: 500; font-family: 'SF Mono', Monaco, monospace;">
                            ${webScore !== null ? `${webScore}/10` : '—'}
                        </div>
                        <div style="font-size: 8px; color: #555; margin-top: 4px;">${data.web_sources_found || 0} sources</div>
                    </div>
                </div>
            </div>
            <div style="flex: 1; overflow-y: auto; min-width: 0;">
                <div style="margin-bottom: 16px;">
                    <div style="color: #666; font-size: 9px; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.1em;">ANALYSIS</div>
                    <div style="line-height: 1.5; color: #e7e9ea; font-size: 12px;">${analysis}</div>
                </div>
                
                ${data.past_tweets && data.past_tweets.length > 0 ? `
                <div>
                    <div style="color: #666; font-size: 9px; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.1em;">PAST STATEMENTS (${data.past_tweets.length})</div>
                    <div style="max-height: 220px; overflow-y: auto;">
                        ${data.past_tweets.map(t => {
        const stanceColor = getStanceColor(t.stance);
        const hasUrl = t.url && t.url.startsWith('https://');
        const sourceLabel = t.source === 'X' ? '𝕏' : t.source === 'Web' ? '🌐' : '';
        return `
                            <${hasUrl ? `a href="${t.url}" target="_blank" style="text-decoration: none; display: block;"` : 'div'}>
                                <div style="padding: 10px; margin-bottom: 6px; border-left: 2px solid ${stanceColor}; background: ${stanceColor}10; cursor: ${hasUrl ? 'pointer' : 'default'}; transition: background 0.2s;"
                                     ${hasUrl ? 'onmouseenter="this.style.background=\'' + stanceColor + '20\'" onmouseleave="this.style.background=\'' + stanceColor + '10\'"' : ''}>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                        <span style="font-size: 9px; color: #666; text-transform: uppercase;">${sourceLabel} ${t.date || 'Unknown date'}</span>
                                        ${hasUrl ? '<span style="font-size: 9px; color: #1d9bf0;">VIEW →</span>' : ''}
                                    </div>
                                    <div style="color: #e7e9ea; font-size: 11px; line-height: 1.4;">"${(t.text || '').substring(0, 150)}${(t.text || '').length > 150 ? '...' : ''}"</div>
                                    ${t.stance ? `<div style="font-size: 9px; color: ${stanceColor}; margin-top: 4px; text-transform: uppercase;">${t.stance}</div>` : ''}
                                </div>
                            </${hasUrl ? 'a' : 'div'}>
                            `;
    }).join('')}
                    </div>
                </div>
                ` : `<div style="color: #666; font-size: 11px; padding: 20px; text-align: center; border: 1px dashed #333;">
                    <div style="margin-bottom: 8px;">⚠️</div>
                    No relevant past statements found for this specific claim.
                </div>`}
            </div>
        </div>
    `;
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

// Helper function to get stance color (global version for consistency modal)
function getStanceColor(stance) {
    switch (stance?.toLowerCase()) {
        case 'supports': case 'consistent': case 'confirming': return '#00ba7c';
        case 'contradicts': case 'inconsistent': case 'contradicting': return '#f91880';
        default: return '#555';
    }
}

// Helper function to get score color (for claims)
function getScoreColor(score) {
    if (score === null || score === undefined) return '#333333';
    if (score <= 4) return '#8b0000';       // Dark red for low scores
    else if (score <= 7) return '#fbbf24';  // Yellow for medium scores
    else return '#00ba7c';                  // Green for high scores
}

// Cache for claim graphs - keyed by claim text (per-claim caching)
window.claimGraphCache = window.claimGraphCache || new Map();

// Helper to normalize graph data for caching
// Converts link source/target from object references back to IDs and removes simulation positions
function normalizeGraphForCache(graphData) {
    return {
        claim_summary: graphData.claim_summary,
        topic: graphData.topic,
        statistics: { ...graphData.statistics },
        nodes: graphData.nodes.map(node => ({
            id: node.id,
            username: node.username,
            display_name: node.display_name,
            impressions: node.impressions,
            followers: node.followers,
            verified: node.verified,
            tweet_text: node.tweet_text,
            tweet_url: node.tweet_url,
            stance: node.stance,
            type: node.type,
            timestamp: node.timestamp,
            clusterIdx: node.clusterIdx
            // Explicitly NOT including x, y, vx, vy, fx, fy (simulation positions)
        })),
        links: graphData.links.map(link => ({
            // Convert object references back to string IDs
            source: typeof link.source === 'object' ? link.source.id : link.source,
            target: typeof link.target === 'object' ? link.target.id : link.target,
            type: link.type
        }))
    };
}

window.diveDeeper = async function (messageId, claimText, forceExpand = false) {
    const modal = document.getElementById('propagation-modal');
    modal.style.display = 'block';

    const container = document.getElementById('propagation-graph');
    const detailsPanel = document.getElementById('propagation-details');

    // Generate cache key from claim text - this ensures each claim has its own cache
    const cacheKey = claimText?.substring(0, 100) || messageId || 'default';

    // Check if we're expanding the SAME claim or loading a different one
    const isSameClaim = window.currentClaimKey === cacheKey;
    const isExpanding = forceExpand && isSameClaim;

    // If NOT expanding and we have a cached version, use it (includes previously expanded graphs)
    if (!forceExpand && window.claimGraphCache.has(cacheKey)) {
        console.log('Using cached graph for claim:', cacheKey.substring(0, 50));
        const cachedGraph = window.claimGraphCache.get(cacheKey);
        // Deep copy to prevent mutations
        window.currentGraphData = JSON.parse(JSON.stringify(cachedGraph));
        window.currentClaimKey = cacheKey;
        renderPropagationGraph(window.currentGraphData);
        return;
    }

    // If expanding the same claim, we continue to fetch more data
    if (isExpanding) {
        console.log('Expanding graph for claim:', cacheKey.substring(0, 50));
    }

    // If not expanding, show initial loading
    if (!isExpanding) {
        container.innerHTML = `
            <div style="color: #fff; text-align: center; padding: 50px; font-family: 'SF Mono', Monaco, monospace;">
                <div style="display: inline-block; width: 24px; height: 24px; border: 2px solid #333; border-top-color: #fff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                <br><br>
                <span style="font-size: 11px; letter-spacing: 0.1em;">SEARCHING X...</span>
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        `;
        // Reset and HIDE details panel completely
        detailsPanel.innerHTML = '<div class="details-placeholder">SELECT A NODE TO VIEW DETAILS</div>';
        detailsPanel.classList.remove('visible');
        detailsPanel.style.display = 'none';
    }
    // Expanding shows loading indicator via the button handler

    try {
        const response = await fetch('http://localhost:3000/api/analytics/dive-deeper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messageId: messageId,
                claim: claimText,
                skipCache: forceExpand,
                nodeCount: isExpanding ? (window.currentGraphData?.nodes?.length || 60) + 30 : 60
            })
        });

        const data = await response.json();
        const graphData = data.propagationGraph || data.graph;

        if (data.success && graphData) {
            if (isExpanding && window.currentGraphData) {
                // EXPAND MODE: Merge new nodes into existing graph for THIS CLAIM
                const existingNodes = new Set(window.currentGraphData.nodes.map(n => n.id));
                const existingLinks = new Set(window.currentGraphData.links.map(l => `${l.source.id || l.source}-${l.target.id || l.target}`));

                let newNodesCount = 0;

                graphData.nodes.forEach(node => {
                    if (!existingNodes.has(node.id)) {
                        window.currentGraphData.nodes.push(node);
                        existingNodes.add(node.id);
                        newNodesCount++;
                    }
                });

                graphData.links.forEach(link => {
                    const linkId = `${link.source}-${link.target}`;
                    if (!existingLinks.has(linkId)) {
                        window.currentGraphData.links.push(link);
                        existingLinks.add(linkId);
                    }
                });

                // Recalculate statistics
                window.currentGraphData.statistics = {
                    total_impressions: window.currentGraphData.nodes.reduce((s, n) => s + (n.impressions || 0), 0),
                    supporters: window.currentGraphData.nodes.filter(n => n.stance === 'supports').length,
                    contradictors: window.currentGraphData.nodes.filter(n => n.stance === 'contradicts').length,
                    neutral: window.currentGraphData.nodes.filter(n => !n.stance || n.stance === 'neutral').length
                };

                console.log(`Expanded graph: added ${newNodesCount} new nodes (total: ${window.currentGraphData.nodes.length})`);

                // Update cache with normalized graph (links as IDs, no positions)
                window.claimGraphCache.set(cacheKey, normalizeGraphForCache(window.currentGraphData));

                renderPropagationGraph(window.currentGraphData);

            } else {
                // NEW CLAIM: Fresh render and cache
                window.currentGraphData = graphData;
                window.currentClaimKey = cacheKey;
                window.claimGraphCache.set(cacheKey, normalizeGraphForCache(graphData));
                renderPropagationGraph(graphData);
            }
        } else {
            container.innerHTML = `
                <div style="color: #f91880; text-align: center; padding: 50px; font-family: 'SF Mono', Monaco, monospace;">
                    <span style="font-size: 11px; letter-spacing: 0.1em;">FAILED TO LOAD GRAPH</span>
                    <br><span style="color: #666; font-size: 10px; margin-top: 10px; display: block;">${data.error || 'Unknown error'}</span>
                </div>
            `;
        }
    } catch (error) {
        console.error('Dive deeper error:', error);
        container.innerHTML = `
            <div style="color: #f91880; text-align: center; padding: 50px; font-family: 'SF Mono', Monaco, monospace;">
                <span style="font-size: 11px; letter-spacing: 0.1em;">NETWORK ERROR</span>
                <br><span style="color: #666; font-size: 10px; margin-top: 10px; display: block;">${error.message}</span>
            </div>
        `;
    }
}

function renderPropagationGraph(graphData) {
    const container = document.getElementById('propagation-graph');
    const detailsPanel = document.getElementById('propagation-details');

    // Clear previous content
    container.innerHTML = '';

    // Hide details panel by default
    detailsPanel.innerHTML = '';
    detailsPanel.classList.remove('visible');

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    // Intelligently truncate claim
    let claimText = graphData.claim_summary || 'Unknown claim';
    if (claimText.length > 150) {
        const sentEnd = claimText.substring(0, 150).lastIndexOf('.');
        if (sentEnd > 50) {
            claimText = claimText.substring(0, sentEnd + 1);
        } else {
            const wordEnd = claimText.substring(0, 150).lastIndexOf(' ');
            claimText = claimText.substring(0, wordEnd) + '...';
        }
    }

    // Create header with claim summary and stats
    const header = document.createElement('div');
    header.style.cssText = 'padding: 12px 15px; border-bottom: 1px solid #333; font-size: 11px; position: absolute; top: 0; left: 0; width: 100%; background: rgba(0,0,0,0.95); z-index: 10; box-sizing: border-box;';
    header.innerHTML = `
        <div style="display: flex; gap: 10px; margin-bottom: 8px; align-items: center;">
            <div style="color: #999; text-transform: uppercase; letter-spacing: 0.1em; font-size: 10px;">X INTERACTIONS</div>
            ${graphData.topic ? `<span style="background: #333; color: #ffd700; padding: 3px 10px; border-radius: 12px; font-size: 9px; font-weight: 600;">${graphData.topic}</span>` : ''}
        </div>
        <div style="color: #e7e9ea; margin-bottom: 8px; line-height: 1.4; font-size: 12px;" title="${(graphData.claim_summary || '').replace(/"/g, '&quot;')}">"${claimText}"</div>
        <div style="display: flex; gap: 15px; font-size: 10px; flex-wrap: wrap;">
            <span style="color: #00ba7c;">● ${graphData.statistics?.supporters || 0} SUPPORTS CLAIM</span>
            <span style="color: #f91880;">● ${graphData.statistics?.contradictors || 0} CONTRADICTS CLAIM</span>
            <span style="color: #71767b;">● ${Math.max(0, (graphData.nodes?.length || 0) - (graphData.statistics?.supporters || 0) - (graphData.statistics?.contradictors || 0))} NEUTRAL</span>
            <span style="color: #ffd700; margin-left: auto;">${formatNumber(graphData.statistics?.total_impressions || 0)} IMPRESSIONS</span>
        </div>
    `;
    container.appendChild(header);

    // Create SVG container
    const svgContainer = document.createElement('div');
    svgContainer.style.cssText = `width: 100%; height: 100%; padding-top: 85px; box-sizing: border-box;`;
    container.appendChild(svgContainer);

    const svg = d3.select(svgContainer)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .style('cursor', 'grab');

    // Add zoom behavior
    const g = svg.append('g');
    const zoom = d3.zoom()
        .scaleExtent([0.3, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
    svg.call(zoom);

    // Function to hide the details panel
    function hideDetailsPanel() {
        g.selectAll('circle').attr('stroke', '#444').attr('stroke-width', 1);
        detailsPanel.classList.remove('visible');
        // Delay hiding to allow animation
        setTimeout(() => {
            if (!detailsPanel.classList.contains('visible')) {
                detailsPanel.style.display = 'none';
            }
        }, 250);
    }

    // Handle clicks on empty space (background) to deselect and hide panel
    svg.on('click', (event) => {
        // Only trigger if clicking directly on SVG or background rect
        if (event.target === svg.node() || event.target.tagName === 'rect') {
            hideDetailsPanel();
        }
    });

    // Also add a background rect for better click detection (rendered first, behind nodes)
    g.append('rect')
        .attr('width', width * 3)
        .attr('height', height * 3)
        .attr('x', -width)
        .attr('y', -height)
        .attr('fill', 'transparent')
        .attr('pointer-events', 'all')
        .lower() // Send to back
        .on('click', () => hideDetailsPanel());

    // Prepare nodes - NO ORIGIN NODE, just clusters
    let nodes = graphData.nodes || [];

    // Remove any "original" stance nodes
    nodes = nodes.filter(n => n.stance !== 'original' && n.id !== 'origin');

    if (nodes.length === 0) {
        nodes = graphData.nodes || [];
    }

    // Calculate node sizes based on impressions
    const maxImpressions = Math.max(...nodes.map(n => n.impressions || 1), 1);
    const minSize = 10;
    const maxSize = 50;

    nodes.forEach(node => {
        const impressions = node.impressions || 1;
        const normalized = impressions / maxImpressions;
        const powerScale = Math.pow(normalized, 0.5);
        node.radius = minSize + (maxSize - minSize) * powerScale;
    });

    // Color based on stance (regarding the claim)
    function getStanceColor(stance) {
        switch (stance?.toLowerCase()) {
            case 'supports': return '#00ba7c';
            case 'contradicts': return '#f91880';
            default: return '#555';
        }
    }

    // USE BACKEND-PROVIDED LINKS (real reply/quote/retweet relationships)
    let links = graphData.links || [];

    // Sort by impressions for visual grouping
    const sortedByImpact = [...nodes].sort((a, b) => (b.impressions || 0) - (a.impressions || 0));

    // Assign visual cluster by stance (for layout only, NOT for links)
    nodes.forEach((node, i) => {
        if (node.clusterIdx === undefined) {
            if (node.stance === 'supports') node.clusterIdx = 0;
            else if (node.stance === 'contradicts') node.clusterIdx = 1;
            else node.clusterIdx = 2;
        }
        // Mark top nodes as hubs for visual emphasis
        if (sortedByImpact.indexOf(node) < 5) node.isHub = true;
    });

    // Create cluster centers for visual layout
    const numClusters = 3;
    const clusterCenters = [
        { x: width * 0.3, y: height * 0.4 },  // Supports - left
        { x: width * 0.7, y: height * 0.4 },  // Contradicts - right
        { x: width * 0.5, y: height * 0.7 }   // Neutral - bottom center
    ];

    // Force simulation - spread out nodes to show connection types clearly
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id)
            .distance(d => {
                // Longer distances to show connection types
                if (d.type === 'reply' || d.type === 'quote' || d.type === 'retweet') return 100;
                if (d.type === 'related') return 140;
                return 180;
            })
            .strength(d => {
                // Moderate strength to maintain structure but allow spacing
                if (d.type === 'reply' || d.type === 'quote' || d.type === 'retweet') return 0.5;
                if (d.type === 'related') return 0.25;
                return 0.15;
            }))
        .force('charge', d3.forceManyBody().strength(-200))  // Stronger repulsion
        .force('collision', d3.forceCollide().radius(d => d.radius + 25))  // More collision space
        .force('x', d3.forceX(d => clusterCenters[d.clusterIdx]?.x || width / 2).strength(0.04))
        .force('y', d3.forceY(d => clusterCenters[d.clusterIdx]?.y || height / 2).strength(0.04))
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.005));

    // Draw all links with visual distinction by type
    const link = g.append('g')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke', d => d.type === 'related' ? '#555' : '#888')
        .attr('stroke-opacity', d => d.type === 'related' ? 0.5 : 0.7)
        .attr('stroke-width', d => d.type === 'related' ? 1.5 : 2)
        .attr('stroke-dasharray', d => {
            if (d.type === 'reply') return '8,4';
            if (d.type === 'quote') return '3,3';
            if (d.type === 'related') return '4,4';
            return null; // Solid for retweet
        });

    // Create node groups
    const node = g.append('g')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .style('cursor', 'pointer')
        .call(drag(simulation))
        .on('click', (event, d) => {
            event.stopPropagation();
            g.selectAll('circle').attr('stroke', '#444').attr('stroke-width', 1);
            d3.select(event.currentTarget).select('circle').attr('stroke', '#fff').attr('stroke-width', 3);
            updateDetailsPanel(d);
            detailsPanel.style.display = 'block';
            detailsPanel.classList.add('visible');
        });

    // Draw circles - hubs get extra emphasis
    node.append('circle')
        .attr('r', d => d.radius)
        .attr('fill', d => getStanceColor(d.stance))
        .attr('stroke', d => d.isHub ? '#fff' : '#444')
        .attr('stroke-width', d => d.isHub ? 2 : 1)
        .attr('opacity', 0.9)
        .style('filter', d => d.isHub ? `drop-shadow(0 0 10px ${getStanceColor(d.stance)}80)` : 'none');

    // Add verified badge for high-profile accounts
    node.filter(d => d.verified)
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', 4)
        .attr('font-size', d => Math.max(8, d.radius * 0.5))
        .attr('fill', '#fff')
        .text('✓');

    // Add username labels for larger nodes
    node.filter(d => d.radius > 25)
        .append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', d => d.radius + 14)
        .attr('fill', '#888')
        .attr('font-size', '9px')
        .attr('pointer-events', 'none')
        .text(d => d.username?.replace('@', '').slice(0, 12) || '');

    // Add tooltip
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

    // Add legend at the bottom
    const legend = document.createElement('div');
    legend.style.cssText = 'padding: 8px 15px; border-top: 1px solid #333; font-size: 9px; color: #888; display: flex; gap: 20px; align-items: center; flex-wrap: wrap; position: absolute; bottom: 0; width: 100%; background: rgba(0,0,0,0.95); box-sizing: border-box; font-family: "SF Mono", Monaco, monospace;';
    legend.innerHTML = `
        <div style="display: flex; gap: 12px; align-items: center;">
            <span><span style="color: #00ba7c;">●</span> SUPPORTS</span>
            <span><span style="color: #f91880;">●</span> CONTRADICTS</span>
            <span><span style="color: #555;">●</span> NEUTRAL</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; margin-left: 12px; padding-left: 12px; border-left: 1px solid #333;">
            <span style="display: flex; align-items: center; gap: 3px;">
                <span style="width: 12px; height: 2px; background: #777;"></span>
                <span>RT</span>
            </span>
            <span style="display: flex; align-items: center; gap: 3px;">
                <span style="width: 12px; border-top: 2px dashed #777;"></span>
                <span>REPLY</span>
            </span>
            <span style="display: flex; align-items: center; gap: 3px;">
                <span style="width: 12px; border-top: 2px dotted #777;"></span>
                <span>QUOTE</span>
            </span>
            <span style="display: flex; align-items: center; gap: 3px; opacity: 0.6;">
                <span style="width: 12px; border-top: 1px dashed #555;"></span>
                <span>RELATED</span>
            </span>
        </div>
        <button id="expand-graph-btn" class="expand-btn" style="margin-left: auto;">+ EXPAND GRAPH</button>
    `;
    container.appendChild(legend);

    // Store current graph data for expand functionality
    // Use claim-specific key for caching
    const claimKey = graphData.claim_summary?.substring(0, 100) || 'default';
    window.currentPropagationData = graphData;
    window.currentGraphData = graphData;
    window.currentClaimKey = claimKey;

    // Add expand button click handler
    const expandBtn = legend.querySelector('#expand-graph-btn');
    expandBtn?.addEventListener('click', async () => {
        expandBtn.disabled = true;
        expandBtn.textContent = 'LOADING...';

        // Show centered loading indicator with spinner
        const loadingIndicator = document.createElement('div');
        loadingIndicator.id = 'expand-loading';
        loadingIndicator.style.cssText = `
            position: absolute; top: 100px; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.95); border: 1px solid #333; color: #fff; 
            padding: 15px 28px; font-size: 10px; z-index: 100;
            font-family: "SF Mono", Monaco, monospace; letter-spacing: 0.1em;
            display: flex; align-items: center; gap: 12px;
        `;
        loadingIndicator.innerHTML = `
            <div style="width: 16px; height: 16px; border: 2px solid #333; border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
            <span>EXPANDING GRAPH...</span>
        `;
        container.appendChild(loadingIndicator);

        // Add spin animation if not exists
        if (!document.getElementById('spin-style')) {
            const style = document.createElement('style');
            style.id = 'spin-style';
            style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
            document.head.appendChild(style);
        }

        try {
            await diveDeeper(null, window.currentPropagationData?.claim_summary, true);
        } catch (e) {
            console.error('Expand graph error:', e);
        } finally {
            expandBtn.disabled = false;
            expandBtn.textContent = '+ EXPAND GRAPH';
            const loader = document.getElementById('expand-loading');
            if (loader) loader.remove();
        }
    });
}

function updateDetailsPanel(node) {
    const detailsPanel = document.getElementById('propagation-details');

    // Use global getStanceColor function
    const getNodeStanceColor = getStanceColor;

    // Get stance label
    function getStanceLabel(stance) {
        switch (stance?.toLowerCase()) {
            case 'supports': return 'SUPPORTS CLAIM';
            case 'contradicts': return 'CONTRADICTS CLAIM';
            default: return 'NEUTRAL';
        }
    }

    detailsPanel.innerHTML = `
        <div style="padding: 15px;">
            <div style="color: #999; font-size: 9px; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.1em;">POST DETAILS</div>
            <div class="post-card" style="border-left: 3px solid ${getNodeStanceColor(node.stance)}; margin: 0;">
                <div class="post-header">
                    <div>
                        <span class="post-author">${node.display_name || node.username}</span>
                        <span class="post-handle">${node.username}</span>
                        ${node.verified ? '<span style="color: #1d9bf0;">✓</span>' : ''}
                    </div>
                    <div style="color: #666; font-size: 10px;">${new Date(node.timestamp || Date.now()).toLocaleDateString()}</div>
                </div>
                <div class="post-content" style="font-size: 12px; line-height: 1.5;">${node.tweet_text || 'No content available'}</div>
                <div class="post-stats" style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #333;">
                    <span>👁 ${formatNumber(node.impressions || 0)}</span>
                    <span>👥 ${formatNumber(node.followers || 0)}</span>
                </div>
                <div style="margin-top: 10px; padding: 6px 10px; background: ${getNodeStanceColor(node.stance)}20; border-left: 2px solid ${getNodeStanceColor(node.stance)};">
                    <span style="color: ${getNodeStanceColor(node.stance)}; font-size: 10px; font-weight: 600; letter-spacing: 0.05em;">${getStanceLabel(node.stance)}</span>
                </div>
                ${node.tweet_url || node.post_url ? `
                <a href="${node.tweet_url || node.post_url}" target="_blank" style="display: block; text-align: center; padding: 10px; margin-top: 12px; background: transparent; border: 1px solid #333; color: #e7e9ea; text-decoration: none; font-size: 10px; font-weight: 500; letter-spacing: 0.05em; transition: all 0.2s;">
                    VIEW ON X →
                </a>
                ` : ''}
            </div>
        </div>
    `;
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

