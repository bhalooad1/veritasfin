import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Find the Twitter/X handle for a given speaker name using Grok's web search
 * @param {string} speakerName - The name of the speaker (e.g., "MKBHD", "Elon Musk", "Marques Brownlee")
 * @returns {Promise<string>} - The Twitter handle (e.g., "@mkbhd") or generated fallback
 */
export async function findTwitterHandle(speakerName) {
    try {
        console.log(`🔍 Searching for Twitter handle for: ${speakerName}`);

        // Quick cache for common names to avoid API calls
        // Case-insensitive matching will be done below
        const knownHandles = {
            // Tech
            'mkbhd': '@MKBHD',
            'marques brownlee': '@MKBHD',
            'tim cook': '@tim_cook',
            'elon musk': '@elonmusk',
            'sundar pichai': '@sundarpichai',
            'satya nadella': '@sataborovkova',
            'mark zuckerberg': '@faborogovkhada',
            'linus tech tips': '@LinusTech',
            'linus sebastian': '@LinusTech',
            'casey neistat': '@CaseyNeistat',
            'ijustine': '@iJustine',
            'justine ezarik': '@iJustine',
            'unbox therapy': '@UnboxTherapy',
            'lewis hilsenteger': '@UnboxTherapy',
            
            // Politics
            'donald trump': '@realDonaldTrump',
            'kamala harris': '@KamalaHarris',
            'joe biden': '@JoeBiden',
            'barack obama': '@BarackObama',
            'bernie sanders': '@BernieSanders',
            'aoc': '@AOC',
            'alexandria ocasio-cortez': '@AOC',
            
            // Entertainment
            'taylor swift': '@taylorswift13',
            'mr beast': '@MrBeast',
            'mrbeast': '@MrBeast',
            'jimmy donaldson': '@MrBeast',
            'pewdiepie': '@pewdiepie',
            'felix kjellberg': '@pewdiepie',
            'kylie jenner': '@KylieJenner',
            'kim kardashian': '@KimKardashian',
            'kanye west': '@kanyewest',
            'rihanna': '@rihanna',
            'drake': '@Drake',
            'justin bieber': '@justinbieber',
            'ariana grande': '@ArianaGrande',
            'lebron james': '@KingJames',
            'cristiano ronaldo': '@Cristiano',
        };

        // Check cache first (case-insensitive)
        const normalizedName = speakerName.trim().toLowerCase();
        if (knownHandles[normalizedName]) {
            console.log(`✅ Found in cache: ${knownHandles[normalizedName]}`);
            return knownHandles[normalizedName];
        }

        // Use Grok API to find the handle (Grok has knowledge of public figures' handles)
        const response = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'grok-3-mini-fast',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant that knows Twitter/X handles of public figures, celebrities, and content creators. Return ONLY the handle with @ symbol, nothing else. If unsure, return NOT_FOUND.'
                    },
                    {
                        role: 'user',
                        content: `What is the Twitter/X handle for ${speakerName}?`
                    }
                ],
                temperature: 0, // Zero temperature for deterministic factual response
                max_tokens: 30 // We only need the handle
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Grok API error ${response.status}:`, errorText);
            throw new Error(`Grok API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content?.trim();

        console.log(`🤖 Grok response: ${content}`);

        // Validate the response
        if (content && content.startsWith('@') && content !== 'NOT_FOUND') {
            // Extract just the handle (remove any extra text)
            const handleMatch = content.match(/@[\w]+/);
            if (handleMatch) {
                const handle = handleMatch[0];
                console.log(`✅ Found handle: ${handle}`);
                return handle;
            }
        }

        // Fallback: generate a handle from the name
        console.log(`⚠️ Could not find verified handle, generating fallback`);
        return generateFallbackHandle(speakerName);

    } catch (error) {
        console.error(`❌ Error finding Twitter handle for ${speakerName}:`, error.message);
        // Return fallback on error
        return generateFallbackHandle(speakerName);
    }
}

/**
 * Generate a fallback Twitter handle from a speaker name
 * @param {string} speakerName - The speaker's name
 * @returns {string} - A generated handle
 */
function generateFallbackHandle(speakerName) {
    // Remove common titles
    let cleaned = speakerName
        .replace(/^(President|Vice President|Senator|Representative|Dr\.|Mr\.|Ms\.|Mrs\.)\s+/gi, '')
        .trim();
    
    // Remove spaces and special characters
    cleaned = cleaned.replace(/\s+/g, '');
    
    // Ensure it starts with @
    return '@' + cleaned;
}

/**
 * Find handles for multiple speakers in parallel
 * @param {Array<string>} speakerNames - Array of speaker names
 * @returns {Promise<Object>} - Object mapping names to handles
 */
export async function findMultipleHandles(speakerNames) {
    console.log(`🔍 Finding handles for ${speakerNames.length} speakers...`);
    
    const results = await Promise.all(
        speakerNames.map(async (name) => {
            const handle = await findTwitterHandle(name);
            return { name, handle };
        })
    );
    
    const handleMap = {};
    results.forEach(({ name, handle }) => {
        handleMap[name] = handle;
    });
    
    console.log('✅ Handle mapping complete:', handleMap);
    return handleMap;
}

export default { findTwitterHandle, findMultipleHandles };

