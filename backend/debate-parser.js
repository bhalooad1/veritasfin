import fs from 'fs';

class DebateParser {
    constructor() {
        // Moderators to ignore
        this.moderators = ['DAVID MUIR', 'LINSEY DAVIS'];

        // Valid debate participants (normalize these)
        this.validSpeakers = [
            'VICE PRESIDENT KAMALA HARRIS',
            'FORMER PRESIDENT DONALD TRUMP',
            'KAMALA HARRIS',
            'DONALD TRUMP',
            'PRESIDENT TRUMP',
            'VICE PRESIDENT HARRIS'
        ];

        // Speakers to track
        this.speakers = new Map();

        // Messages array for analysis
        this.messages = [];
    }

    /**
     * Parse a debate transcript into individual messages
     * @param {string} transcript - The full debate transcript
     * @returns {Array} Array of message objects ready for database
     */
    parseTranscript(transcript) {
        // Generic pattern for "SPEAKER NAME:" at start of lines
        // Captures names in Mixed Case (starting with uppercase) followed by colon
        const speakerPattern = /^\s*([A-Z][a-zA-Z0-9\s\.]+):/gm;

        // Split transcript by lines to process sequentially
        const lines = transcript.split('\n');

        let currentSpeaker = null;
        let sequenceNumber = 0;
        let currentContent = '';

        // Helper to flush current message
        const flushMessage = () => {
            if (currentSpeaker && currentContent.trim()) {
                // Break long content into chunks
                const chunks = this.breakIntoChunks(currentContent.trim(), 500);

                for (const chunk of chunks) {
                    sequenceNumber++;
                    const message = {
                        speaker: currentSpeaker,
                        content: chunk,
                        sequence_number: sequenceNumber,
                        word_count: chunk.split(/\s+/).length,
                        timestamp: null,
                        fact_check_status: 'pending'
                    };

                    this.messages.push(message);

                    // Track stats
                    if (!this.speakers.has(currentSpeaker)) {
                        this.speakers.set(currentSpeaker, {
                            name: currentSpeaker,
                            message_count: 0,
                            total_words: 0
                        });
                    }

                    const stats = this.speakers.get(currentSpeaker);
                    stats.message_count++;
                    stats.total_words += message.word_count;
                }
            }
            currentContent = '';
        };

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Check for speaker pattern
            const match = /^\s*([A-Z][a-zA-Z0-9\s\.]+):(.*)/.exec(line);

            if (match) {
                // Found a new speaker
                const name = match[1].trim();
                const content = match[2].trim();

                // Only process if it's a valid speaker
                const normalizedName = this.normalizeSpeakerName(name);

                if (this.isValidSpeaker(normalizedName)) {
                    flushMessage(); // Save previous speaker's message

                    // Standardize the speaker names
                    if (normalizedName.toLowerCase().includes('kamala') ||
                        normalizedName.toLowerCase().includes('harris')) {
                        currentSpeaker = 'Kamala Harris';
                    } else if (normalizedName.toLowerCase().includes('trump') ||
                              normalizedName.toLowerCase().includes('donald')) {
                        currentSpeaker = 'Donald Trump';
                    }

                    if (content) currentContent = content;
                    continue;
                } else if (this.isModerator(normalizedName)) {
                    // Skip moderator content
                    flushMessage();
                    currentSpeaker = null;
                    continue;
                }
                // If not a valid speaker or moderator, treat as continuation of content
            }

            // Append to current speaker's content
            if (currentSpeaker) {
                currentContent += (currentContent ? ' ' : '') + line;
            }
        }

        // Flush last message
        flushMessage();

        return this.messages;
    }

    /**
     * Check if a string is a speaker name (Deprecated, using regex now)
     */
    isSpeakerName(text) {
        return /^[A-Z][A-Z\s\.]+$/.test(text);
    }

    /**
     * Normalize speaker names for consistency
     */
    normalizeSpeakerName(name) {
        // Title Case helper
        return name.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }

    /**
     * Check if a speaker is a moderator
     */
    isModerator(speaker) {
        const mods = ['Moderator', 'David Muir', 'Linsey Davis', 'Chris Wallace', 'Kristen Welker'];
        return mods.includes(speaker);
    }

    /**
     * Check if a speaker is a valid debate participant
     */
    isValidSpeaker(speaker) {
        // First check if it's a moderator (which we want to exclude)
        if (this.isModerator(speaker)) {
            return false;
        }

        // Normalize speaker name for comparison
        const normalized = speaker.toUpperCase();

        // Check if it matches any valid speaker pattern
        return this.validSpeakers.some(validName =>
            normalized.includes('KAMALA') ||
            normalized.includes('HARRIS') ||
            normalized.includes('TRUMP') ||
            normalized.includes('DONALD')
        );
    }

    /**
     * Clean content by removing extra whitespace and formatting
     */
    cleanContent(content) {
        return content
            .replace(/\s+/g, ' ')  // Normalize whitespace
            .replace(/--/g, '—')   // Fix dashes
            .trim();
    }

    /**
     * Break long content into smaller chunks
     */
    breakIntoChunks(content, maxLength) {
        const sentences = content.match(/[^.!?]+[.!?]+/g) || [content];
        const chunks = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > maxLength && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = sentence;
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    /**
     * Get statistics about the parsed debate
     */
    getStatistics() {
        return {
            total_messages: this.messages.length,
            speakers: Array.from(this.speakers.values()),
            messages_per_speaker: Array.from(this.speakers.entries()).map(([name, stats]) => ({
                speaker: name,
                count: stats.message_count,
                words: stats.total_words,
                avg_words_per_message: Math.round(stats.total_words / stats.message_count)
            }))
        };
    }

    /**
     * Export messages in format ready for Supabase
     */
    exportForSupabase(spaceId) {
        return this.messages.map(msg => ({
            space_id: spaceId,
            speaker_id: null, // Will be set when inserting to DB
            content: msg.content,
            sequence_number: msg.sequence_number,
            fact_check_status: 'pending',
            created_at: new Date().toISOString()
        }));
    }

    /**
     * Export as JSON file
     */
    exportToFile(filename) {
        const data = {
            metadata: {
                parsed_at: new Date().toISOString(),
                statistics: this.getStatistics()
            },
            messages: this.messages
        };

        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
        console.log(`Exported ${this.messages.length} messages to ${filename}`);
    }
}

// Example usage - commented out for ES module compatibility
// To test, run: node debate-parser.js --test
/*
const parser = new DebateParser();
const transcript = fs.readFileSync('debate-transcript.txt', 'utf8');
const messages = parser.parseTranscript(transcript);
*/

export default DebateParser;