"""Export the director's 27 seconds of current combat plus the 3-second logo."""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/trailer/battle-30s'
RAW = ROOT / 'artifacts/trailer/raw'
FF = pathlib.Path(os.environ.get('FFMPEG_BINARY', ROOT / '.tmp/trailer-python/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'))
EDIT = [
    ('battle30_spear', 4, 'Croatian spearman', 'pike_melee'),
    ('battle30_ottoman_bow', 4, 'Ottoman foot archer', 'bow_attack'),
    ('battle30_croatian_bow', 4, 'Croatian bowman', 'bow_attack'),
    ('battle30_sword', 4, 'Croatian man-at-arms', 'sword_sidearm_melee'),
    ('battle30_janissary', 3, 'Ottoman janissary', 'sword_sidearm_melee'),
    ('battle30_clash', 3, 'Close melee', 'shield_armor_impact'),
    ('battle30_pullback', 5, 'Battlefield crane pullback', 'pike_melee'),
]


def run(args, capture=False):
    return subprocess.run([str(FF), '-hide_banner', '-loglevel', 'warning', '-y', *map(str, args)],
                          cwd=OUT, check=True, capture_output=capture, text=capture)


OUT.mkdir(parents=True, exist_ok=True)
segments = []
effects = []
cursor = 0
for index, (name, seconds, description, family) in enumerate(EDIT):
    sources = sorted(RAW.glob(f'{name}-*.ivf'))
    if not sources:
        raise RuntimeError(f'Missing new director capture: {name}')
    source = sources[-1]
    target = OUT / f'cut-{index:02d}.mp4'
    # Source is native 1080p; the edit does not crop the warriors or invent motion.
    run(['-i', source, '-frames:v', seconds * 30, '-vf',
         'setsar=1,fps=30,format=yuv420p', '-an', '-c:v', 'libx264',
         '-preset', 'slow', '-crf', '17', '-maxrate', '14M', '-bufsize', '28M',
         '-profile:v', 'high', '-level:v', '4.1', '-g', '60', target])
    trace_path = ROOT / 'artifacts/trailer' / f'{name}-camera.json'
    trace = json.loads(trace_path.read_text(encoding='utf-8'))
    events = []
    previous = None
    for sample in trace['trace']:
        actor = sample.get('subject')
        if actor and previous and actor['attackCooldown'] > previous['attackCooldown'] + .2:
            at = cursor + sample['frame'] / 30
            if at < cursor + seconds - .3 and (not events or at - events[-1] > .5):
                events.append(at)
                effects.append((f'combat/{family}_{1 + len(events) % 3}.mp3', at,
                                .9 if family == 'bow_attack' else 1.15, .48 if family == 'bow_attack' else .34))
        previous = actor
    segments.append({'start': cursor, 'duration': seconds, 'description': description,
                     'source': str(source.relative_to(ROOT)), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                     'heroId': str(trace['hero']['id']), 'attackSoundTimes': events})
    cursor += seconds
    print(f'Edited {name}: {seconds}s, {len(events)} attack accents', flush=True)

assert cursor == 27
logo = ROOT / 'public/assets/ui/selo-empire-logo-serious.png'
run(['-loop', '1', '-i', logo, '-frames:v', 90, '-vf',
     'scale=1180:-1,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d=0.25,fade=t=out:st=2.75:d=0.25',
     '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level:v', '4.1', '-g', '60', OUT / 'cut-07.mp4'])
concat = OUT / 'cuts.txt'
concat.write_text(''.join(f"file 'cut-{i:02d}.mp4'\n" for i in range(8)))
run(['-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', OUT / 'picture-30s.mp4'])

args = ['-i', OUT / 'picture-30s.mp4', '-i', OUT / 'selo-empire-frontier-score.mp3']
filters = ['[1:a]atrim=0:30,asetpts=PTS-STARTPTS,volume=1.1[music]']
for n, (sound, at, length, volume) in enumerate(effects, 2):
    args += ['-i', ROOT / 'public/sounds' / sound]
    filters.append(f'[{n}:a]atrim=0:{length},asetpts=PTS-STARTPTS,afade=t=out:st={length-.15}:d=.15,volume={volume},adelay={round(at*1000)}|{round(at*1000)}[s{n}]')
filters.append('[music]' + ''.join(f'[s{n}]' for n in range(2, len(effects)+2))
               + f'amix=inputs={len(effects)+1}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9,afade=t=out:st=29:d=1,apad=whole_dur=30[mix]')
final = OUT / 'Selo-Empire-Croatian-Frontier-Battle-30s-X.mp4'
run(args + ['-filter_complex', ';'.join(filters), '-map', '0:v:0', '-map', '[mix]',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
            '-t', '30', '-movflags', '+faststart', final])
manifest = {'duration': 30, 'frames': 900, 'fps': 30, 'resolution': '1920x1080',
            'segments': segments, 'endCard': {'start': 27, 'duration': 3, 'source': str(logo.relative_to(ROOT))},
            'score': json.loads((OUT / 'score-provenance.json').read_text()),
            'output': final.name, 'sha256': hashlib.sha256(final.read_bytes()).hexdigest()}
(OUT / 'edit-decision-list.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
run(['-i', final, '-vf', 'fps=1/3,scale=480:270,tile=2x5', '-frames:v', '1', OUT / 'contact-sheet.jpg'])
print(f'Exported {final} ({final.stat().st_size/1024/1024:.1f} MiB)', flush=True)
