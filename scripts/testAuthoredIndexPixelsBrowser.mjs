import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();let browser;
try {
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/index-pixel-probe',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto(new URL('index-pixel-probe',server.resolvedUrls.local[0]).href);
  const result=await page.evaluate(async()=>{
    const {THREE}=await import('/scripts/fixtures/webgpuTestImports.ts');
    const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const {clone}=await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const {renderer}=await createPreferredRenderer();renderer.setSize(480,480);renderer.shadowMap.enabled=true;
    const scene=new THREE.Scene();scene.background=new THREE.Color(.15,.15,.15);scene.add(new THREE.HemisphereLight(0xffffff,0x777777,3));
    const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(3,6,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.1,far:20});scene.add(sun);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,12),new THREE.MeshStandardMaterial({color:0x888888}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
    const target=new THREE.RenderTarget(480,480),camera=new THREE.PerspectiveCamera(40,1,.01,30);const reports=[];
    for(const file of ['worker-male-common-01-v002.glb','worker-female-common-01-v001.glb']) {
      const asset=await new GLTFLoader().loadAsync(`/assets/models/villagers/${file}`),actual=clone(asset.scene),expected=clone(asset.scene);
      expected.traverse(o=>{if(!o.isMesh)return;o.geometry=o.geometry.clone();const a=o.geometry.index;if(!a)return;const original=a.array.slice();for(let i=0;i<a.count;i+=3)a.array.set(original.subarray(a.count-i-3,a.count-i),i);a.needsUpdate=true;});
      const bounds=new THREE.Box3().setFromObject(actual),scale=2/(bounds.max.y-bounds.min.y);
      for(const model of [actual,expected]){model.scale.setScalar(scale);model.position.y=-bounds.min.y*scale;model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(model);}
      const mixers=[new THREE.AnimationMixer(actual),new THREE.AnimationMixer(expected)];
      const clips=asset.animations.filter(c=>/idle|walk/i.test(c.name)&&!/combat|attack|weapon/i.test(c.name)).slice(0,2);
      if(!clips.length)throw new Error('Civilian animation missing');
      const pixels=async visible=>{actual.visible=visible;expected.visible=!visible;renderer.setRenderTarget(target);renderer.render(scene,camera);return renderer.readRenderTargetPixelsAsync(target,0,0,480,480);};
      let comparisons=0,maximumChangedPixels=0;
      for(const clip of clips)for(let view=0;view<4;view++) {
        for(const mixer of mixers){mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();action.time=clip.duration*(.13+view*.19);mixer.update(0);}
        camera.position.set(Math.sin(view*Math.PI/2)*4,2.3,Math.cos(view*Math.PI/2)*4);camera.lookAt(0,1,0);camera.updateMatrixWorld(true);
        await pixels(true);await pixels(false);const a=await pixels(true),b=await pixels(false);let changed=0;
        for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>12)changed++;
        maximumChangedPixels=Math.max(maximumChangedPixels,changed);comparisons++;
      }
      reports.push({file,comparisons,maximumChangedPixels,totalPixels:480*480});actual.removeFromParent();expected.removeFromParent();
    }
    target.dispose();renderer.dispose();return reports;
  });
  mkdirSync('artifacts/city-performance',{recursive:true});writeFileSync('artifacts/city-performance/model-index-pixels.json',JSON.stringify({result,errors},null,2));console.log(JSON.stringify({result,errors}));
  assert.deepEqual(errors,[]);for(const row of result)assert.ok(row.maximumChangedPixels<=10,'Triangle order must preserve authored appearance and shadows');
} finally {await browser?.close();await server.close();}
