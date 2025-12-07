
import { Jimp } from 'jimp';
import path from 'path';

async function processIcon() {
    try {
        const inputPath = '/Users/vedantgaur/.gemini/antigravity/brain/78fab1d2-e993-4654-97fa-5519f7fb8038/veritas_clean_circle_icon_1764883057461.png';
        const outputPath = '/Users/vedantgaur/Downloads/Projects/veritas/v_icon_transparent.png';

        console.log('Reading image...');
        const image = await Jimp.read(inputPath);

        console.log('Processing transparency...');
        // Scan all pixels
        image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
            const red = this.bitmap.data[idx + 0];
            const green = this.bitmap.data[idx + 1];
            const blue = this.bitmap.data[idx + 2];

            // If pixel is white (or very close to white), make it transparent
            if (red > 240 && green > 240 && blue > 240) {
                this.bitmap.data[idx + 3] = 0; // Set alpha to 0
            }
        });

        console.log('Saving...');
        await new Promise((resolve, reject) => {
            image.write(outputPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log('Done!');
    } catch (error) {
        console.error('Error:', error);
    }
}

processIcon();
