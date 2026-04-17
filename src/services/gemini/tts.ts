/**
 * Gemini text-to-speech service.
 *
 * The TTS model returns raw 16-bit PCM audio at 24 kHz, mono, base64-encoded
 * inside the generateContent response. This module:
 *   1. Chunks long transcripts (quality drifts past a few minutes per call).
 *   2. Calls Gemini TTS for each chunk with automatic retry on transient 5xx.
 *   3. Crossfades adjacent PCM chunks at a zero-aligned boundary so joins are
 *      inaudible, then wraps the result in a single WAV container.
 *
 * Browser callers get a WAV Blob. Node/CLI callers can reach for
 * `generatePcmAudio` instead to drive ffmpeg directly.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL_ID = 'gemini-2.5-flash-preview-tts';
const DEFAULT_VOICE_NAME = 'Kore';

// Gemini TTS returns 24 kHz / 16-bit / mono PCM
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * Stay well under Gemini's "few minutes per call" quality-drift threshold.
 * ~4000 chars is ~4 min of speech at 150 wpm — big enough to minimise the
 * number of joins (where audible seams can happen), small enough to avoid
 * the drift Google explicitly warns about.
 */
const MAX_CHUNK_CHARS = 4000;
const MAX_ATTEMPTS = 3;

/**
 * Milliseconds of equal-power crossfade at every chunk boundary. Two jobs:
 *  - hides the zero-crossing discontinuity that produces a click/pop when
 *    two independent PCM buffers are concatenated;
 *  - blends prosody differences between separate generateContent calls.
 * 80 ms is short enough that no content is lost and long enough to smooth
 * the transition.
 */
const CROSSFADE_MS = 80;

export class GeminiTtsError extends Error {
  readonly status: number | undefined;
  readonly detail: string | undefined;

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'GeminiTtsError';
    this.status = status;
    this.detail = detail;
  }
}

export interface TtsOptions {
  /** Prebuilt Gemini voice name (e.g. "Kore", "Puck"). Defaults to "Kore". */
  voiceName?: string;
  /** Override the Gemini TTS model id. */
  modelId?: string;
  /**
   * Natural-language accent / delivery direction prepended to every chunk
   * (e.g. "Australian English accent from Sydney"). Each chunk is a fresh
   * generateContent call, so the directive must repeat per chunk.
   */
  accent?: string;
  /** Called after each chunk with (completed, total) for UI progress. */
  onProgress?: (current: number, total: number) => void;
}

interface PcmResult {
  pcm: Uint8Array;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current && current.length + 2 + trimmed.length > MAX_CHUNK_CHARS) {
      chunks.push(current.trim());
      current = '';
    }

    if (trimmed.length > MAX_CHUNK_CHARS) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      const sentences = trimmed.match(/[^.!?]+[.!?]+[\s]*/g) || [trimmed];
      let sentenceChunk = '';
      for (const sentence of sentences) {
        if (sentenceChunk && sentenceChunk.length + sentence.length > MAX_CHUNK_CHARS) {
          chunks.push(sentenceChunk.trim());
          sentenceChunk = '';
        }
        sentenceChunk += sentence;
      }
      if (sentenceChunk.trim()) current = sentenceChunk;
    } else {
      current += (current ? '\n\n' : '') + trimmed;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node.js fallback
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function synthesizeChunk(
  text: string,
  apiKey: string,
  voiceName: string,
  modelId: string,
): Promise<Uint8Array> {
  const url = `${API_BASE}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      },
    },
  };

  let lastErr: GeminiTtsError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastErr = new GeminiTtsError(
        `Network error calling Gemini TTS: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastErr;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      lastErr = new GeminiTtsError(
        `Gemini TTS returned ${response.status}: ${detail.slice(0, 300)}`,
        response.status,
        detail,
      );
      // Per Gemini docs, the model occasionally returns text tokens causing a 500.
      // Retry transient 5xx; fail fast on 4xx (auth / quota / bad input).
      if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastErr;
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      lastErr = new GeminiTtsError(
        `Gemini TTS returned non-JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastErr;
    }

    const b64 = extractAudioBase64(json);
    if (!b64) {
      lastErr = new GeminiTtsError(
        'Gemini TTS response contained no audio data (model may have returned text tokens).',
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastErr;
    }

    const pcm = base64ToBytes(b64);
    if (pcm.length === 0) {
      lastErr = new GeminiTtsError('Gemini TTS returned an empty audio payload.');
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastErr;
    }
    return pcm;
  }

  // Should be unreachable — loop either returns or throws — but satisfies TS.
  throw lastErr ?? new GeminiTtsError('Gemini TTS failed for unknown reason.');
}

function extractAudioBase64(json: unknown): string | null {
  // Shape: { candidates: [{ content: { parts: [{ inlineData: { data, mimeType } }] } }] }
  const candidates = (json as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> }).candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!parts) return null;
  for (const part of parts) {
    const data = part?.inlineData?.data;
    if (typeof data === 'string' && data.length > 0) return data;
  }
  return null;
}

function concatPcm(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Equal-power (cosine) crossfade join: the last `fadeMs` of `prev` mix with
 * the first `fadeMs` of `next` using sin/cos weights, which keep perceived
 * loudness constant across the blend. Falls back to a plain concat if either
 * chunk is too short to fade.
 */
function crossfadePcm(prev: Uint8Array, next: Uint8Array, fadeMs = CROSSFADE_MS): Uint8Array {
  const fadeSamples = Math.floor((fadeMs / 1000) * SAMPLE_RATE);
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const fadeBytes = fadeSamples * bytesPerSample;

  if (prev.length < fadeBytes || next.length < fadeBytes || fadeSamples === 0) {
    return concatPcm([prev, next]);
  }

  const prevBody = prev.subarray(0, prev.length - fadeBytes);
  const prevTail = prev.subarray(prev.length - fadeBytes);
  const nextHead = next.subarray(0, fadeBytes);
  const nextBody = next.subarray(fadeBytes);

  const mixed = new Uint8Array(fadeBytes);
  const prevView = new DataView(prevTail.buffer, prevTail.byteOffset, fadeBytes);
  const nextView = new DataView(nextHead.buffer, nextHead.byteOffset, fadeBytes);
  const mixedView = new DataView(mixed.buffer);

  for (let i = 0; i < fadeSamples; i++) {
    const t = i / fadeSamples;
    const wOut = Math.cos((t * Math.PI) / 2);
    const wIn = Math.sin((t * Math.PI) / 2);
    const prevSample = prevView.getInt16(i * bytesPerSample, true);
    const nextSample = nextView.getInt16(i * bytesPerSample, true);
    const mixedSample = Math.round(prevSample * wOut + nextSample * wIn);
    const clamped = Math.max(-32768, Math.min(32767, mixedSample));
    mixedView.setInt16(i * bytesPerSample, clamped, true);
  }

  const out = new Uint8Array(prevBody.length + mixed.length + nextBody.length);
  out.set(prevBody, 0);
  out.set(mixed, prevBody.length);
  out.set(nextBody, prevBody.length + mixed.length);
  return out;
}

/** Join a sequence of PCM chunks with crossfades between every adjacent pair. */
function joinPcmWithCrossfade(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  let result = chunks[0];
  for (let i = 1; i < chunks.length; i++) {
    result = crossfadePcm(result, chunks[i]);
  }
  return result;
}

/** Wrap raw PCM in a 44-byte RIFF/WAVE header. */
function pcmToWav(
  pcm: Uint8Array,
  sampleRate = SAMPLE_RATE,
  channels = CHANNELS,
  bitsPerSample = BITS_PER_SAMPLE,
): Uint8Array {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, fileSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Low-level: returns concatenated PCM plus format metadata.
 * Use from CLI when you want to pipe into ffmpeg for MP3 transcoding.
 */
export async function generatePcmAudio(
  text: string,
  apiKey: string,
  options?: TtsOptions,
): Promise<PcmResult> {
  if (!text.trim()) throw new GeminiTtsError('Cannot generate audio from empty text.');
  if (!apiKey.trim()) throw new GeminiTtsError('Gemini API key is required.');

  const voiceName = options?.voiceName?.trim() || DEFAULT_VOICE_NAME;
  const modelId = options?.modelId?.trim() || DEFAULT_MODEL_ID;
  const accent = options?.accent?.trim();
  // Softer framing than a direct command — tells the model to stay natural
  // and only nudge the inflection, not perform a regional caricature.
  const prefix = accent
    ? `Read the following transcript naturally and conversationally. The narrator's voice has a ${accent}. Do not exaggerate the accent.\n\n`
    : '';

  const chunks = chunkText(text);
  const pcmChunks: Uint8Array[] = [];

  for (let i = 0; i < chunks.length; i++) {
    options?.onProgress?.(i + 1, chunks.length);
    const pcm = await synthesizeChunk(prefix + chunks[i], apiKey, voiceName, modelId);
    pcmChunks.push(pcm);
  }

  return {
    pcm: joinPcmWithCrossfade(pcmChunks),
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
  };
}

/**
 * Generate an audiobook WAV blob from text via Gemini TTS.
 * Automatically chunks long transcripts and wraps the concatenated PCM
 * in a single RIFF/WAVE container the browser can play directly.
 */
export async function generateAudiobook(
  text: string,
  apiKey: string,
  options?: TtsOptions,
): Promise<Blob> {
  const { pcm, sampleRate, channels, bitsPerSample } = await generatePcmAudio(text, apiKey, options);
  const wav = pcmToWav(pcm, sampleRate, channels, bitsPerSample);
  // Cast via BlobPart — our Uint8Array is backed by a fresh ArrayBuffer, but
  // TS widens to ArrayBufferLike which Blob's typings reject.
  const blob = new Blob([wav as unknown as BlobPart], { type: 'audio/wav' });
  if (blob.size === 0) throw new GeminiTtsError('Audio generation produced no output.');
  return blob;
}
