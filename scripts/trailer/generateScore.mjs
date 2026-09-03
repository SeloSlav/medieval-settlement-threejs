import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const directory = path.join(root, 'artifacts/trailer');
await mkdir(directory, { recursive: true });
const output = path.join(directory, 'selo-empire-frontier-score.mp3');
try { await access(output); console.log('Score already exists; no additional generation requested.'); process.exit(0); } catch {}
let key = process.env.ELEVENLABS_API_KEY;
for (const name of ['.env.audio.local', '.env.local']) {
  if (key) break;
  try {
    const text = await readFile(path.join(root, name), 'utf8');
    key = text.match(/^ELEVENLABS_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
  } catch {}
}
if (!key) throw new Error('The ElevenLabs music key is not configured.');
const prompt = `Compose exactly 60 seconds of original instrumental cinematic music for Selo Empire, a city-building and tactical warfare game set in Gorski Kotar, Croatia, circa 1550. Evoke dark fir forests, Croatian frontier villages, resilience, and an approaching Ottoman army. Historical folk colors: bowed lijerica-like strings, rustic wood flute, plucked lute, restrained bagpipe drone, deep frame drums and field drums, low strings, and noble natural brass. No lyrics, no spoken voice, no synth EDM, no electric guitar, no modern drum kit. Organic, emotional, memorable recurring modal melody. High production quality and wide cinematic dynamics.
EDIT TIMING: 0-10 seconds: combat cold open, ominous slow low-string pulse, two deep drum strikes, a haunting solitary bowed melody, restrained dread with audible space for clashing weapons. At 10 seconds a clean musical breath and a gentle hopeful flute/lute theme for founding a village. 10-24 seconds: pastoral wonder, building layers of plucked strings and bowed melody. 24-34 seconds: growing settlement and bustling trade; rhythmic folk ostinato gains momentum, rising harmonic lift. 34-40 seconds: military muster, marching snare-like field drums and low brass enter, suspense rising. 40-55 seconds: the grand finale, furious galloping drums, full soaring strings, bold brass, heroic Croatian frontier melody, increasing urgency and scale. At 55.5 seconds deliver one decisive epic final chord and deep drum impact for a cut to a logo on pure black. 56-60 seconds: let the natural reverberation and low strings decay gracefully to silence. Strong edit points near 10, 24, 34, 40, 48, and 56 seconds. The overall trajectory begins sparse and slow and grows to a breathtaking large-scale climax.`;
const body = { prompt, music_length_ms: 60_000, model_id: 'music_v2', force_instrumental: true, sign_with_c2pa: true };
await writeFile(path.join(directory, 'score-request.json'), JSON.stringify(body, null, 2));
console.log('Generating one 60-second original ElevenLabs music_v2 composition.');
const response = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key }, body: JSON.stringify(body),
});
if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${await response.text()}`);
const audio = Buffer.from(await response.arrayBuffer());
await writeFile(output, audio);
await writeFile(path.join(directory, 'score-provenance.json'), JSON.stringify({ provider: 'ElevenLabs', model: body.model_id, durationRequested: 60, generatedAt: new Date().toISOString(), songId: response.headers.get('song-id'), sha256: createHash('sha256').update(audio).digest('hex'), byteLength: audio.length }, null, 2));
console.log(`Saved ${audio.length} bytes to ${output}`);
