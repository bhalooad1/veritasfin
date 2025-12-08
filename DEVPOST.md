# Veritas - Real-Time Fact-Checking for X Spaces

## Inspiration

In an era where misinformation spreads faster than ever, X Spaces has become a powerful platform for live discussions on critical topics—from politics to health to economics. However, listeners have no way to verify claims in real-time, leading to the rapid spread of false information.

We were inspired to build **Veritas** (Latin for "truth") to empower users with instant, AI-powered fact-checking directly in their X Spaces experience. Our goal is to make truth verification as seamless as scrolling through a feed—no need to leave the conversation to fact-check claims.

## What it does

**Veritas** is a Chrome extension that provides real-time fact-checking for X Spaces conversations. Here's what it does:

### 🎯 Real-Time Fact-Checking
- **Live Caption Monitoring**: Automatically captures and processes captions from X Spaces as they appear
- **AI-Powered Analysis**: Uses Grok AI to extract factual claims and verify them against trusted sources
- **Instant Credibility Scoring**: Assigns truth scores (1-10) to each claim and tracks overall space credibility
- **Visual Overlay**: Displays fact-check results directly on the X Spaces page with a sleek, minimal UI

### 📊 Comprehensive Analytics Dashboard
- **Conversation Timeline**: Interactive D3.js visualization showing truth scores over time
- **Speaker Comparison**: Compare average truth scores between different speakers
- **Propagation Graphs**: Visualize how claims spread across X (Twitter) with network graphs
- **Detailed Claim Analysis**: Dive deep into each claim with explanations and source citations

### 🔍 Advanced Features
- **Argument Mapping**: Beta feature that maps argumentative structures and relationships between claims
- **Space End Detection**: Automatically detects when a Space ends and generates tweet-ready summaries
- **Thread Analysis**: Analyze entire Twitter threads for fact-checking
- **Source Verification**: Links to trusted sources including FactCheck.org, PolitiFact, Snopes, and Grokipedia

### 🎨 Beautiful Design
- **Swiss Minimalism**: Clean, monospace aesthetic with high contrast
- **Real-Time Updates**: Live indicators and smooth animations
- **Responsive Overlay**: Draggable, resizable interface that doesn't obstruct the Space

## How we built it

### Frontend (Chrome Extension)
- **Manifest V3**: Modern Chrome extension architecture
- **Content Scripts**: Monitor X Spaces DOM for captions and UI changes
- **Real-Time Processing**: Captures captions as they appear, extracts speaker information, and sends to backend
- **Overlay UI**: Custom-built overlay with drag-and-drop functionality
- **Analytics Dashboard**: Standalone HTML page with D3.js visualizations and Chart.js graphs

### Backend (Node.js/Express)
- **RESTful API**: Express server handling message processing, fact-checking, and analytics
- **Grok AI Integration**: OpenAI-compatible API calls to Grok for claim extraction and verification
- **Supabase Database**: PostgreSQL database storing spaces, messages, speakers, and fact-check results
- **Real-Time Processing**: Asynchronous fact-checking pipeline that doesn't block user experience
- **Twitter API Integration**: Fetches real tweet data for propagation graphs

### AI & Analysis
- **Claim Extraction**: Sophisticated prompt engineering to extract factual claims from casual speech
- **Source Verification**: Curated list of trusted sources (FactCheck.org, PolitiFact, Snopes, government sites)
- **Truth Scoring**: 1-10 scale with detailed explanations for each score
- **Credibility Tracking**: Dynamic credibility scores that update as new claims are verified

### Database Schema
- **Spaces**: Track X Spaces with metadata, credibility scores, and summaries
- **Messages**: Store all captions with fact-check results, truth scores, and explanations
- **Speakers**: Global speaker database with username and display name tracking
- **Statistics**: Pre-computed views for fast analytics queries

### Key Technologies
- **JavaScript/ES6+**: Modern JavaScript throughout
- **D3.js**: Force-directed graphs and timeline visualizations
- **Chart.js**: Truth score trend charts
- **Supabase**: Database and real-time subscriptions
- **Grok AI**: xAI's Grok models for fact-checking
- **Express.js**: Backend API server

## Challenges we ran into

### 1. **Real-Time Caption Capture**
X Spaces doesn't provide a public API for captions. We had to reverse-engineer the DOM structure and build a robust monitoring system that:
- Detects new caption elements as they appear
- Handles dynamic DOM updates
- Tracks speaker changes accurately
- Prevents duplicate processing

**Solution**: Built a mutation observer system with content fingerprinting to track unique captions and speaker attribution.

### 2. **AI Response Parsing**
Grok AI sometimes returns non-JSON responses or malformed data. We needed reliable parsing that:
- Handles various response formats
- Provides fallback mechanisms
- Validates claim extraction
- Handles edge cases (opinions vs. facts)

**Solution**: Implemented robust JSON parsing with regex extraction, fallback responses, and extensive error handling.

### 3. **Performance & Rate Limiting**
Real-time fact-checking requires multiple API calls per minute. We needed to:
- Avoid rate limits
- Process messages asynchronously
- Cache results efficiently
- Handle API failures gracefully

**Solution**: Built an asynchronous processing pipeline with status tracking, caching, and retry logic.

### 4. **UI/UX Design**
Creating a non-intrusive overlay that provides value without blocking the Space experience was challenging:
- Positioning and sizing
- Real-time updates without flickering
- Drag-and-drop functionality
- Responsive design

**Solution**: Designed a minimal, Swiss-inspired interface with smooth animations and careful state management.

### 5. **Database Schema Complexity**
Tracking spaces, messages, speakers, and relationships required careful schema design:
- Efficient queries for analytics
- Real-time updates
- Speaker deduplication
- Statistics aggregation

**Solution**: Used Supabase views, stored procedures, and optimized indexes for fast queries.

## Accomplishments that we're proud of

### ✅ **Real-Time Fact-Checking**
We successfully built a system that fact-checks X Spaces conversations in real-time, something that didn't exist before. Users can now see truth scores appear as speakers make claims.

### ✅ **Beautiful, Minimal UI**
Our Swiss minimalism design philosophy resulted in a clean, professional interface that doesn't distract from the Space experience. The monospace aesthetic and high contrast make information easy to scan.

### ✅ **Comprehensive Analytics**
The analytics dashboard provides deep insights into conversation quality, speaker credibility, and claim propagation—features typically only available in expensive media monitoring tools.

### ✅ **Robust Architecture**
We built a scalable system that handles:
- Multiple concurrent Spaces
- High message volumes
- API failures and retries
- Real-time updates across components

### ✅ **AI Integration Excellence**
Our prompt engineering and claim extraction system successfully distinguishes between factual claims and opinions, even when phrased casually.

### ✅ **Open Source & Extensible**
The codebase is well-structured and documented, making it easy for others to contribute and extend.

## What we learned

### Technical Learnings
- **Chrome Extension Development**: Deep dive into Manifest V3, content scripts, and browser APIs
- **DOM Monitoring**: Advanced techniques for tracking dynamic content changes
- **AI Prompt Engineering**: How to structure prompts for reliable, structured outputs
- **Real-Time Systems**: Building responsive UIs that update asynchronously
- **Database Optimization**: Using views, stored procedures, and indexes for performance

### Product Learnings
- **User Experience**: Balancing information density with usability
- **Design Philosophy**: How minimalism can enhance functionality
- **Trust & Transparency**: The importance of showing sources and explanations
- **Performance Matters**: Users expect instant feedback, even for complex operations

### Challenges & Solutions
- **API Reliability**: Building resilient systems that handle failures gracefully
- **Data Quality**: Ensuring accurate speaker attribution and claim extraction
- **Scalability**: Designing for growth from day one

## What's next for Veritas

### Short-Term (Next 3 Months)
- **Enhanced Source Verification**: Integrate more fact-checking organizations and academic sources
- **Mobile Support**: Develop mobile browser extension or companion app
- **Multi-Language Support**: Extend fact-checking to Spaces in multiple languages
- **User Feedback System**: Allow users to report incorrect fact-checks and improve accuracy

### Medium-Term (3-6 Months)
- **Historical Analysis**: Build a database of fact-checked claims for trend analysis
- **Speaker Profiles**: Track credibility scores across multiple Spaces for known speakers
- **Custom Alerts**: Notify users when specific topics or speakers are discussed
- **API Access**: Provide API for researchers and journalists

### Long-Term Vision
- **Platform Expansion**: Extend to other platforms (YouTube Live, Clubhouse, etc.)
- **Community Fact-Checking**: Allow verified fact-checkers to contribute
- **Educational Features**: Help users learn to identify misinformation patterns
- **Research Partnerships**: Collaborate with fact-checking organizations and academic institutions

### Technical Improvements
- **Faster Processing**: Optimize AI calls and caching for sub-second fact-checking
- **Better Accuracy**: Fine-tune claim extraction and verification models
- **Offline Support**: Cache recent fact-checks for offline viewing
- **Privacy Enhancements**: Add options for local processing and data retention controls

---

## Try It Out

1. **Install the Extension**: Load the unpacked extension in Chrome
2. **Join a X Space**: Navigate to any active X Space
3. **Watch the Magic**: Veritas automatically starts monitoring and fact-checking
4. **Explore Analytics**: Click the analytics button to see detailed insights

## Built with

### Languages & Frameworks
- **JavaScript (ES6+)**: Modern JavaScript with ES modules throughout the codebase
- **Node.js**: Backend runtime environment
- **Express.js**: RESTful API server framework
- **HTML5/CSS3**: Frontend markup and styling

### Platforms & Services
- **Chrome Extension (Manifest V3)**: Browser extension platform
- **Supabase**: Backend-as-a-Service (PostgreSQL database, real-time subscriptions, API)
- **Grok AI (xAI)**: AI-powered fact-checking and claim verification

### Libraries & Tools
- **D3.js**: Data visualization library for force-directed graphs and timeline charts
- **Chart.js**: Charting library for truth score trend visualizations
- **CORS**: Cross-origin resource sharing middleware
- **dotenv**: Environment variable management
- **node-fetch**: HTTP client for API requests
- **Tweepy**: Twitter/X API integration library

### APIs & Integrations
- **Twitter/X API**: Fetching tweet data, thread analysis, and propagation graphs
- **Grok API**: OpenAI-compatible API for AI fact-checking
- **Supabase API**: Database operations and real-time data subscriptions

### Database & Storage
- **PostgreSQL**: Relational database (via Supabase)
- **Supabase Storage**: File and data storage

### Development Tools
- **Nodemon**: Development server with auto-reload
- **Git**: Version control

### Design & UI
- **Custom CSS**: Swiss minimalism design system
- **SVG**: Vector graphics for icons and visualizations

## Team

Built with ❤️ by the Veritas team

---

*Veritas - Seeing truth on X Spaces*

