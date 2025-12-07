import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3001;
const API_URL = `http://localhost:${PORT}/api`;
const ENV_PATH = path.join(process.cwd(), '.env');
const ENV_BAK_PATH = path.join(process.cwd(), '.env.bak');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
    for (let i = 0; i < 20; i++) {
        try {
            const res = await fetch(`${API_URL}/health`);
            if (res.ok) return true;
        } catch (e) {
            // ignore
        }
        await sleep(500);
    }
    return false;
}

async function runTest() {
    console.log('🧪 Starting Resilience Verification...');

    // Backup .env if it exists
    let envMoved = false;
    if (fs.existsSync(ENV_PATH)) {
        console.log('📦 Moving .env to .env.bak for testing...');
        fs.renameSync(ENV_PATH, ENV_BAK_PATH);
        envMoved = true;
    }

    let server;

    try {
        // 1. Start Server
        console.log('Step 1: Starting Backend...');
        server = spawn('node', ['index.js'], {
            cwd: process.cwd(),
            stdio: 'inherit',
            env: { ...process.env, PORT: PORT.toString(), GROK_API_KEY: '' } // Explicitly clear key
        });

        if (!await waitForServer()) {
            throw new Error('Server failed to start');
        }
        console.log('✓ Server started');

        // 2. Create Session
        console.log('Step 2: Creating Session...');
        const sessionId = 'test_session_' + Date.now();
        const createRes = await fetch(`${API_URL}/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });

        if (!createRes.ok) {
            throw new Error('Failed to create session');
        }
        console.log(`✓ Session created: ${sessionId}`);

        // 3. Test Persistence (Restart Server)
        console.log('Step 3: Restarting Server (Testing Persistence)...');
        server.kill();
        await sleep(2000);

        server = spawn('node', ['index.js'], {
            cwd: process.cwd(),
            stdio: 'inherit',
            env: { ...process.env, PORT: PORT.toString(), GROK_API_KEY: '' }
        });

        if (!await waitForServer()) {
            throw new Error('Server failed to restart');
        }

        // 4. Verify Session Exists
        console.log('Step 4: Verifying Session Persistence...');
        const verifyRes = await fetch(`${API_URL}/graph-state/${sessionId}`);
        const verifyData = await verifyRes.json();

        if (verifyData.sessionId === sessionId) {
            console.log('✓ Persistence Confirmed: Session found after restart');
        } else {
            throw new Error('Persistence Failed: Session not found');
        }

        // 5. Test Graceful Failure (No API Key)
        console.log('Step 5: Testing Graceful Failure (No API Key)...');
        const processRes = await fetch(`${API_URL}/process-statement`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                speaker: 'Speaker A',
                statement: 'This is a test statement.'
            })
        });

        if (processRes.status === 503) {
            console.log('✓ Graceful Failure Confirmed: Received 503 Service Unavailable as expected');
        } else {
            throw new Error(`Unexpected status code: ${processRes.status}`);
        }

        console.log('✨ Verification Complete: All tests passed!');

    } catch (error) {
        console.error('❌ Test Failed:', error.message);
        process.exitCode = 1;
    } finally {
        if (server) server.kill();

        // Restore .env
        if (envMoved && fs.existsSync(ENV_BAK_PATH)) {
            console.log('📦 Restoring .env...');
            fs.renameSync(ENV_BAK_PATH, ENV_PATH);
        }
    }
}

runTest();
