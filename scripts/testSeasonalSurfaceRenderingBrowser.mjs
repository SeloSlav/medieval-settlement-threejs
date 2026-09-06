import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'artifacts/seasonal-rendering';
mkdirSync(out, {recursive:true});
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen(); let browser;
try {
  browser = await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
  const page = await browser.newPage({viewport:{width:960,height:640}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/seasonal-surface-probe',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));
  await page.goto(new URL('seasonal-surface-probe',server.resolvedUrls.local[0]).href);
  const result=await page.evaluate(async()=>{
    const {THREE,TSL}=await import('/scripts/fixtures/webgpuTestImports.ts');
    const {createPreferredRenderer}=await import('/src/scene/RendererBackend.ts');
    const {applySeedThreeAutumnColor}=await import('/src/vegetation/seedthree/seedThreeForestMaterial.ts');
    const {FarmFieldMarkers}=await import('/src/farming/FarmFieldMarkers.ts');
    const {orbitNearPlaneForHeight}=await import('/src/camera/CameraCurves.ts');
    const backend=await createPreferredRenderer(),renderer=backend.renderer;
    renderer.setSize(480,320);renderer.setPixelRatio(1);renderer.toneMapping=THREE.NoToneMapping;
    const target=new THREE.RenderTarget(480,320);
    const pixels=async(scene,camera)=>{
      renderer.setRenderTarget(target);renderer.render(scene,camera);
      const raw=await renderer.readRenderTargetPixelsAsync(target,0,0,480,320);
      const data=new Uint8Array(480*320*4),stride=Math.ceil(480*4/256)*256;
      for(let y=0;y<320;y++)data.set(raw.subarray(y*stride,y*stride+480*4),y*480*4);
      return data;
    };
    const encode=bytes=>{const c=document.createElement('canvas');c.width=480;c.height=320;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes),480,320),0,0);return c.toDataURL();};
    const images=[];
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x101010);
    // Bright leaf, the same leaf in baked shade, and neutral brown bark.
    const tex=new THREE.DataTexture(new Uint8Array([25,90,15,255,5,18,3,255,55,34,22,255]),3,1);
    tex.colorSpace=THREE.SRGBColorSpace;tex.needsUpdate=true;
    const autumn=TSL.uniform(0),snow=TSL.uniform(0);
    const mat=new THREE.MeshBasicNodeMaterial({map:tex});mat.colorNode=TSL.texture(tex).rgb;
    mat.userData.forestSeasonalAutumnColor=autumn;mat.userData.forestSnowCoverage=snow;
    applySeedThreeAutumnColor(mat,[1,.49,.025]);
    const geo=new THREE.PlaneGeometry(3,2);
    geo.setAttribute('aTreeOrigin',new THREE.InstancedBufferAttribute(new Float32Array([-2,2048,0,2,0,0]),3));
    const trees=new THREE.InstancedMesh(geo,mat,2),matrix=new THREE.Matrix4();
    trees.setMatrixAt(0,matrix.makeTranslation(-2,0,0));trees.setMatrixAt(1,matrix.makeTranslation(2,0,0));trees.instanceMatrix.needsUpdate=true;scene.add(trees);
    const camera=new THREE.OrthographicCamera(-4,4,2.666,-2.666,.1,20);camera.position.z=5;camera.lookAt(0,0,0);
    const summer=await pixels(scene,camera);autumn.value=1;
    const fall=await pixels(scene,camera);snow.value=1;
    const snowy=await pixels(scene,camera);
    const at=(p,x)=>Array.from(p.slice((160*480+x)*4,(160*480+x)*4+3));
    const colors={bright:{summer:at(summer,60),autumn:at(fall,60)},shaded:{summer:at(summer,120),autumn:at(fall,120)},bark:{summer:at(summer,180),autumn:at(fall,180)}};
    let evergreenDifference=0,snowDifference=0;
    for(let y=110;y<210;y++)for(let x=280;x<440;x++)for(let c=0;c<3;c++){const i=(y*480+x)*4+c;if(summer[i]!==fall[i])evergreenDifference++;}
    for(let i=0;i<summer.length;i++)if(summer[i]!==snowy[i])snowDifference++;
    images.push({name:'leaf-classification-summer',data:encode(summer)},{name:'leaf-classification-autumn',data:encode(fall)});
    const fields=new THREE.Scene();fields.background=new THREE.Color(0x555555);
    fields.add(new THREE.HemisphereLight(0xffffff,0xffffff,2));
    const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(50,100,20);fields.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(2400,2400),new THREE.MeshBasicNodeMaterial({color:0xff00ff}));ground.rotation.x=-Math.PI/2;fields.add(ground);
    const root=new THREE.Group();fields.add(root);
    const markers=new FarmFieldMarkers(root,()=>0,{rendererBackend:backend.kind});
    const field={id:'temporal-soil',farmsteadId:'test',corners:[{x:-42,z:-63},{x:42,z:-63},{x:42,z:63},{x:-42,z:63}],area:10584,averageSlopeDegrees:0,moisture:.4,fertility:.9,crop:'rye',nextCrop:'fallow',stage:'ploughing',stageProgress:1,priority:1,harvestCount:0,lastYield:0,currentYield:0};
    const assetsReady=new Promise(resolve=>{THREE.DefaultLoadingManager.onLoad=resolve;});
    markers.syncFields([field]);
    const soil=root.getObjectByName('Worked field soil');soil.removeFromParent();root.visible=false;fields.add(soil);
    await Promise.race([assetsReady,new Promise((_,reject)=>setTimeout(()=>reject(Error('Soil textures did not load')),15000))]);
    const perspective=new THREE.PerspectiveCamera(43,1.5,.1,2600),frames=[];
    for(const seed of [1,927]) {
      const yaw=seed===1?.58:1.13;
      for(let frame=0;frame<24;frame++) {
        const distance=frame<3?[100,450,900][frame]:450+(frame-3)*25;
        perspective.position.set(Math.sin(yaw)*Math.cos(.8)*distance,Math.sin(.8)*distance,Math.cos(yaw)*Math.cos(.8)*distance);
        perspective.near=orbitNearPlaneForHeight(perspective.position.y);perspective.updateProjectionMatrix();perspective.lookAt(0,0,0);perspective.updateMatrixWorld(true);
        const data=await pixels(fields,perspective);let holes=0;const mean=[0,0,0];let count=0;
        for(let z=-45;z<=45;z+=5)for(let x=-28;x<=28;x+=4) {
          const p=new THREE.Vector3(x,.08,z).project(perspective),px=Math.round((p.x+1)*240),py=Math.round((1-p.y)*160);
          if(px<1||px>478||py<1||py>318)continue;
          const i=(py*480+px)*4;const rgb=Array.from(data.slice(i,i+3));
          if(rgb[0]>200&&rgb[1]<30&&rgb[2]>200)holes++;
          for(let c=0;c<3;c++)mean[c]+=rgb[c];count++;
        }
        frames.push({seed,frame,distance,near:perspective.near,holes,mean:mean.map(x=>x/count)});
        if(frame<3)images.push({name:`fields-${seed}-${distance}`,data:encode(data)});
      }
    }
    markers.dispose();renderer.dispose();
    return {colors,evergreenDifference,snowDifference,frames,images,adapter:backend.adapterEvidence};
  });
  for(const image of result.images)writeFileSync(`${out}/${image.name}.png`,Buffer.from(image.data.split(',')[1],'base64'));
  delete result.images;writeFileSync(`${out}/regression.json`,JSON.stringify({result,errors},null,2));
  assert.deepEqual(errors,[]);
  for(const kind of ['bright','shaded']){const color=result.colors[kind];assert.ok(color.summer[1]>color.summer[0]);assert.ok(color.autumn[0]>color.autumn[1],`${kind} leaves must turn warm`);}
  assert.deepEqual(result.colors.bark.summer,result.colors.bark.autumn);
  assert.equal(result.evergreenDifference,0);assert.equal(result.snowDifference,0);
  assert.ok(result.frames.every(f=>f.holes===0),'terrain must never punch through the soil');
  for(const seed of [1,927]){const frames=result.frames.filter(f=>f.seed===seed&&f.frame>=3);for(let i=1;i<frames.length;i++)assert.ok(Math.max(...frames[i].mean.map((v,c)=>Math.abs(v-frames[i-1].mean[c])))<12,'zoom must not flash the field surface');}
  console.log(JSON.stringify({colors:result.colors,evergreenDifference:result.evergreenDifference,snowDifference:result.snowDifference,fieldFrames:result.frames.length,maxHoles:Math.max(...result.frames.map(f=>f.holes)),errors}));
}finally{await browser?.close();await server.close();}
