import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = process.cwd();
const battle30 = process.argv.includes('--battle30');
const seconds = battle30 ? 30 : 60;
const directory = path.join(root, battle30 ? 'artifacts/trailer/battle-30s' : 'artifacts/trailer');
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
const battlePrompt = `An original exactly 30-second instrumental battle trailer score for Selo Empire, a historical strategy game on the Croatian Ottoman frontier circa 1550. Urgent, tense, human-scale warfare, with a memorable austere modal bowed-string motif, plucked lute ostinato, deep skin frame drums, davul-like war drums, low strings, sparse natural brass and distant rustic reed colors. Acoustic cinematic production; no vocals, chanting, speech, electronic sounds, electric guitar, modern drum kit, or sound effects. Start immediately with one dramatic low drum strike and a taut rhythmic string figure, suitable for close shots of warriors and bowstrings. 0-8 seconds: tense driving pulse with space between drum hits. 8-17 seconds: build interlocking string rhythms and martial drums for alternating Croatian and Ottoman archers and close melee. 17-22 seconds: accelerate perceived energy with faster subdivisions and growing low brass. 22-27 seconds: broaden into a soaring heroic but grave main theme as the camera rises above the battle. Precisely at 27 seconds, a decisive final tonic chord with one deep drum impact for the SELO EMPIRE logo. 27-30 seconds: only the beautiful natural reverb tail, decaying fully to silence at 30 seconds. Strong edit accents at 4, 8, 12, 16, 19, 22 and 27 seconds. A complete short composition with a resolved ending, not an excerpt or loop.`;
const body = { prompt: battle30 ? battlePrompt : prompt, music_length_ms: seconds * 1000, model_id: 'music_v2', force_instrumental: true, sign_with_c2pa: true };
await writeFile(path.join(directory, 'score-request.json'), JSON.stringify(body, null, 2));
console.log(`Generating one ${seconds}-second original ElevenLabs music_v2 composition.`);
const response = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_48000_192', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'xi-api-key': key }, body: JSON.stringify(body),
});
if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${await response.text()}`);
const audio = Buffer.from(await response.arrayBuffer());
await writeFile(output, audio);
await writeFile(path.join(directory, 'score-provenance.json'), JSON.stringify({ provider: 'ElevenLabs', model: body.model_id, durationRequested: seconds, generatedAt: new Date().toISOString(), songId: response.headers.get('song-id'), sha256: createHash('sha256').update(audio).digest('hex'), byteLength: audio.length }, null, 2));
console.log(`Saved ${audio.length} bytes to ${output}`);
