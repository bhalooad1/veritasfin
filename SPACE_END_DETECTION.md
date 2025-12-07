# Space End Detection & Summary Generation

Automatically detects when a Twitter Space ends and generates a tweet-ready summary.

## How It Works

### 1. Frontend Detection (`space-end-detector.js`)
- Monitors the DOM for "Ended" text (appears when space ends)
- Checks every 5 seconds
- When detected, calls backend API to mark space as ended

### 2. Backend Processing (`backend/routes/space-end.js`)
- Marks space as `is_live = false` in database
- Triggers summary generation asynchronously
- Generates tweet-ready summary (280 chars max) using Grok
- Stores summary in `summary_text` column

### 3. Database Schema
New columns in `spaces` table:
- `is_live` - Whether space is currently active
- `ended_at` - Timestamp when space ended
- `summary_generated` - Whether AI summary created
- `summary_text` - Tweet-ready summary
- `posted_to_x` - Whether summary tweeted
- `x_post_id` - Tweet ID if posted

## Setup

### 1. Run Database Migration
Copy and run `/backend/migrations/add_space_end_tracking.sql` in Supabase SQL Editor.

### 2. Reload Chrome Extension
1. Go to `chrome://extensions/`
2. Click reload button on Veritas extension
3. The `space-end-detector.js` script is now active

### 3. Test It

#### Option A: Test with Console (Recommended)
1. Open a Twitter Space page
2. Open DevTools Console (F12)
3. Run this to simulate space end:
```javascript
// Create fake "Ended" element
const fakeEnded = document.createElement('span');
fakeEnded.className = 'css-1jxf684';
fakeEnded.textContent = 'Ended';
document.body.appendChild(fakeEnded);

// Trigger detection manually
checkForSpaceEnd();
```

4. Check console for:
```
✅ Space ended detected!
🎯 Handling space end...
📝 Space ID: [your-space-id]
```

5. Verify in Supabase:
```sql
SELECT
  id,
  title,
  is_live,
  ended_at,
  summary_generated,
  summary_text
FROM spaces
WHERE id = 'your-space-id';
```

#### Option B: Test with Real Space
1. Start monitoring a real Twitter Space with Veritas
2. Wait for space to actually end
3. Watch for "Ended" status in UI
4. Space will be automatically marked as ended

## API Endpoints

### Mark Space as Ended
```bash
POST http://localhost:3000/api/spaces/end
Content-Type: application/json

{
  "space_id": "uuid-here"
}
```

Response:
```json
{
  "success": true,
  "message": "Space ended successfully. Summary generation started.",
  "space_id": "uuid-here"
}
```

### Get Summary Status
```bash
GET http://localhost:3000/api/spaces/{space_id}/summary
```

Response:
```json
{
  "success": true,
  "summary": {
    "generated": true,
    "text": "🎯 Presidential Debate Fact-Checked\n✅ TRUE: 8 | ❌ FALSE: 3 | ⚠️ MIXED: 5\n📌 Most accurate: Harris on economy",
    "generated_at": "2024-01-15T10:30:00Z",
    "posted_to_x": false
  }
}
```

## Summary Format

The AI generates punchy, tweet-ready summaries:

```
🎯 [Topic]: [Key Finding]
✅ TRUE: [count] | ❌ FALSE: [count] | ⚠️ MIXED: [count]
📌 Most accurate: [speaker] on [topic]
🔍 Full analysis: [link will be added by your bot]
```

Example:
```
🎯 Presidential Debate Fact-Checked
✅ TRUE: 12 | ❌ FALSE: 5 | ⚠️ MIXED: 8
📌 Most accurate: Biden on economy stats
🔍 Full analysis: [your-link]
```

## Integration with X Bot

### Polling Approach (Recommended)
Create a separate service that polls for ready-to-post summaries:

```javascript
// x-bot-service.js
setInterval(async () => {
  // Find spaces ready to post
  const { data: readySpaces } = await supabase
    .from('spaces')
    .select('*')
    .eq('summary_generated', true)
    .eq('posted_to_x', false);

  for (const space of readySpaces) {
    // Post to X using X API
    const tweetId = await postToX(space.summary_text);

    // Mark as posted
    await supabase
      .from('spaces')
      .update({
        posted_to_x: true,
        x_post_id: tweetId,
        x_posted_at: new Date().toISOString()
      })
      .eq('id', space.id);
  }
}, 10000); // Check every 10 seconds
```

### Webhook Approach (Alternative)
Use Supabase Database Webhooks:
1. Create webhook in Supabase Dashboard
2. Trigger on `UPDATE` of `spaces` table
3. Filter: `summary_generated = true AND posted_to_x = false`
4. Send to your X bot endpoint

## Debugging

### Check if detector is running
```javascript
// In browser console on Twitter/X
console.log(isMonitoringSpaceEnd); // Should be true
```

### Manually trigger detection
```javascript
// In browser console
checkForSpaceEnd();
```

### View current space ID
```javascript
// In browser console
chrome.storage.local.get(['currentSpaceId'], (result) => {
  console.log('Current space:', result.currentSpaceId);
});
```

### Check backend logs
```bash
cd backend
npm run dev

# Watch for:
# 🏁 Ending space: [id]
# ✅ Space marked as ended
# 📝 Generating summary for space: [id]
# ✅ Summary generated: [text]
```

## Troubleshooting

**Space not being detected as ended:**
- Check if "Ended" text is visible in UI
- Verify `space-end-detector.js` is loaded (check Sources tab in DevTools)
- Check console for errors

**Summary not generating:**
- Check backend logs for Grok API errors
- Verify `GROK_API_KEY` is set in `.env`
- Ensure space has fact-checked messages (can't summarize empty space)

**Summary generated but empty:**
- Space had no fact-checked messages
- Check `messages_with_speakers` table for that space_id
- Ensure messages have `fact_check_status = 'completed'`

## Next Steps

After summary is generated:
1. Your X bot polls `/api/spaces/:id/summary`
2. When `generated: true`, bot posts the `summary_text` to X
3. Bot updates `posted_to_x = true` in database
4. Include link to your analytics page in tweet

Example tweet:
```
[summary_text from database]

🔍 Full analysis: https://yoursite.com/analytics/[space_id]
```
