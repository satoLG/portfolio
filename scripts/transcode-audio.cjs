/**
 * transcode-audio.cjs — one-off transcoder for the project's WAV assets.
 *
 * The repo ships ~108 MB of uncompressed WAV. After decode they're the same
 * size in RAM as the equivalent MP3/Opus would be (PCM is PCM), but on disk
 * + in the HTTP fetch buffer + in the browser cache they multiply session
 * memory pressure. This script transcodes WAVs in place and deletes the
 * originals — Opus for long ambient loops (smallest at ~equivalent quality),
 * MP3 for everything else (universal compatibility).
 *
 * Run: `node scripts/transcode-audio.cjs`
 * Requires `ffmpeg` on PATH (with libopus + libmp3lame).
 *
 * After running, update the path constants in src/core/Audio.ts and
 * src/core/MediaPlayer.ts to point at the new extensions.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUDIO_ROOT = path.resolve(__dirname, '..', 'public/audio');

// Long ambient loops where Opus shines (smaller, near-transparent at low bitrates).
const OPUS_FILES = new Set([
    'nature/underwater/366159__dcsfx__underwater-loop-amb.wav',
    'nature/surface/fireplace.wav',
    'nature/surface/ocean.wav',
]);

// Per-file MP3 bitrate — music tracks get 192k, SFX/short clips get 128k.
const MP3_BITRATE = {
    'music/595751__yellowtree__late-nights-in-osaka.wav': '192k',
    'music/320526__benpm__ambient-piano-music-3.wav':     '192k',
};
const MP3_DEFAULT_BITRATE = '128k';

function listWavs(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listWavs(p));
        else if (entry.isFile() && p.toLowerCase().endsWith('.wav')) out.push(p);
    }
    return out;
}

const wavs = listWavs(AUDIO_ROOT);
let totalBefore = 0, totalAfter = 0;

for (const wavPath of wavs) {
    const rel = path.relative(AUDIO_ROOT, wavPath).replace(/\\/g, '/');
    const useOpus = OPUS_FILES.has(rel);
    const outExt  = useOpus ? '.opus' : '.mp3';
    const outPath = wavPath.replace(/\.wav$/i, outExt);

    const beforeBytes = fs.statSync(wavPath).size;
    totalBefore += beforeBytes;

    let cmd;
    if (useOpus) {
        // 64 kbps stereo VBR — transparent for ambient nature loops, ~99% disk
        // saving on long uncompressed WAVs. `vbr on` keeps quality stable.
        cmd = `ffmpeg -y -loglevel error -i "${wavPath}" -c:a libopus -b:a 64k -vbr on "${outPath}"`;
    } else {
        const br = MP3_BITRATE[rel] || MP3_DEFAULT_BITRATE;
        cmd = `ffmpeg -y -loglevel error -i "${wavPath}" -c:a libmp3lame -b:a ${br} "${outPath}"`;
    }

    try {
        execSync(cmd, { stdio: 'inherit' });
    } catch (e) {
        console.error(`Failed to transcode ${rel}`);
        process.exit(1);
    }

    const afterBytes = fs.statSync(outPath).size;
    totalAfter += afterBytes;
    fs.unlinkSync(wavPath);

    const ratio = ((1 - afterBytes / beforeBytes) * 100).toFixed(1);
    console.log(`${rel.padEnd(60)} ${(beforeBytes/1024).toFixed(0).padStart(7)} KB -> ${(afterBytes/1024).toFixed(0).padStart(6)} KB  (-${ratio}%)  [${useOpus ? 'opus' : 'mp3'}]`);
}

console.log('\n────────────────────────────────────────────────────────────');
console.log(`Total: ${(totalBefore/1024/1024).toFixed(2)} MB -> ${(totalAfter/1024/1024).toFixed(2)} MB  (saved ${((totalBefore - totalAfter)/1024/1024).toFixed(2)} MB)`);
