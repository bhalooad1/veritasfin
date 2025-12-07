
const API_URL = 'http://localhost:3000/api';

async function generateTestData() {
    console.log('🚀 Generating multi-topic test data...');

    try {
        // 1. Create Space
        console.log('Creating space...');
        const spaceRes = await fetch(`${API_URL}/debate/create-debate-space`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Multi-Topic Test Debate',
                description: 'Testing multi-lane timeline visualization',
                participants: [{ name: 'Candidate A' }, { name: 'Candidate B' }]
            })
        });
        const spaceData = await spaceRes.json();
        const spaceId = spaceData.space_id;
        console.log(`✓ Space created: ${spaceId}`);

        // 2. Generate Messages for 3 Topics
        const topics = [
            { name: 'Economy', messages: 5 },
            { name: 'Foreign Policy', messages: 5 },
            { name: 'Healthcare', messages: 5 }
        ];

        const messages = [];
        let seq = 1;

        // Interleave messages to show lanes clearly
        for (let i = 0; i < 5; i++) {
            for (let t = 0; t < topics.length; t++) {
                messages.push({
                    speaker: i % 2 === 0 ? 'Candidate A' : 'Candidate B',
                    content: `[${topics[t].name}] Statement ${i + 1} about ${topics[t].name}. This is a test message to verify the timeline visualization.`,
                    sequence_number: seq++
                });
            }
        }

        // 3. Analyze Transcript (Simulated)
        console.log(`Sending ${messages.length} messages...`);
        const transcript = messages.map(m => `${m.speaker}: ${m.content}`).join('\n\n');

        const analyzeRes = await fetch(`${API_URL}/debate/analyze-transcript`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: transcript,
                space_id: spaceId,
                auto_fact_check: true
            })
        });

        const analyzeData = await analyzeRes.json();
        console.log('✓ Analysis complete!');
        console.log(`\nTest URL: chrome-extension://mnkgoaeagoghljiljmcabdmdplbmnfgc/analytics.html?spaceId=${spaceId}`);
        console.log('(Replace extension ID with yours if different)');

    } catch (error) {
        console.error('Error:', error);
    }
}

generateTestData();
