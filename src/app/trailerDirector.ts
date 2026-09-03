import type { CameraController } from '../camera/CameraController.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { getConnection, getConnectionToken, getSpacetimeConfig } from '../network/spacetimedbClient.ts';
import { trailerClock } from './trailerClock.ts';
import { enterWorld } from '../data/spacetimeReducers.ts';
import { installLightingReview } from './lightingReview.ts';

type Pose = [number, number, number, number, number];
type Shot = { from: Pose; to: Pose; seconds: number };
const shots: Record<string, Shot> = {
  founding: {from:[-55,28,-0.65,0.35,34],to:[-54,28,-0.45,0.32,31],seconds:4},
  hamlet: {from:[-100,-70,-0.7,0.6,125],to:[-80,-65,-0.55,0.55,112],seconds:8},
  city_wide: {from:[0,-10,-0.78,0.7,410],to:[0,-10,-0.60,0.65,380],seconds:8},
  city_mid: {from:[-25,0,-0.8,0.44,130],to:[-12,0,-0.6,0.4,110],seconds:8},
  city_street: {from:[-80,-57,-1.55,0.14,15],to:[-53,-57,-1.55,0.14,15],seconds:8},
  market: {from:[-20,-14,-0.7,0.28,40],to:[-14,-14,-0.48,0.26,34],seconds:7},
  industry: {from:[-220,12,-0.7,0.4,95],to:[-213,-5,-0.5,0.35,85],seconds:7},
  farms: {from:[-50,-205,-0.65,0.55,180],to:[-25,-200,-0.48,0.5,160],seconds:7},
  muster_wide: {from:[250,5,-0.8,0.55,135],to:[250,5,-0.60,0.48,116],seconds:7},
  muster_close: {from:[245,3,-0.3,0.2,20],to:[254,3,-0.1,0.2,20],seconds:7},
  battle_wide: {from:[250,28,-0.45,0.72,155],to:[250,23,-0.3,0.65,140],seconds:10},
  battle_mid: {from:[250,28,-0.6,0.36,58],to:[250,25,-0.35,0.32,51],seconds:10},
  battle_street: {from:[250,25,-0.6,0.16,18],to:[253,25,-0.35,0.16,18],seconds:9},
};

export function installTrailerDirector(scene: SceneManager, camera: CameraController, crowdDiagnostics: () => unknown = () => null): void {
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).has('trailer')) return;
  const config=getSpacetimeConfig();
  if (!config.dbName.startsWith('selo-trailer')) throw new Error('Trailer controls require the isolated trailer database.');
  // Keep the heavy scene idle while an automatic production run prepares.
  if(new URLSearchParams(location.search).has('produce')){trailerClock.active=true;trailerClock.pending=false;trailerClock.timeMs=performance.now();}
  const panel=document.createElement('section');panel.id='trailer-director';
  panel.style.cssText='position:fixed;right:12px;top:115px;z-index:99999;width:240px;padding:14px;background:#151712ed;color:#eee8d7;font:12px system-ui;border:1px solid #867551;border-radius:6px';
  panel.innerHTML=`<strong>Trailer studio · live simulation</strong><p id="trailer-status">Ready</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px" id="trailer-actions"></div><label>Camera<select aria-label="Trailer camera" style="width:100%;margin:8px 0">${Object.keys(shots).map(n=>`<option>${n}</option>`).join('')}</select></label><div style="display:flex;gap:8px"><button data-preview>Preview</button><button data-record>Record shot</button></div><pre id="trailer-metrics" style="white-space:pre-wrap;font-size:10px"></pre>`;
  document.body.append(panel);
  const status=panel.querySelector<HTMLElement>('#trailer-status')!;
  const controls=panel.querySelector('#trailer-actions')!;
  const select=panel.querySelector('select')!;
  let busy=false;
  const call=async(name:string,args:unknown[])=>{
    const token=getConnectionToken();if(!token)throw new Error('Game connection is not ready');
    const r=await fetch(`${config.uri}/v1/database/${config.dbName}/call/${name}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(args)});
    if(!r.ok)throw new Error(`${name}: ${await r.text()}`);
  };
  const author=async(stage:number)=>{
    const plan=makePlan(scene,stage);
    await call('trailer_author',[JSON.stringify(plan)]);
    await fetch('http://127.0.0.1:5180/json/plan-'+stage,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(plan)});
  };
  const readyConnection=async()=>{
    for(let attempt=0;attempt<120;attempt++){
      if(getConnection()&&getConnectionToken()){
        try{await enterWorld();return;}catch{}
      }
      await new Promise(r=>setTimeout(r,500));
    }
    throw new Error('The game connection did not become ready for capture');
  };
  const stepSimulation=async(speed:1|8=1)=>{
    // Raid notifications may restore the live speed after victory or defeat.
    // Each exported heartbeat explicitly reacquires the paused simulation.
    await call('set_game_speed',[0]);
    try{await call('trailer_step_at_speed',[speed]);}catch(error){
      if(!String(error).includes('Pause before stepping')&&!String(error).includes('Enter the world'))throw error;
      await readyConnection();
      await call('set_game_speed',[0]);await call('trailer_step_at_speed',[speed]);
    }
  };
  const button=(label:string,action:()=>Promise<unknown>)=>{
    const b=document.createElement('button');b.textContent=label;b.style.cssText='padding:6px;font-size:11px';
    b.onclick=async()=>{if(busy)return;busy=true;status.textContent=label+'…';try{await action();status.textContent=label+' complete';}catch(e){status.textContent=String(e);console.error(e);}finally{busy=false;}};controls.append(b);
  };
  button('1 · Found camp',()=>author(0));
  button('2 · Build hamlet',()=>author(1));
  button('3 · Grow Delnice',()=>author(2));
  button('4 · Muster 100',()=>call('trailer_battle',[0,250,0]));
  button('5 · Ottoman 100',()=>call('trailer_battle',[1,250,60]));
  button('6 · Advance',async()=>{
    const conn=getConnection()!;const companies=[...conn.db.military_company.iter()];
    for(let i=0;i<companies.length;i++){
      const c=companies[i];const ids=[...conn.db.combat_agent.iter()].filter(a=>a.faction>=3&&a.raidId===c.id&&a.health>0).map(a=>Number(a.id));
      await call('set_military_tactics',[Number(c.id),true,[3,7,10].includes(c.kind)]);
      await call('command_militia',[ids,250+(i%7)*7-21,32+(i>6?-8:0),0,0]);
    }
  });
  button('8× simulation',()=>{trailerClock.active=false;return call('set_game_speed',[8]);});
  button('1× simulation',()=>{trailerClock.active=false;return call('set_game_speed',[1]);});
  button('Pause',()=>call('set_game_speed',[0]));
  button('Attach built city',()=>readyConnection());
  button('Save audit',async()=>{await fetch('http://127.0.0.1:5180/json/economy-'+Date.now(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(audit(),(_k,v)=>typeof v==='bigint'?v.toString():v)});});

  function audit(){const c=getConnection();if(!c)return{};return{capturedAt:new Date().toISOString(),captureSpeed:trailerClock.speed,crowd:crowdDiagnostics(),world:[...c.db.world_config.iter()],buildings:[...c.db.building.iter()],residences:[...c.db.residence.iter()],needs:[...c.db.residence_need.iter()],deliveries:[...c.db.delivery_trip.iter()],companies:[...c.db.military_company.iter()],combatants:[...c.db.combat_agent.iter()],farms:[...c.db.farm_field.iter()]};}
  const metricsTimer=setInterval(()=>{
    const c=getConnection();if(!c)return;
    const homes=[...c.db.residence.iter()];const agents=[...c.db.combat_agent.iter()];const buildings=[...c.db.building.iter()];
    const metrics={buildings:buildings.length,homes:homes.length,population:homes.reduce((n,r)=>n+r.population,0),tier4:homes.filter(r=>r.tier===4).length,carts:Number(c.db.delivery_trip.count()),friendly:agents.filter(a=>a.faction>=3&&a.health>0).length,ottoman:agents.filter(a=>a.faction===1&&a.health>0).length,companies:Number(c.db.military_company.count()),tick:String([...c.db.world_config.iter()][0]?.simTick)};
    panel.querySelector('#trailer-metrics')!.textContent=JSON.stringify(metrics,null,1);
    void fetch('http://127.0.0.1:5180/json/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status.textContent,...metrics})}).catch(()=>{});
  },2000);
  const disposeLightingReview = installLightingReview(scene, camera, panel);
  panel.style.maxHeight = 'calc(100vh - 130px)'; panel.style.overflowY = 'auto';
  import.meta.hot?.accept((updated)=>{clearInterval(metricsTimer);disposeLightingReview();panel.remove();updated?.installTrailerDirector(scene,camera,crowdDiagnostics);});
  const pose=(p:Pose)=>camera.applyShowcaseView(...p);
  const clearArena=()=>{
    const forest=scene.getForestManager();
    forest?.removeAuthoritativeTreeLayouts(forest.getTreeLayouts().filter(t=>Math.abs(t.x-250)<95&&Math.abs(t.z-30)<85).map(t=>t.layoutIndex));
  };
  const combatants=()=>[...getConnection()!.db.combat_agent.iter()];
  const fightingPair=()=>{
    const agents=combatants().filter(a=>a.health>0);
    const enemies=agents.filter(a=>a.faction===1&&a.sourceSlot%8<5);
    // Prefer an infantry duel near the flank, with clear space for an eye-level camera.
    const infantry=agents.filter(a=>a.faction>=3&&a.faction<=9);
    let best: {a:typeof agents[number];b:typeof agents[number];distance:number;score:number}|null=null;
    for(const a of infantry)for(const b of enemies){
      const distance=Math.hypot(a.x-b.x,a.z-b.z);
      const score=distance+Math.abs((a.x+b.x)/2-238)*0.06;
      if(!best||score<best.score)best={a,b,distance,score};
    }
    return best;
  };
  const renderFrame=async()=>{
    trailerClock.active=true;trailerClock.timeMs+=1000/30;
    await new Promise<void>(resolve=>{trailerClock.onFrame=()=>{trailerClock.onFrame=null;resolve();};trailerClock.pending=true;});
  };
  const directView=(x:number,z:number,dx:number,dz:number,height:number,lookHeight:number,fov=50)=>{
    camera.setInputEnabled(false);
    const eyeX=x+dx,eyeZ=z+dz;
    const ground=scene.terrain.getHeightAt(x,z);
    scene.camera.fov=fov;scene.camera.near=0.1;scene.camera.updateProjectionMatrix();
    scene.camera.position.set(eyeX,Math.max(ground+height,scene.terrain.getHeightAt(eyeX,eyeZ)+1.35),eyeZ);
    scene.camera.lookAt(x,ground+lookHeight,z);scene.camera.updateMatrixWorld(true);
  };
  select.onchange=()=>pose(shots[select.value].from);
  panel.querySelector<HTMLButtonElement>('[data-preview]')!.onclick=()=>pose(shots[select.value].from);
  const recordShot=async(name:string)=>{
    await readyConnection();
    const base=shots[name];const shot:Shot={from:[...base.from],to:[...base.to],seconds:base.seconds};select.value=name;
    const military=name.startsWith('battle_')||name.startsWith('muster_');
    trailerClock.speed=military?1:8;
    const projection={fov:scene.camera.fov,near:scene.camera.near,far:scene.camera.far};
    let pair=fightingPair();
    let focusX=pair?(pair.a.x+pair.b.x)/2:250,focusZ=pair?(pair.a.z+pair.b.z)/2:5;
    if(name==='muster_close'){
      const cavalryCompany=[...getConnection()!.db.military_company.iter()].find(c=>c.kind===8);
      const riders=combatants().filter(a=>a.raidId===cavalryCompany?.id&&a.faction>=3&&a.health>0);
      if(riders.length){focusX=riders.reduce((n,a)=>n+a.x,0)/riders.length;focusZ=riders.reduce((n,a)=>n+a.z,0)/riders.length;}
    }
    const framePose=(t:number)=>{
      // Keep the delivered composition stable if the surrounding app panel resizes.
      if(scene.renderer.domElement.width!==1280||scene.renderer.domElement.height!==720)scene.resize({width:1280,height:720});
      if(!military){pose(shot.from.map((v,i)=>v+(shot.to[i]-v)*t) as Pose);return;}
      if(name.startsWith('battle_')){
        const agents=combatants();
        let a=agents.find(a=>a.id===pair?.a.id&&a.health>0),b=agents.find(a=>a.id===pair?.b.id&&a.health>0);
        if(!a||!b){pair=fightingPair();a=pair?.a;b=pair?.b;}
        if(a&&b){const blend=1-Math.exp(-3/30);focusX+=((a.x+b.x)/2-focusX)*blend;focusZ+=((a.z+b.z)/2-focusZ)*blend;}
      }
      if(name==='battle_street')directView(focusX,focusZ,-7.5+t*1.2,-2.5,1.55,1.15,52);
      else if(name==='battle_mid')directView(focusX,focusZ,-23+t*3,-15,10,1,50);
      else if(name==='battle_wide')directView(focusX,focusZ,-65+t*5,-58,61,0,54);
      else if(name==='muster_close')directView(focusX,focusZ,-10+t*2,-12,2.1,1.8,50);
      else directView(250,5,-48+t*5,-45,32,1,50);
    };
    status.textContent='Preparing '+name;pose(shot.from);camera.setInputEnabled(false);
    try{
      await call('set_game_speed',[0]);
      if(military)clearArena();
      trailerClock.active=true;trailerClock.timeMs=Math.max(trailerClock.timeMs,performance.now());
      framePose(0);
      // Evaluate seated and combat poses and settle interpolation before frame zero.
      for(let i=0;i<18;i++)await renderFrame();
      const canvas=scene.renderer.domElement;
      const captureCanvas=new OffscreenCanvas(canvas.width,canvas.height);
      const captureContext=captureCanvas.getContext('2d',{alpha:false})!;
      const usedSeconds:Record<string,number>={founding:4,hamlet:5,farms:4,industry:4,city_wide:6,city_street:4,market:3,muster_wide:4,muster_close:4,battle_wide:8,battle_mid:7,battle_street:7};
      const target=(usedSeconds[name]??shot.seconds)*30;
      const chunks:ArrayBuffer[]=[];
      const encoder=new VideoEncoder({output:(chunk)=>{
        const bytes=new ArrayBuffer(12+chunk.byteLength),view=new DataView(bytes);
        view.setUint32(0,chunk.byteLength,true);view.setBigUint64(4,BigInt(Math.round(chunk.timestamp*30/1e6)),true);
        chunk.copyTo(new Uint8Array(bytes,12));chunks.push(bytes);
      },error:e=>{status.textContent=String(e);}});
      encoder.configure({codec:'vp09.00.10.08',width:canvas.width,height:canvas.height,bitrate:14000000,framerate:30,latencyMode:'realtime',hardwareAcceleration:'prefer-software'});
      for(let index=0;index<target;index++){
        if(index%6===0)await stepSimulation(trailerClock.speed);
        const t=index/(target-1);framePose(t);
        trailerClock.timeMs+=1000/30;
        const frame=await new Promise<VideoFrame>(resolve=>{trailerClock.onFrame=()=>{
          trailerClock.onFrame=null;
          // Snapshot before browser compositing discards the WebGPU swap texture.
          captureContext.drawImage(canvas,0,0);
          const pixels=captureContext.getImageData(0,0,canvas.width,canvas.height);
          resolve(new VideoFrame(pixels.data,{format:'RGBA',codedWidth:canvas.width,codedHeight:canvas.height,timestamp:Math.round(index*1e6/30),duration:Math.round(1e6/30)}));
        };trailerClock.pending=true;});
        encoder.encode(frame,{keyFrame:index%60===0});frame.close();
        if(index%15===0)status.textContent=`Recording ${name} · ${index+1}/${target} frames`;
        if(encoder.encodeQueueSize>5)await encoder.flush();
      }
      await encoder.flush();encoder.close();
      const header=new ArrayBuffer(32),v=new DataView(header);new Uint8Array(header,0,4).set([68,75,73,70]);v.setUint16(6,32,true);new Uint8Array(header,8,4).set([86,80,57,48]);v.setUint16(12,canvas.width,true);v.setUint16(14,canvas.height,true);v.setUint32(16,30,true);v.setUint32(20,1,true);v.setUint32(24,target,true);
      status.textContent='Saving '+name;
      const response=await fetch(`http://127.0.0.1:5180/ivf/${name}-${Date.now()}`,{method:'POST',headers:{'Content-Type':'video/x-ivf'},body:new Blob([header,...chunks])});
      if(!response.ok)throw new Error('Capture save failed');
      await saveAudit('capture-'+name);
      status.textContent=`Saved ${name} · ${target} frames · 30 fps`;
    }catch(e){status.textContent=String(e);console.error(e);throw e;}finally{trailerClock.pending=false;trailerClock.onFrame=null;Object.assign(scene.camera,projection);scene.resize();camera.setInputEnabled(true);}
  };
  panel.querySelector<HTMLButtonElement>('[data-record]')!.onclick=async()=>{if(busy)return;busy=true;try{await recordShot(select.value);}catch{}finally{busy=false;}};
  const saveAudit=async(name:string)=>{await fetch('http://127.0.0.1:5180/json/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(audit(),(_k,v)=>typeof v==='bigint'?v.toString():v)});};
  const recordBattle=async(names=['battle_street','battle_wide','battle_mid'])=>{
    await readyConnection();trailerClock.speed=1;
    await saveAudit('battle-start-100-vs-100');
    const c=getConnection()!;const companies=[...c.db.military_company.iter()].sort((a,b)=>Number(a.id-b.id));
    const enemies=combatants().filter(a=>a.faction===1&&a.health>0);
    for(let i=0;i<companies.length;i++){const company=companies[i];const members=combatants().filter(a=>a.faction>=3&&a.raidId===company.id&&a.health>0);const ids=members.map(a=>Number(a.id));if(!ids.length)continue;const target=enemies.reduce((best,a)=>Math.hypot(a.x-members[0].x,a.z-members[0].z)<Math.hypot(best.x-members[0].x,best.z-members[0].z)?a:best);await call('set_military_tactics',[Number(company.id),true,[3,7,10].includes(company.kind)]);await call('command_militia',[ids,target.x,target.z,0,Number(target.id)]);}
    await call('set_game_speed',[0]);
    for(let step=0;step<80;step++){
      status.textContent=`Armies closing · simulation step ${step+1}`;
      await stepSimulation();
      // Let the subscription deliver the committed positions before selecting the duel.
      await new Promise(r=>setTimeout(r,70));
      if((fightingPair()?.distance??100)<2.5)break;
    }
    for(const name of names)await recordShot(name);
    await saveAudit('battle-end');status.textContent='All footage saved. World paused.';
  };
  const reviseMilitary=async()=>{
    status.textContent='Preparing corrected military footage';
    await call('trailer_calm',[]);await call('trailer_battle',[0,250,0]);
    await new Promise(r=>setTimeout(r,1500));clearArena();
    await saveAudit('army-100');
    await recordShot('muster_close');await recordShot('muster_wide');
    await call('trailer_battle',[1,250,34]);await new Promise(r=>setTimeout(r,1500));
    await recordBattle();
  };
  const produce=async(resume=false,skipBuild=false)=>{
    const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
    await readyConnection();
    if(!resume){await author(0);await wait(2500);await recordShot('founding');await author(1);await wait(2500);await recordShot('hamlet');}
    if(!skipBuild){status.textContent='Building the full town';await author(2);await wait(5000);
      await readyConnection();await saveAudit('economy-before');trailerClock.speed=8;
      for(let i=0;i<60;i++){status.textContent=`Growing the economy at 8× · ${i+1}/60`;await stepSimulation(8);await renderFrame();}
    }
    await saveAudit('economy-after');
    for(const name of ['farms','industry','city_wide','city_street','market'])await recordShot(name);
    status.textContent='Mustering 100 soldiers';await call('trailer_battle',[0,250,0]);await wait(4000);await saveAudit('army-100');
    await recordShot('muster_wide');await recordShot('muster_close');
    status.textContent='Staging the Ottoman battle';await call('trailer_battle',[1,250,34]);await wait(2000);await recordBattle();
  };
  button('Produce full trailer',()=>produce());
  button('Finish city and battle',()=>produce(true));
  button('Record built village',()=>produce(true,true));
  button('Record battle only',recordBattle);
  button('Replace military footage',reviseMilitary);
  button('Finish wide battle',async()=>{
    await call('trailer_calm',[]);await call('trailer_battle',[0,250,0]);
    await new Promise(r=>setTimeout(r,1800));
    await call('trailer_battle',[1,250,34]);await new Promise(r=>setTimeout(r,1800));
    await recordBattle(['battle_wide']);
  });
  if(new URLSearchParams(location.search).has('produce')){
    const requested=new URLSearchParams(location.search).get('produce')??'battle';
    const ready=setInterval(()=>{const c=getConnection();const loaded=c&&Number(c.db.world_config.count())>0&&(requested!=='battle'||(Number(c.db.military_company.count())>=14&&Number(c.db.combat_agent.count())>=200));if(getConnectionToken()&&loaded&&!busy){clearInterval(ready);history.replaceState(null,'',location.pathname+'?trailer=1');busy=true;void (requested==='revision'?reviseMilitary():requested==='battle'?recordBattle():produce(!['1','v3'].includes(requested),requested==='capture')).catch(e=>{status.textContent=String(e);console.error(e);}).finally(()=>{busy=false;});}},1500);
  }
}

function makePlan(scene:SceneManager, stage:number){
  const nodes:{id:string,position:number[]}[]=[];const edges:unknown[]=[];const lookup=new Map<string,string>();
  const at=(x:number,z:number)=>[x,scene.terrain.getHeightAt(x,z),z];
  const node=(x:number,z:number)=>{const k=`${x},${z}`;if(lookup.has(k))return lookup.get(k)!;const id=`n${nodes.length+1}`;nodes.push({id,position:at(x,z)});lookup.set(k,id);return id;};
  const road=(x1:number,z1:number,x2:number,z2:number,width=4.2)=>{
    const a=node(x1,z1),b=node(x2,z2),length=Math.hypot(x2-x1,z2-z1),n=Math.ceil(length/4);
    const path=Array.from({length:n+1},(_,i)=>at(x1+(x2-x1)*i/n,z1+(z2-z1)*i/n));
    edges.push({id:`e${edges.length+1}`,startNodeId:a,endNodeId:b,width,controlPoints:[at(x1,z1),at(x2,z2)],sampledPath:path,length,revision:1});
  };
  const xs=[-270,-175,-80,80,175,320],zs=[-200,-130,-60,0,65,135];
  if(stage>0){
    for(const z of zs)for(let i=0;i<xs.length-1;i++)road(xs[i],z,xs[i+1],z,z===0?6:4.2);
    for(const x of xs.slice(0,-1))for(let i=0;i<zs.length-1;i++)road(x,zs[i],x,zs[i+1]);
  }
  const zones:{x:number,z:number,width:number,depth:number,count:number}[]=[];
  const blocks=[[-163,-55],[-163,5],[-163,70],[-68,-125],[-68,-55],[88,-125],[88,-55],[88,5],[88,70],[-68,70],[-163,-125],[-68,-195]];
  for(const [i,b]of blocks.entries())if(stage>1||i<2)zones.push({x:b[0],z:b[1],width:72,depth:34,count:6});
  const buildings:{kind:string,x:number,z:number,yaw:number,labor:number}[]=[];
  const add=(kind:string,x:number,z:number,labor:number=1,yaw=0)=>buildings.push({kind,x,z,labor,yaw});
  if(stage>=1){add('well',-70,12,0);add('marketplace',-28,-16,2);add('woodcutters_lodge',-220,14,2);add('lumber_mill',-249,14,2);add('granary',-45,20,3);add('chapel',23,-22,2);}
  if(stage>=2){
    add('town_hall',20,26,3);add('tavern',55,-16,2);add('village_storehouse',-219,-17,3);add('trading_post',-251,-17,2);
    add('well',77,9,0);add('well',-177,-114,0);add('well',80,116,0);add('well',-253,76,0);
    add('marketplace',-15,117,2);add('granary',22,117,3);add('bakery',-212,-78,3);add('windmill',-251,-86,2);add('threshing_barn',-225,-168,4);add('threshing_barn',-106,-215,4);
    add('smithy',-251,81,2);add('charcoal_burner',-220,82,2);add('potter_kiln',-219,116,2);add('carpenter',-252,116,2);
    add('weaver',-126,118,2);add('spinning_retting_house',-159,118,2);add('tannery',-206,45,2);add('cobbler',-118,45,2);
    add('smokehouse',-15,-145,2);add('brewery',22,-145,2);add('apiary',52,-151,2);add('chandlery',-151,-145,2);
    add('guardhouse',198,-16,2);add('cavalry_yard',218,-94,2);add('weaponsmith_armorer',198,-49,2);add('bowyer_fletcher',238,-49,2);
    add('stable',265,-89,2);add('watchtower',305,-16,1);add('watchtower',-280,-145,1);add('monastery',-65,180,5);
    add('pastoral_farmstead',15,-232,3);add('swineherd',75,-232,2);add('foragers_shed',-280,180,2);add('reforester',-300,100,1);
  }
  return{x:-55,z:28,tier:stage===0?0:stage===1?1:4,roads:JSON.stringify({nextNodeId:nodes.length+1,nextEdgeId:edges.length+1,nodes,edges}),zones:stage===0?[]:zones,buildings};
}
