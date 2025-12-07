// Veritas Analytics Dashboard
console.log('Analytics loaded');

// Initialize dashboard
async function loadData(spaceId) {
    try {
        console.log('Loading data for space:', spaceId);
        // Fetch data from API
        const response = await fetch(`http://localhost:3000/api/spaces/${spaceId}`);
        const data = await response.json();

        if (data.success) {
            renderChart(data.messages);
            renderTimeline(data.messages);
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

function renderChart(messages) {
    const container = document.getElementById('chart-container');
    container.innerHTML = '<p>Truth Score Chart</p>';
}

function renderTimeline(messages) {
    const container = document.getElementById('timeline-container');
    container.innerHTML = '<p>Debate Timeline</p>';
}

// Get space ID from URL
const params = new URLSearchParams(window.location.search);
const spaceId = params.get('spaceId');

if (spaceId) {
    loadData(spaceId);
}
