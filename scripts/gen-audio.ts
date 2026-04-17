#!/usr/bin/env node
/**
 * One-off: generate Gemini TTS audiobooks for every chapter that has a
 * transcript but no audio file yet. Writes WAV, then transcodes to MP3 via
 * ffmpeg (if available).
 *
 * Usage: GEMINI_API_KEY=... npx tsx scripts/gen-audio.ts ./output/my-course [voiceName]
 */
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { generateAudiobook } from '../src/services/gemini/tts';

const execFileAsync = promisify(execFile);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const OUTPUT_DIR = process.argv[2] || './output/raising-a-puppy';
const VOICE_NAME = process.argv[3] || undefined; // uses default (Kore) if not set
const AUDIO_DIR = join(OUTPUT_DIR, 'audio');

async function wavToMp3(wavPath: string): Promise<string> {
  const mp3Path = wavPath.replace(/\.wav$/, '.mp3');
  try {
    await execFileAsync('ffmpeg', ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-qscale:a', '2', mp3Path]);
    await unlink(wavPath);
    return mp3Path;
  } catch {
    console.log('  Warning: ffmpeg not available — keeping WAV output');
    try { await unlink(mp3Path); } catch { /* ignore */ }
    return wavPath;
  }
}

async function main() {
  const files = readdirSync(AUDIO_DIR)
    .filter((f: string) => f.endsWith('_transcript.md'))
    .sort();

  console.log(`Found ${files.length} transcripts in ${AUDIO_DIR}`);
  if (VOICE_NAME) console.log(`Using voice: ${VOICE_NAME}`);

  for (const file of files) {
    const prefix = file.replace('_transcript.md', '');
    const mp3Path = join(AUDIO_DIR, `${prefix}.mp3`);
    const wavPath = join(AUDIO_DIR, `${prefix}.wav`);

    if (existsSync(mp3Path) || existsSync(wavPath)) {
      console.log(`  ${prefix}: audio already exists, skipping`);
      continue;
    }

    const transcriptPath = join(AUDIO_DIR, file);
    const transcript = await readFile(transcriptPath, 'utf-8');

    console.log(`  ${prefix}: Generating audio (${transcript.length} chars)...`);
    try {
      const audioBlob = await generateAudiobook(transcript, GEMINI_API_KEY!, {
        voiceName: VOICE_NAME,
        onProgress: (current, total) => process.stdout.write(`    chunk ${current}/${total}\r`),
      });
      console.log('');

      const arrayBuffer = await audioBlob.arrayBuffer();
      await writeFile(wavPath, Buffer.from(arrayBuffer));
      const finalPath = await wavToMp3(wavPath);
      const sizeMb = (arrayBuffer.byteLength / 1024 / 1024).toFixed(1);
      console.log(`  ${prefix}: Saved ${finalPath.endsWith('.mp3') ? 'MP3' : 'WAV'} (${sizeMb} MB source)`);
    } catch (err) {
      console.error(`  ${prefix}: ERROR — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
