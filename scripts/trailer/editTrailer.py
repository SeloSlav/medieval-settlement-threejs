"""Reproducible 60-second social trailer edit from captured, unmodified gameplay."""
import json, pathlib, subprocess, shutil, sys

ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/trailer'
FF=ROOT/'.tmp/trailer-python/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
OUT.mkdir(parents=True,exist_ok=True)
shutil.copyfile(pathlib.Path('C:/Windows/Fonts/GARA.TTF'),OUT/'title.ttf')
shutil.copyfile(pathlib.Path('C:/Windows/Fonts/calibri.ttf'),OUT/'caption.ttf')

# Each selected source is genuine live game footage. Repeated battlefield views
# may come from separately staged takes of the same 100-versus-100 setup.
EDIT=[
 ('battle_street',0,3,'CROATIA · 1550',''),
 ('battle_mid',1,3,'',''),
 ('battle_wide',0,4,'HOLD THE FRONTIER',''),
 ('founding',0,3,'BEGIN WITH A SINGLE CAMP',''),
 ('hamlet',1,4,'',''),
 ('farms',0,4,'BUILD A LIVING ECONOMY',''),
 ('industry',1,3,'',''),
 ('city_wide',1,5,'RAISE YOUR VILLAGE',''),
 ('city_street',0,4,'',''),
 ('market',0,3,'',''),
 ('muster_close',0,4,'CALL THEM TO ARMS',''),
 ('muster_wide',0,4,'',''),
 ('battle_mid',3,4,'DEFEND AGAINST OTTOMAN RAIDERS',''),
 ('battle_street',3,4,'',''),
 ('battle_wide',4,4,'YOUR HOME. YOUR FRONTIER.',''),
]
assert sum(e[2] for e in EDIT)==56

def run(args):
    subprocess.run([str(FF),'-hide_banner','-loglevel','warning','-y',*map(str,args)],cwd=OUT,check=True)

def clip(name):
    files=sorted((OUT/'raw').glob(name+'-*.ivf'))
    if not files: raise RuntimeError('Missing gameplay capture: '+name)
    return files[-1]

manifest=[];cursor=0
available_only='--available' in sys.argv
for i,(name,start,duration,title,subtitle) in enumerate(EDIT):
    try: src=clip(name)
    except RuntimeError:
        if available_only: cursor+=duration;continue
        raise
    target=OUT/f'cut-{i:02d}.mp4'
    manifest.append({'start':cursor,'duration':duration,'source':str(src.relative_to(ROOT)),'in':start,'title':title});cursor+=duration
    if target.exists() and target.stat().st_mtime>max(src.stat().st_mtime,pathlib.Path(__file__).stat().st_mtime):
        print(f'Using edited shot {i+1}: {name}',flush=True);continue
    filters=['scale=1920:1080:flags=lanczos','setsar=1','fps=30','tpad=stop_mode=clone:stop_duration=0.4','eq=contrast=1.06:brightness=0.012:saturation=1.07:gamma=1.02','format=yuv420p']
    if title:
        textfile=OUT/f'title-{i:02d}.txt';textfile.write_text(title,encoding='utf-8')
        # A low translucent backing and restrained serif maintain legibility
        # without burying the gameplay or relying on sound in the X feed.
        filters+=['drawbox=x=0:y=910:w=iw:h=170:color=black@0.34:t=fill',
          f"drawtext=fontfile=title.ttf:textfile={textfile.name}:fontsize=62:fontcolor=0xF3E7C9:shadowcolor=black@0.85:shadowx=2:shadowy=3:x=(w-tw)/2:y=959:alpha='min(1,t/0.25)'" ]
    run(['-ss',start,'-i',src,'-frames:v',int(duration*30),'-vf',','.join(filters),'-an','-c:v','libx264','-preset','fast','-crf','17',target])
    print(f'Edited {i+1}/{len(EDIT)}: {name}',flush=True)

logo=ROOT/'public/assets/ui/selo-empire-logo-serious.png'
run(['-loop','1','-i',logo,'-t','4','-vf',"scale=1120:-1,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d=0.35,fade=t=out:st=3.65:d=0.35",'-an','-c:v','libx264','-preset','fast','-crf','17',OUT/'cut-15.mp4'])
if available_only: sys.exit(0)
concat=OUT/'cuts.txt';concat.write_text(''.join(f"file 'cut-{i:02d}.mp4'\n" for i in range(16)))
run(['-f','concat','-safe','0','-i',concat,'-c','copy',OUT/'selo-empire-picture.mp4'])
# Sound edit uses the game's own effects, aligned to the pictured activities.
# The canvas recorder intentionally records pictures only, so slow capture time
# never changes the pitch or tempo of the soundtrack.
# Ambient beds accompany settlement life. Combat uses irregular, non-looping
# weapon contacts; no fighting voices or formation grunts are mixed in.
effects=[
 ('ambient/founders_camp_day.mp3',10,3,0.18),
 ('ambient/village_day.mp3',13,4,0.16),
 ('ambient/worksite_food_farm.mp3',17,4,0.2),
 ('ambient/worksite_metal_stone.mp3',21,3,0.2),
 ('buildings/chapel_bell_tier_3.mp3',24,4,0.18),
 ('ambient/village_day.mp3',29,4,0.2),
 ('buildings/marketplace.mp3',33,3,0.2),
 ('buildings/cavalry_yard.mp3',36,4,0.2),
]
weapon_families=['sword_sidearm_melee','shield_armor_impact','pike_melee','halberd_polearm_melee','shield_armor_impact','sword_sidearm_melee','crossbow_attack','bow_attack']
contacts=[0.08,0.47,0.91,1.24,1.82,2.16,2.69,3.15,3.48,4.09,4.53,5.12,5.46,6.08,6.56,7.05,7.72,8.13,8.64,9.22,
          40.15,40.91,41.55,42.24,43.02,43.73,44.05,44.36,44.9,45.23,45.72,46.11,46.65,47.12,47.41,48.03,48.5,48.93,49.31,49.89,50.24,50.85,51.19,51.68,52.16,52.53,53.09,53.45,54.02,54.36,54.87,55.21]
for i,start in enumerate(contacts):
    family=weapon_families[i%len(weapon_families)]
    variant=1+(i//len(weapon_families))%3
    effects.append((f'combat/{family}_{variant}.mp3',start,min(1.5,56-start),0.30+(i%4)*0.035))
args=['-i',OUT/'selo-empire-picture.mp4','-i',OUT/'selo-empire-frontier-score.mp3']
audio_filters=['[1:a]atrim=0:60,asetpts=PTS-STARTPTS,volume=0.9[music]']
for n,(sound,start,duration,volume) in enumerate(effects,2):
    args+=['-i',ROOT/'public/sounds'/sound]
    audio_filters.append(f'[{n}:a]atrim=0:{duration},asetpts=PTS-STARTPTS,afade=t=out:st={max(0,duration-.25)}:d=0.25,volume={volume},adelay={round(start*1000)}|{round(start*1000)}[s{n}]')
audio_filters.append('[music]'+''.join(f'[s{n}]' for n in range(2,len(effects)+2))+f'amix=inputs={len(effects)+1}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=10,afade=t=out:st=59:d=1[mix]')
run(args+['-filter_complex',';'.join(audio_filters),'-map','0:v:0','-map','[mix]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t','60','-movflags','+faststart',OUT/'Selo-Empire-Gameplay-Trailer-60s.mp4'])
(OUT/'edit-decision-list.json').write_text(json.dumps({'duration':60,'resolution':'1920x1080','fps':30,'segments':manifest,'endCard':{'start':56,'duration':4,'source':str(logo.relative_to(ROOT))}},indent=2))
shutil.copyfile(OUT/'Selo-Empire-Gameplay-Trailer-60s.mp4',OUT/'Selo-Empire-Gameplay-Trailer-60s-v3.mp4')
print('Completed 60-second trailer v3.',flush=True)
