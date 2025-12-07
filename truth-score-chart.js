// Truth Score Chart Configuration
// This file contains the chart configuration for displaying truth scores

function createTruthScoreChart(canvasId, messages) {
    const ctx = document.getElementById(canvasId).getContext('2d');

    // Process messages data
    const speakers = {};

    messages.forEach((m, globalIndex) => {
        const speakerName = m.speaker_display_name || m.speaker_username || m.speaker || 'Unknown';

        if (!speakers[speakerName]) {
            speakers[speakerName] = {
                dataPoints: [],
                color: null
            };
        }

        if (m.truth_score !== null && m.truth_score !== undefined) {
            speakers[speakerName].dataPoints.push({
                x: m.sequence_number || globalIndex,
                y: m.truth_score
            });
        }
    });

    const validSpeakers = Object.keys(speakers).filter(
        speaker => speakers[speaker].dataPoints.length > 0
    );

    // Use darker, more visible colors
    const colorMap = {
        'Kamala Harris': '#007a4d',     // Darker green (was #00ba7c)
        'Donald Trump': '#cc1155',      // Darker red/pink (was #f91880)
        'default': ['#007a4d', '#cc1155', '#1573b8', '#cc9900', '#8833cc'] // Darker versions
    };

    const datasets = [];

    validSpeakers.forEach((speaker, idx) => {
        // Use specific color for known speakers, otherwise use default colors
        let color;
        if (colorMap[speaker]) {
            color = colorMap[speaker];
        } else {
            color = colorMap.default[idx % colorMap.default.length];
        }

        const speakerData = speakers[speaker].dataPoints;
        speakerData.sort((a, b) => a.x - b.x);

        datasets.push({
            label: speaker,
            data: speakerData,
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2.5,      // Slightly thicker lines
            pointRadius: 5,
            pointHoverRadius: 7,
            fill: false,
            tension: 0.2,
            showLine: true
        });
    });

    // Create the chart with improved configuration
    return new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#fff',
                        font: {
                            family: 'monospace',
                            size: 12,
                            weight: 'bold'
                        },
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: '#666',
                    borderWidth: 1,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y + '/10';
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'MESSAGE SEQUENCE',
                        color: '#999',
                        font: {
                            family: 'monospace',
                            size: 11
                        }
                    },
                    grid: {
                        color: '#333',
                        lineWidth: 0.5
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
                    max: 11,  // Set to 11 to give padding above 10
                    title: {
                        display: true,
                        text: 'TRUTH SCORE',
                        color: '#999',
                        font: {
                            family: 'monospace',
                            size: 11
                        }
                    },
                    grid: {
                        color: '#333',
                        lineWidth: 0.5
                    },
                    ticks: {
                        color: '#999',
                        stepSize: 1,
                        font: {
                            family: 'monospace',
                            size: 10
                        },
                        // Simple 0-10 format (no fractions)
                        callback: function(value) {
                            if (value <= 10 && value >= 0 && value % 1 === 0) {
                                return value;  // Just show the number, no "/10"
                            }
                            return '';  // Hide the 11 tick
                        },
                        max: 10  // Don't show tick for 11
                    }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            }
        }
    });
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = createTruthScoreChart;
}