import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'artifacts/city-performance/spatial-terrain-draws';
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/terrain-draw-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('terrain-draw-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE, TSL } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { SpatialTerrainDraws } = await import('/src/multiplayer/SpatialTerrainDraws.ts');
    const { renderer, adapterEvidence } = await createPreferredRenderer();
    renderer.setSize(400, 280); renderer.shadowMap.enabled = true; renderer.info.autoReset = false;
    const target = new THREE.RenderTarget(400, 280); renderer.setRenderTarget(target);
    // Fourteen material textures plus depth/color shadow textures exercise the normal
    // 16-texture stage limit. Consolidation must introduce no extra samplers.
    const textures = Array.from({length:14}, (_, i) => {
      const texture = new THREE.DataTexture(new Uint8Array([60+i*7,140-i*4,70+i*5,255]),1,1);
      texture.needsUpdate = true; return texture;
    });
    const material = new THREE.MeshStandardNodeMaterial({roughness:.8});
    let color = TSL.vec3(0);
    for (const texture of textures) color = color.add(TSL.texture(texture, TSL.uv()).rgb.mul(1/14));
    material.colorNode = color.mul(TSL.attribute('color','vec3'));
    material.roughnessNode = TSL.attribute('wetness','float');
    const alternate = material.clone(); alternate.colorNode = color.mul(TSL.attribute('color','vec3')).mul(TSL.vec3(.7,1,.8));
    const pool = new SpatialTerrainDraws(material), reference = new THREE.Group();
    const scenes = [pool.group,reference].map(root => {
      const scene = new THREE.Scene(); scene.add(root); scene.background = new THREE.Color(0x263340);
      scene.fog = new THREE.FogExp2(0x8997a3,.00015);
      const sun = new THREE.DirectionalLight(0xffffff,2); sun.position.set(400,1400,600); sun.castShadow = true;
      Object.assign(sun.shadow.camera,{left:-1600,right:1600,top:1600,bottom:-1600,near:1,far:6000});
      sun.shadow.camera.updateProjectionMatrix(); sun.shadow.mapSize.set(512,512);
      const box = new THREE.Mesh(new THREE.BoxGeometry(100,180,100), new THREE.MeshStandardNodeMaterial({color:0xa45c46}));
      box.position.set(200,120,100); box.castShadow = true;
      scene.add(sun,box,new THREE.HemisphereLight(0xbccad6,0x6b6354,1)); return scene;
    });
    const sources = new Map();
    const makeTile = (id, extra=false) => {
      const side=17, stride=extra?13:12, data=new Float32Array(side*side*stride), indices=[];
      const ox=(id%48)*256-6144, oz=Math.floor(id/48)*256-6144;
      for(let z=0;z<side;z++)for(let x=0;x<side;x++) {
        const wx=ox+x*16,wz=oz+z*16,h=35*Math.sin(wx/400)*Math.cos(wz/360);
        const normal=new THREE.Vector3(-35/400*Math.cos(wx/400)*Math.cos(wz/360),1,35/360*Math.sin(wx/400)*Math.sin(wz/360)).normalize();
        const offset=(z*side+x)*stride;
        data.set([wx,h,wz,normal.x,normal.y,normal.z,.8+x/80,.9-z/100,.75,x/16,z/16,.65],offset);
        if(extra)data[offset+12]=.3;
        if(x<16&&z<16){const a=z*side+x,d=a+side;indices.push(a,d,a+1,a+1,d,d+1);}
      }
      const buffer=new THREE.InterleavedBuffer(data,stride),geometry=new THREE.BufferGeometry();
      for(const [name,size,offset]of[['position',3,0],['normal',3,3],['color',3,6],['uv',2,9],['wetness',1,11],...(extra?[['extraLayer',1,12]]:[])]) {
        geometry.setAttribute(name,new THREE.InterleavedBufferAttribute(buffer,size,offset));
      }
      geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;reference.add(mesh);
      return {mesh,buffer};
    };
    const add = (id, extra=false) => { const tile=makeTile(id,extra);sources.set(id,tile);pool.upsert(id,tile);pool.flush(); };
    const remove = id => { pool.remove(id);const tile=sources.get(id);tile.mesh.removeFromParent();tile.mesh.geometry.dispose();sources.delete(id);pool.flush(); };
    const camera=new THREE.PerspectiveCamera(50,400/280,1,12000);
    const view=(x,y,z,tx=128,tz=128)=>{camera.position.set(x,y,z);camera.lookAt(tx,0,tz);camera.updateMatrixWorld(true);};
    view(400,1900,2100);
    const render=async scene=>{renderer.info.reset();renderer.render(scene,camera);return{draws:renderer.info.render.drawCalls,
      triangles:renderer.info.render.triangles,pixels:await renderer.readRenderTargetPixelsAsync(target,0,0,400,280)};};
    const cases=[];
    const empty=await render(scenes[1]);
    const compare=async label=>{
      renderer._nodes.nodeFrame.update();
      const actual=await render(scenes[0]),expected=await render(scenes[1]);
      let changedPixels=0,maxDifference=0;
      for(let i=0;i<actual.pixels.length;i+=4){const difference=Math.abs(actual.pixels[i]-expected.pixels[i])+Math.abs(actual.pixels[i+1]-expected.pixels[i+1])+Math.abs(actual.pixels[i+2]-expected.pixels[i+2]);
        maxDifference=Math.max(maxDifference,difference);if(difference>6)changedPixels++;}
      cases.push({label,changedPixels,maxDifference,actualDraws:actual.draws,referenceDraws:expected.draws,
        actualTriangles:actual.triangles,referenceTriangles:expected.triangles,pool:pool.stats});
      if(label==='all-81-chunks') {
        let coverage=0;
        for(let i=0;i<actual.pixels.length;i+=4)if(Math.abs(actual.pixels[i]-empty.pixels[i])+Math.abs(actual.pixels[i+1]-empty.pixels[i+1])+Math.abs(actual.pixels[i+2]-empty.pixels[i+2])>6)coverage++;
        if(coverage<10000)throw Error('Terrain must visibly cover the fixed camera; matching empty images is insufficient');
        cases.at(-1).visibleTerrainPixels=coverage;
      }
    };
    const first=[];for(let z=20;z<24;z++)for(let x=20;x<24;x++)first.push(z*48+x);
    for(let i=0;i<first.length;i++){add(first[i]);if([0,3,4,7,8,15].includes(i))await compare('first-frame-growth-'+(i+1));}
    for(let z=20;z<29;z++)for(let x=20;x<29;x++){const id=z*48+x;if(!sources.has(id))add(id);}
    await compare('all-81-chunks');
    for(const [i,p]of[[550,380,700],[-500,800,-800],[2500,1600,1800],[1100,200,200],[-900,260,400]].entries()){
      view(...p);await compare('camera-first-frame-'+i);
    }
    const edited=first[5],tile=sources.get(edited);for(let i=0;i<tile.buffer.count;i++){tile.mesh.geometry.getAttribute('position').setY(i,180);tile.mesh.geometry.getAttribute('wetness').setX(i,.3);}
    tile.buffer.needsUpdate=true;tile.mesh.geometry.computeBoundingBox();tile.mesh.geometry.computeBoundingSphere();pool.upsert(edited,tile);pool.flush();await compare('height-and-wetness');
    remove(first[3]);await compare('dense-slot-removal');add(first[3]);await compare('cached-shape-return');
    for(const id of first.slice(0,8)){remove(id);add(id,true);}await compare('mixed-layouts');
    for(const id of first.slice(8)){remove(id);add(id,true);}await compare('completed-layout');
    for(const tile of sources.values())tile.mesh.material=alternate;pool.setMaterial(alternate);await compare('material-replacement');
    const beforeReturn=pool.stats.allocations;
    const nativeBuffers=new Map();
    for(const mesh of pool.group.children){const vertex=renderer.backend.get(mesh.geometry.getAttribute('position').data).buffer;
      const index=renderer.backend.get(mesh.geometry.index).buffer;if(vertex&&index)nativeBuffers.set(mesh,[vertex,index]);}
    for(const [id,tile]of sources){pool.remove(id);tile.mesh.removeFromParent();}
    pool.flush();await compare('paper-map-detachment');
    for(const [id,tile]of sources){tile.mesh.geometry.getAttribute('wetness').setX(0,.45);tile.buffer.needsUpdate=true;
      reference.add(tile.mesh);pool.upsert(id,tile);}
    pool.flush();await compare('cached-gpu-buffer-return');
    if(pool.stats.allocations!==beforeReturn)throw Error('Returning to the same region must reuse its GPU allocations');
    if(nativeBuffers.size<4)throw Error('GPU cache proof requires previously rendered cells');
    for(const [mesh,[vertex,index]]of nativeBuffers){if(renderer.backend.get(mesh.geometry.getAttribute('position').data).buffer!==vertex
      ||renderer.backend.get(mesh.geometry.index).buffer!==index)throw Error('Cached terrain must retain actual native GPUBuffer identities');}
    cases.at(-1).reusedNativeBuffers=nativeBuffers.size*2;
    for(const id of [...sources.keys()].filter((_,i)=>i%3===0))remove(id);await compare('multi-cell-eviction');
    const finalStats=pool.stats;pool.dispose();for(const tile of sources.values())tile.mesh.geometry.dispose();
    for(const scene of scenes)scene.traverse(object=>{if(object.isMesh&&object.geometry)object.geometry.dispose();});
    textures.forEach(t=>t.dispose());material.dispose();alternate.dispose();target.dispose();renderer.dispose();
    return {adapterEvidence,cases,finalStats};
  });
  writeFileSync(`${output}/report.json`,JSON.stringify({result,errors},null,2));
  console.log(JSON.stringify({cases:result.cases.length,maxChangedPixels:Math.max(...result.cases.map(c=>c.changedPixels)),
    fullView:result.cases.find(c=>c.label==='all-81-chunks'),cache:result.finalStats,errors}));
  assert.deepEqual(errors,[]);
  for(const test of result.cases)assert(test.changedPixels<=10,`${test.label}: native pixels changed`);
  const all=result.cases.find(test=>test.label==='all-81-chunks');
  assert(all.actualDraws<all.referenceDraws/3,'Spatial terrain must reduce native draws');
} finally {await browser?.close();await server.close();}
