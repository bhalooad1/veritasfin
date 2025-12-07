class DebateParser {
    constructor() {
        this.moderators = ['DAVID MUIR', 'LINSEY DAVIS'];
        this.validSpeakers = [
            'VICE PRESIDENT KAMALA HARRIS',
            'FORMER PRESIDENT DONALD TRUMP',
            'KAMALA HARRIS',
            'DONALD TRUMP',
            'PRESIDENT TRUMP',
            'VICE PRESIDENT HARRIS'
        ];
        this.speakers = new Map();
        this.messages = [];
    }

    /**
     * Parse a debate transcript into individual messages
     */
    parseTranscript(transcript) {
        const lines = transcript.split('\n');
        let currentSpeaker = null;
        let sequenceNumber = 0;
        let currentContent = '';

        const flushMessage = () => {
            if (currentSpeaker && currentContent.trim()) {
                sequenceNumber++;
                const message = {
                    speaker: currentSpeaker,
                    content: currentContent.trim(),
                    sequence_number: sequenceNumber,
                    fact_check_status: 'pending'
                };

                this.messages.push(message);

                if (!this.speakers.has(currentSpeaker)) {
                    this.speakers.set(currentSpeaker, {
                        name: currentSpeaker,
                        message_count: 0
                    });
                }

                this.speakers.get(currentSpeaker).message_count++;
            }
            currentContent = '';
        };

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            const match = /^\s*([A-Z][a-zA-Z0-9\s\.]+):(.*)/.exec(line);

            if (match) {
                const name = match[1].trim();
                const content = match[2].trim();
                const normalizedName = this.normalizeSpeakerName(name);

                if (this.isValidSpeaker(normalizedName)) {
                    flushMessage();

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
                    flushMessage();
                    currentSpeaker = null;
                    continue;
                }
            }

            if (currentSpeaker) {
                currentContent += (currentContent ? ' ' : '') + line;
            }
        }

        flushMessage();
        return this.messages;
    }

    normalizeSpeakerName(name) {
        return name.toLowerCase().split(' ').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
    }

    isModerator(speaker) {
        const mods = ['Moderator', 'David Muir', 'Linsey Davis'];
        return mods.includes(speaker);
    }

    isValidSpeaker(speaker) {
        if (this.isModerator(speaker)) {
            return false;
        }

        const normalized = speaker.toUpperCase();
        return this.validSpeakers.some(validName =>
            normalized.includes('KAMALA') ||
            normalized.includes('HARRIS') ||
            normalized.includes('TRUMP') ||
            normalized.includes('DONALD')
        );
    }

    getStatistics() {
        return {
            total_messages: this.messages.length,
            speakers: Array.from(this.speakers.values())
        };
    }
}

export default DebateParser;
