"""Render the final edit as soon as the production recorder finishes its shots."""
import pathlib, subprocess, sys, time
root=pathlib.Path(__file__).resolve().parents[2]
raw=root/'artifacts/trailer/raw'
names=['founding','hamlet','farms','industry','city_wide','city_street','market','muster_close','muster_wide','battle_wide','battle_mid','battle_street']
last_report=0
after=float(sys.argv[sys.argv.index('--after')+1]) if '--after' in sys.argv else 0
military_after=float(sys.argv[sys.argv.index('--military-after')+1]) if '--military-after' in sys.argv else 0
military={'muster_close','muster_wide','battle_wide','battle_mid','battle_street'}
while True:
    missing=[]
    for name in names:
        files=sorted(raw.glob(name+'-*.ivf'))
        if not files or files[-1].stat().st_size<50000 or time.time()-files[-1].stat().st_mtime<5 or files[-1].stat().st_mtime<after or (name in military and files[-1].stat().st_mtime<military_after):
            missing.append(name)
    if not missing: break
    if time.time()-last_report>=30:
        print('Recording remaining shots: '+', '.join(missing),flush=True)
        last_report=time.time()
    time.sleep(3)
subprocess.run([sys.executable,str(root/'scripts/trailer/editTrailer.py')],cwd=root,check=True)
