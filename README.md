# Veritas - AI-Powered Debate Fact-Checker

Real-time fact-checking for political debates using Grok AI.

## Features

- **Chrome Extension**: Extract debate transcripts from web pages
- **AI-Powered Analysis**: Grok AI fact-checks claims with credible sources
- **Interactive Dashboard**: Visualize truth scores and analyze claims
- **Source Validation**: URLs are validated to ensure credibility
- **Timeline View**: Track conversation flow through debates

## Setup

### Backend

1. Install dependencies:
```bash
cd backend
npm install
```

2. Configure environment variables in `backend/.env`:
```
PORT=3000
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key
GROK_API_KEY=your_grok_api_key
GROK_API_URL=https://api.x.ai/v1
```

3. Run the server:
```bash
npm run dev
```

### Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the project directory

## Usage

1. Navigate to a debate transcript page
2. Click the Veritas extension icon
3. Click "Analyze Debate"
4. View results in the analytics dashboard

## Tech Stack

- **Backend**: Node.js, Express, Supabase
- **AI**: Grok API (xAI)
- **Frontend**: Vanilla JavaScript, Chart.js
- **Extension**: Chrome Extension Manifest V3
