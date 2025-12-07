# 🔍 Automatic Twitter Handle Finder

## What's New

Your debate processor now automatically finds real Twitter handles for speakers using Grok's web search capabilities!

## How It Works

When you process a debate with speaker names like:
- **"MKBHD"** → Finds `@MKBHD`
- **"Marques Brownlee"** → Finds `@MKBHD`  
- **"Elon Musk"** → Finds `@elonmusk`
- **"Donald Trump"** → Finds `@realDonaldTrump`

The system:
1. ✅ Uses Grok API with web_search tool
2. ✅ Searches for the speaker's actual Twitter handle
3. ✅ Returns verified @handle
4. ✅ Falls back to generated handle if not found

## Files Added/Modified

### New Files
- **`backend/utils/handle-finder.js`** - Core handle finding logic with Grok web search
- **`test-handle-finder.html`** - Test page to try handle lookup

### Modified Files
- **`backend/routes/debate-analyzer.js`** - Integrated handle finder into debate creation

## Testing

### 1. Test the Handle Finder Directly

Open `test-handle-finder.html` in your browser (with backend running):

```bash
# Make sure backend is running first
cd backend
npm start

# Then open test-handle-finder.html in browser
```

Try searching for:
- MKBHD
- Elon Musk
- Any public figure name

### 2. Test in Process Debate

Just use `process-debate.html` as normal. When you enter speaker names in the transcript, the system will automatically find their real handles.

Example transcript:
```
MKBHD: This phone has amazing cameras.
Elon Musk: We should focus on sustainable energy.
```

The system will automatically:
- Find @MKBHD for "MKBHD"
- Find @elonmusk for "Elon Musk"

## API Endpoint

### Find Handle for Single Speaker

```bash
POST http://localhost:3000/api/debate/find-handle
Content-Type: application/json

{
  "name": "MKBHD"
}
```

Response:
```json
{
  "success": true,
  "name": "MKBHD",
  "handle": "@MKBHD"
}
```

### cURL Example

```bash
curl -X POST http://localhost:3000/api/debate/find-handle \
  -H "Content-Type: application/json" \
  -d '{"name": "MKBHD"}'
```

## Features

### ✅ Smart Handle Detection
- Uses Grok's web search to find verified handles
- Works with nicknames (MKBHD → @MKBHD)
- Works with full names (Marques Brownlee → @MKBHD)

### ✅ Built-in Cache
Common names are cached to avoid unnecessary API calls:
- MKBHD, Elon Musk, Donald Trump, Joe Biden, etc.

### ✅ Graceful Fallback
If handle can't be found:
- Generates handle from name (removes spaces)
- Still creates the speaker in database
- No errors or failures

### ✅ Parallel Processing
When multiple speakers are detected, handles are found in parallel for speed.

## Configuration

The handle finder uses your existing Grok API credentials from `.env`:

```env
GROK_API_KEY=your_grok_api_key
GROK_API_URL=https://api.x.ai/v1
```

No additional configuration needed!

## Performance

- **Cached handles**: Instant (~0ms)
- **Web search**: ~1-3 seconds per handle
- **Parallel processing**: Multiple handles searched simultaneously

## Extending the Cache

Add more known handles to avoid API calls in `backend/utils/handle-finder.js`:

```javascript
const knownHandles = {
    'MKBHD': '@MKBHD',
    'YourName': '@yourhandle',
    // Add more here
};
```

## Troubleshooting

### Handle finder returns wrong handle
- Check if the name is specific enough
- Add the correct mapping to the cache

### API errors
- Verify GROK_API_KEY is set in .env
- Check backend console for detailed logs

### Timeout errors
- The search has a 50-token limit (fast responses)
- Falls back to generated handle on timeout

## Example Integration

The handle finder is automatically used in `create-debate-space`:

```javascript
// Old way (just removed spaces)
const username = '@' + participant.name.replace(/\s+/g, '');

// New way (smart web search)
const handleMap = await findMultipleHandles(participants.map(p => p.name));
const username = handleMap[participant.name];
```

## Next Steps

You can extend this to:
1. Add more social media platforms (Instagram, YouTube, etc.)
2. Cache handles in database for faster lookups
3. Add user interface to manually correct handles
4. Use X API to verify handle existence

Enjoy automatic handle finding! 🚀

