# Veritas Argument Mapping - Beta Testing

This is a standalone beta version of the argument mapping feature for Veritas. It allows you to analyze debate transcripts and visualize the argumentative structure between claims.

## Features

- **Transcript Analysis**: Upload or paste debate transcripts for analysis
- **Claim Extraction**: AI-powered extraction of claims, evidence, and reasoning
- **Relationship Detection**: Identifies support/attack relationships between claims
- **Interactive Visualization**: D3.js force-directed graph showing argument structure
- **Real-time Fallback**: Works with mock analysis if AI backend is unavailable

## Quick Start

### 1. Install Backend Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment (Optional)

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
# Optional: For AI-powered analysis (otherwise uses mock)
GROK_API_KEY=your_grok_api_key

# Optional: For future database integration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_key

PORT=3001
```

### 3. Start the Backend

```bash
cd backend
npm run dev
```

Backend will run on `http://localhost:3001`

### 4. Open the Frontend

Simply open `transcript-analyzer.html` in your browser. No additional server needed.

## Testing the System

### Method 1: Use Sample Transcripts

1. Open `transcript-analyzer.html` in your browser
2. Click one of the sample transcript links (Climate, Economy, or Tech)
3. Click "Analyze Arguments"
4. Explore the interactive graph visualization

### Method 2: Use Your Own Transcripts

Format your transcript like this:
```
Speaker A: Your first claim or statement here.
Speaker B: Response or counter-argument.
Speaker A: Additional supporting evidence or reasoning.
```

### Method 3: Test Backend Directly

You can test the API directly:

```bash
curl -X POST http://localhost:3001/api/analyze-transcript \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Speaker A: Climate change is real. Speaker B: That needs more evidence."}'
```

## Features Demo

### Graph Visualization
- **Nodes**: Colored by claim type (green=assertions, blue=evidence, yellow=reasoning)
- **Edges**: Green solid lines = support, Red dashed lines = attack
- **Interactive**: Drag nodes, hover for details, click for full text

### Analysis Methods
- **AI Mode**: Uses Grok API for sophisticated claim extraction and relationship detection
- **Mock Mode**: Simple pattern-based analysis for testing without API keys
- **Fallback**: Automatically switches to mock if backend is unavailable

### Statistics Panel
- **Claims Count**: Total extracted claims
- **Relationships Count**: Support/attack relationships found
- **Speakers Count**: Number of different speakers identified

## Architecture

```
argument-mapping-beta/
├── transcript-analyzer.html    # Frontend - open in browser
├── backend/
│   ├── index.js               # Express API server
│   ├── package.json           # Dependencies
│   └── .env.example           # Environment template
├── argument-mapping-schema.sql # Database schema (for future)
└── README.md                  # This file
```

## Integration Plan

This beta system is designed to be integrated with the main Veritas system:

1. **Phase 1** ✅: Standalone transcript testing (current)
2. **Phase 2**: Database integration using the provided schema
3. **Phase 3**: Real-time integration with caption processing
4. **Phase 4**: Overlay UI integration for live argument tracking

## API Endpoints

- `GET /api/health` - Health check
- `POST /api/analyze-transcript` - Analyze transcript and return claims/relationships
- `GET /api/samples` - Get sample transcripts for testing

## Troubleshooting

**Backend not responding?**
- Make sure you're in the `backend/` directory when running `npm install` and `npm run dev`
- Check that port 3001 is available
- Frontend will automatically fallback to mock analysis if backend is down

**No claims extracted?**
- Ensure transcript follows "Speaker A: content" format
- Try the sample transcripts first to verify the system is working
- Check browser console for detailed error messages

**Graph not rendering?**
- Make sure you have internet connection (loads D3.js from CDN)
- Try refreshing the page
- Check if transcript analysis completed successfully

## Next Steps

1. Test with various debate transcripts
2. Experiment with different argument structures
3. Evaluate claim extraction accuracy
4. Provide feedback on visualization usefulness
5. Identify integration requirements for main system

---

**Note**: This is a beta testing system separate from the main Veritas application. It's designed for experimentation and validation before integration.