# Veritas - AI-Powered Debate Fact-Checker

Real-time fact-checking for political debates using Grok AI, optimized for the **Grokipedia Track** at xAI Hackathon.

## Core Features

- **Chrome Extension**: Extract debate transcripts from web pages
- **AI-Powered Analysis**: Grok AI fact-checks claims with credible sources
- **Interactive Dashboard**: Visualize truth scores and analyze claims
- **Source Validation**: URLs are validated to ensure credibility
- **Timeline View**: Track conversation flow through debates

## Grokipedia Track Features

### 🎯 Bias Detection & Mitigation
- **Automated Bias Auditor**: Scans statements for ideological skew
- **Neutrality Scoring**: 0-100 scale for objectivity measurement
- **Bias Indicators**: Identifies loaded language, cherry-picking, framing
- **Neutral Rewrites**: AI-generated unbiased versions of claims
- **Diverse Perspectives**: Suggests counter-arguments and alternative framings

### 📚 Grokipedia Article Generation
- **Automated Article Synthesis**: Converts fact-checked debates into Grokipedia format
- **Citation Management**: Properly formatted inline citations [[ref:N]]
- **Topic Organization**: Groups claims by theme with proper sections
- **Accuracy Filtering**: Only includes verified claims (TRUE/MOSTLY TRUE)
- **Wikipedia-Style Format**: Summary, Background, Key Claims, Controversies, Sources

### 🔍 Source Quality & Diversification
- **Multi-Source Categorization**: Government, Academic, Fact-checkers, News, Grokipedia
- **Quality Scoring**: Weighted algorithm based on source authority
- **Diversity Metrics**: Ensures balanced perspectives and source types
- **Smart Recommendations**: Identifies gaps in source coverage
- **URL Validation**: Verifies all sources are real and accessible (no 404s)

### ⚖️ Comparative Analysis
- **Speaker Comparison**: Identify contradictions and agreements between speakers
- **Claim Evolution Tracking**: Analyze position changes over time
- **Consistency Scoring**: Measure speaker reliability across debates
- **Flip-Flop Detection**: Track position reversals with date citations
- **Accuracy Rankings**: Compare truth scores between speakers

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

### Basic Analysis
1. Navigate to a debate transcript page
2. Click the Veritas extension icon
3. Click "Analyze Debate"
4. View results in `analytics.html`

### Advanced Features (Grokipedia Dashboard)
1. Open `grokipedia-dashboard.html` in your browser
2. Use the tabs to access different tools:
   - **Bias Analyzer**: Detect ideological bias in statements
   - **Article Generator**: Create Grokipedia-formatted articles
   - **Speaker Comparison**: Compare claims between speakers
   - **Source Quality**: Analyze source diversity and credibility

## API Endpoints

### Debate Analysis
- `POST /api/debate/create-debate-space` - Create new debate space
- `POST /api/debate/analyze-transcript` - Analyze transcript with Grok
- `GET /api/debate/debate-results/:space_id` - Get analysis results

### Source Management
- `POST /api/claims/:messageId/:claimIndex/generate-sources` - Generate verified sources

### Bias Detection
- `POST /api/bias/analyze-statement` - Analyze single statement for bias
- `POST /api/bias/analyze-debate/:space_id` - Analyze full debate bias

### Grokipedia Export
- `POST /api/grokipedia/generate-article/:space_id` - Generate Grokipedia article
- `POST /api/grokipedia/analyze-sources` - Analyze source quality & diversity

### Comparative Analysis
- `POST /api/compare/speakers/:space_id` - Compare two speakers
- `POST /api/compare/claim-evolution` - Track claim changes over time

## Judging Criteria Alignment

### ✅ Citation Quality and Diversity
- Generates 10-20 sources per claim from diverse categories
- Validates all URLs before saving (no 404s or fake URLs)
- Weighted quality scoring: Government (10), Academic (10), Fact-checkers (9), Major News (7)
- Always includes Grokipedia links for comprehensive background

### ✅ Fact-Checking Accuracy
- Uses Grok-4-0709 (best model) for maximum accuracy
- Filters opinions vs factual claims in prompts
- Verdict system: TRUE, MOSTLY TRUE, MIXED, MOSTLY FALSE, FALSE, UNVERIFIABLE
- External benchmark alignment via FactCheck.org, PolitiFact, Snopes

### ✅ Bias Mitigation Effectiveness
- Automated bias detection with 0-100 neutrality scoring
- Identifies loaded language, cherry-picking, emotional appeals, framing
- Provides neutral rewrites and diverse perspectives
- Quantified via ideological lean classification

### ✅ Scalability for Corpus-Wide Operations
- Parallel URL validation with Promise.all
- Batch processing for debate-wide analysis
- Efficient database queries with Supabase
- Rate-limit aware API calls

### ✅ Open-Source Contributions to Grokipedia
- Generates articles in Wikipedia/Grokipedia format
- Proper citation management with [[ref:N]] format
- CC-BY-SA compatible output
- Article submission ready

## Tech Stack

- **Backend**: Node.js, Express, Supabase
- **AI**: Grok API (xAI) - Grok-4-0709 model
- **Frontend**: Vanilla JavaScript, Chart.js
- **Extension**: Chrome Extension Manifest V3
- **Database**: PostgreSQL (Supabase) with JSONB for claims

## Hackathon Advantages

1. **Comprehensive Bias Detection**: Ideological lean + neutrality scoring + bias indicators
2. **Real Working URLs**: Validates every source to eliminate hallucinated URLs
3. **Source Diversification**: 7 categories with weighted quality scoring
4. **Grokipedia Integration**: Native support for grokipedia.com/page/ links
5. **Multi-Debate Evolution**: Tracks claim consistency across time
6. **Speaker Contradictions**: Automatically identifies flip-flops and agreements
