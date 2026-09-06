import * as THREE from 'three';
import { addMesh, stoneMaterial, sharedBuildingMaterial, sharedBuildingDetailMaterial, timberMaterial, metalMaterial } from '../buildingMaterials.ts';
import { createProceduralRoofPanelGeometry } from '../proceduralArchitecture/geometryWriter.ts';

/** Dimensions are world metres. Bays and structural anchors drive every detail. */
export const CATHEDRAL_PLAN = {
  nave: { width: 8, depth: 22, z: -1, wallTop: 12, ridge: 16.3 },
  aisles: { outerX: 7.6, front: 6, rear: -12, eave: 5.8, ridge: 8.1 },
  towers: { x: 5.7, z: 8.1, width: 3.8, depth: 4.8, shoulder: 20, crown: 23, spire: 29 },
  bays: [-10.5, -7.5, -4.5, -1.5, 1.5, 4.5],
  buttresses: [-12, -9, -6, -3, 0, 3, 6],
} as const;

function lancet(width: number, height: number, x = 0, y = 0): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x - width / 2, y); s.lineTo(x + width / 2, y);
  s.lineTo(x + width / 2, y + height * .62);
  s.quadraticCurveTo(x + width * .45, y + height * .84, x, y + height);
  s.quadraticCurveTo(x - width * .45, y + height * .84, x - width / 2, y + height * .62);
  s.closePath(); return s;
}

function extrude(shape: THREE.Shape, depth: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth / 2); return g;
}

function box(parent: THREE.Group, name: string, size: readonly number[], pos: readonly number[], mat: THREE.Material): THREE.Mesh {
  const m = addMesh(parent, new THREE.BoxGeometry(size[0], size[1], size[2]), mat, new THREE.Vector3(...pos));
  m.name = name; return m;
}

function wall(parent: THREE.Group, name: string, span: number, height: number, position: number[], yaw: number,
  holes: { x: number; y: number; width: number; height: number }[], rose?: { y: number; radius: number }): void {
  const s = new THREE.Shape();
  s.moveTo(-span / 2, 0); s.lineTo(span / 2, 0); s.lineTo(span / 2, height); s.lineTo(-span / 2, height); s.closePath();
  for (const h of holes) s.holes.push(lancet(h.width, h.height, h.x, h.y));
  if (rose) { const h = new THREE.Path(); h.absarc(0, rose.y, rose.radius, 0, Math.PI * 2, true); s.holes.push(h); }
  const mesh = addMesh(parent, extrude(s, .42), stoneMaterial('light'), new THREE.Vector3(...position), new THREE.Euler(0, yaw, 0));
  mesh.name = name; mesh.userData.churchPhysicalApertureCount = holes.length + (rose ? 1 : 0);
}

function window(parent: THREE.Group, x: number, y: number, z: number, yaw: number, width: number, height: number): void {
  const g = new THREE.Group(); g.name = 'Cathedral traceried lancet opening';
  g.position.set(x,y,z); g.rotation.y = yaw;
  Object.assign(g.userData, { facadeOpeningKind: 'window', hasCrossBars: false, facadeOpeningWidth: width, facadeOpeningHeight: height });
  parent.add(g);
  const frame = lancet(width + .36, height + .28, 0, -.08);
  frame.holes.push(lancet(width, height));
  addMesh(g, extrude(frame, .28), stoneMaterial('mortar'), new THREE.Vector3()).name = 'Cathedral carved lancet archivolt';
  addMesh(g, extrude(lancet(width, height), .04), sharedBuildingMaterial('glass'), new THREE.Vector3(0,0,-.09)).name = 'Cathedral recessed window pane';
  // Paired narrow lights and a small trefoil, contained inside the opening.
  box(g, 'Cathedral slender stone tracery', [.06,height * .7,.08], [0,height * .35,.03], stoneMaterial('mortar'));
  const trefoil = addMesh(g, new THREE.TorusGeometry(width * .17,.04,5,12), stoneMaterial('mortar'), new THREE.Vector3(0,height * .76,.04));
  trefoil.name = 'Cathedral tracery eye';
}

function roof(parent: THREE.Group, name: string, origin: [number,number,number], eave: [number,number,number], slope: [number,number,number]): void {
  const m = addMesh(parent, createProceduralRoofPanelGeometry({
    semanticId: name, moduleId: 'cathedral-roof', materialRole: 'clay-tiles', structuralUse: 'roof-covering',
    eaveOrigin: origin, eaveVector: eave, slopeVector: slope, thickness: .18,
  }), sharedBuildingMaterial('clayDark'), new THREE.Vector3());
  m.name = name; m.userData.proceduralRoofShell = true;
}

function pinnacle(parent: THREE.Group, x: number, y: number, z: number, height = 1.6): void {
  box(parent, 'Cathedral pinnacle footing', [.65,.22,.65], [x,y,z], stoneMaterial('mortar'));
  const m = addMesh(parent, new THREE.ConeGeometry(.38,height,4), stoneMaterial('light'), new THREE.Vector3(x,y + height/2,z), new THREE.Euler(0,Math.PI/4,0));
  m.name = 'Cathedral stone pinnacle';
}

function addTower(parent: THREE.Group, side: number): void {
  const p = CATHEDRAL_PLAN.towers, x = side * p.x;
  const tower = new THREE.Group(); tower.name = `Cathedral ${side < 0 ? 'west' : 'east'} bell tower`; tower.position.set(x,0,p.z); parent.add(tower);
  box(tower, 'Cathedral tower stepped plinth', [4.15,.7,5.15], [0,.35,0], stoneMaterial('mid'));
  for (const face of [-1,1]) {
    wall(tower, 'Cathedral tower front and rear pierced shell', p.width, p.shoulder, [0,.6,face*p.depth/2], face > 0 ? 0 : Math.PI,
      [{x:0,y:5.7,width:.85,height:2.9},{x:0,y:12,width:1.1,height:3.5}]);
    for (const [y,w,h] of [[6.3,.85,2.9],[12.6,1.1,3.5]]) window(tower,0,y!,face*(p.depth/2+.23),face > 0 ? 0 : Math.PI,w!,h!);
    wall(tower,'Cathedral tower side pierced shell',p.depth,p.shoulder,[face*p.width/2,.6,0],face*Math.PI/2,
      [{x:0,y:5.7,width:.85,height:2.9},{x:0,y:12,width:1.1,height:3.5}]);
    for (const [y,w,h] of [[6.3,.85,2.9],[12.6,1.1,3.5]]) window(tower,face*(p.width/2+.23),y!,0,face*Math.PI/2,w!,h!);
  }
  for (const y of [.9,5.5,11.4,19.7,23]) box(tower,'Cathedral tower string course',[4.18,.25,5.18],[0,y,0],stoneMaterial('mortar'));
  for (const a of [-1,1]) for (const b of [-1,1]) {
    box(tower,'Cathedral tower corner pier',[.45,22.3,.45],[a*1.83,11.6,b*2.32],stoneMaterial('mortar'));
    pinnacle(tower,a*1.86,23.2,b*2.36);
  }
  // Bell stage has four real arched apertures with no opaque block behind them.
  for (const face of [-1,1]) {
    wall(tower,'Cathedral open bell-stage arch',p.width,3,[0,20,face*p.depth/2],face > 0 ? 0 : Math.PI,[{x:0,y:.05,width:2.65,height:2.65}]);
    wall(tower,'Cathedral open bell-stage side arch',p.depth,3,[face*p.width/2,20,0],face*Math.PI/2,[{x:0,y:.05,width:3.5,height:2.65}]);
  }
  box(tower,'Cathedral bell suspension beam',[3.4,.22,.32],[0,22.2,0],timberMaterial('dark'));
  const bell = addMesh(tower,new THREE.CylinderGeometry(.28,.69,1.05,12,1,true),sharedBuildingDetailMaterial('brass'),new THREE.Vector3(0,21.57,0));
  bell.name = 'Cathedral great bell';
  const spire = addMesh(tower,new THREE.ConeGeometry(2.95,6,4),sharedBuildingMaterial('clayDark'),new THREE.Vector3(0,26,0),new THREE.Euler(0,Math.PI/4,0));
  spire.scale.z = 1.22; spire.name = 'Cathedral steep tiled tower spire';
  box(tower,'Cathedral iron cross upright',[.12,1.25,.12],[0,29.25,0],metalMaterial('iron'));
  box(tower,'Cathedral iron cross arms',[.8,.12,.12],[0,29.45,0],metalMaterial('iron'));
}

function addFlyingButtress(parent: THREE.Group, side: number, z: number): void {
  const g = new THREE.Group(); g.name = 'Cathedral flying buttress assembly'; g.scale.x = side; g.position.z = z; parent.add(g);
  box(g,'Cathedral buttress foundation',[1.15,.7,1.25],[8.65,.35,0],stoneMaterial('mid'));
  box(g,'Cathedral outer buttress pier',[.8,7.9,.9],[8.65,4.6,0],stoneMaterial('light'));
  pinnacle(g,8.65,8.7,0,2);
  const s = new THREE.Shape();
  s.moveTo(4,10.95); s.quadraticCurveTo(6.2,10.9,8.7,8.3);
  s.lineTo(8.7,7.55); s.quadraticCurveTo(6.05,10.05,4,10.3); s.closePath();
  addMesh(g,extrude(s,.55),stoneMaterial('mortar'),new THREE.Vector3()).name = 'Cathedral curved flying arch';
  box(g,'Cathedral clerestory spring pier',[.5,3.8,.62],[4.08,10.15,0],stoneMaterial('mortar'));
}

export function createCathedralMesh(): THREE.Group {
  const root = new THREE.Group(); root.name = 'Cathedral';
  const g = new THREE.Group(); g.name = 'Cathedral procedural model'; root.add(g);
  root.userData.churchArchitecturePlan = CATHEDRAL_PLAN;
  const p = CATHEDRAL_PLAN;
  box(g,'Cathedral nave foundation',[8.5,.65,22.5],[0,.325,-1],stoneMaterial('mid'));
  // Lower nave arcade opens directly into the aisles; high windows sit above their roofs.
  for (const side of [-1,1]) {
    const holes = p.bays.flatMap(z=>[{x:z+1,y:.1,width:2.2,height:6.6},{x:z+1,y:8.05,width:1.3,height:2.8}]);
    wall(g,'Cathedral nave arcade and clerestory wall',22,11.4,[side*4,.6,-1],-Math.PI/2,holes);
    for (const z of p.bays) window(g,side*4.23,8.65,z,side*Math.PI/2,1.3,2.8);
    box(g,'Cathedral aisle floor',[3.6,.55,18],[side*5.8,.275,-3],stoneMaterial('mid'));
    wall(g,'Cathedral outer aisle pierced wall',18,5.2,[side*7.6,.6,-3],-Math.PI/2,
      p.bays.map(z=>({x:z+3,y:1.15,width:1.2,height:2.95})));
    for (const z of p.bays) window(g,side*7.84,1.75,z,side*Math.PI/2,1.2,2.95);
    for (const z of [6,-12]) {
      wall(g,'Cathedral aisle end closure',3.6,5.2,[side*5.8,.6,z],0,[]);
      const triangle = new THREE.Shape(); triangle.moveTo(-1.8,0);triangle.lineTo(1.8,0);triangle.lineTo(-side*1.8,2.3);triangle.closePath();
      addMesh(g,extrude(triangle,.4),stoneMaterial('light'),new THREE.Vector3(side*5.8,5.8,z)).name='Cathedral aisle roof end closure';
    }
    roof(g,'Cathedral aisle tiled lean-to roof',[side*7.85,5.77,side>0?6.2:-12.2],[0,0,side>0?-18.4:18.4],[-side*3.9,2.5,0]);
    roof(g,'Cathedral high nave tiled roof',[side*4.3,11.95,side>0?10.25:-12.25],[0,0,side>0?-22.5:22.5],[-side*4.3,4.4,0]);
    for(const z of p.buttresses) addFlyingButtress(g,side,z);
    addTower(g,side);
    box(g,'Cathedral continuous eaves cornice',[.48,.28,22.5],[side*4,11.85,-1],stoneMaterial('mortar'));
  }
  // The rose is cut through the front masonry, with stained petals in its reveal.
  wall(g,'Cathedral physical west front portal and rose',8,11.4,[0,.6,10],0,[{x:0,y:.08,width:2.65,height:4.8}],{y:8.05,radius:1.7});
  wall(g,'Cathedral rear choir window wall',8,11.4,[0,.6,-12],Math.PI,[{x:0,y:1.4,width:2.5,height:7.5}]);
  window(g,0,2,-12.24,Math.PI,2.5,7.5);
  for(const z of [10,-12]) {
    const s = new THREE.Shape();s.moveTo(-4,0);s.lineTo(4,0);s.lineTo(0,4.3);s.closePath();
    addMesh(g,extrude(s,.42),stoneMaterial('light'),new THREE.Vector3(0,12,z)).name='Cathedral high nave gable closure';
  }
  box(g,'Cathedral low ridge capping',[.22,.16,22.6],[0,16.4,-1],sharedBuildingMaterial('clayDark'));
  const portal = new THREE.Group(); portal.name='Cathedral processional portal';portal.position.set(0,.68,10.26);g.add(portal);
  Object.assign(portal.userData,{facadeOpeningKind:'door',hasCrossBars:false,facadeOpeningWidth:2.65,facadeOpeningHeight:4.8});
  for(let i=0;i<3;i++) {
    const s=lancet(3.05+i*.42,5.05+i*.28,0,-.08);s.holes.push(lancet(2.65+i*.42,4.8+i*.28));
    addMesh(portal,extrude(s,.25),stoneMaterial(i%2?'mortar':'light'),new THREE.Vector3(0,0,i*.19)).name='Cathedral nested processional archivolt';
  }
  addMesh(portal,extrude(lancet(2.65,4.8),.12),timberMaterial('dark'),new THREE.Vector3(0,0,-.12)).name='Cathedral double oak door';
  for(const y of [1.1,2.6]) for(const side of [-1,1]) box(portal,'Cathedral door iron strap',[.95,.09,.07],[side*.72,y,.02],metalMaterial('iron'));
  for(let i=0;i<4;i++) box(g,'Cathedral broad processional step',[5.8-i*.4,.16,1.6-i*.24],[0,.08+i*.16,11.6-i*.14],stoneMaterial('mid'));
  const rose = new THREE.Group();rose.name='Cathedral great rose window';rose.position.set(0,8.65,10.26);g.add(rose);
  Object.assign(rose.userData,{facadeOpeningKind:'window',hasCrossBars:false,facadeOpeningWidth:3.4,facadeOpeningHeight:3.4});
  for(const radius of [1.74,1.94]) addMesh(rose,new THREE.TorusGeometry(radius,.13,6,40),stoneMaterial('mortar'),new THREE.Vector3(0,0,.04)).name='Cathedral rose carved surround';
  addMesh(rose,new THREE.CircleGeometry(1.7,40),sharedBuildingMaterial('glass'),new THREE.Vector3(0,0,-.1)).name='Cathedral rose recessed glazing';
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6;
    const petal=addMesh(rose,new THREE.CircleGeometry(.23,8),sharedBuildingDetailMaterial(i%2?'paintBlue':'paintRed'),new THREE.Vector3(Math.sin(a)*1.18,Math.cos(a)*1.18,-.07));petal.scale.y=1.65;petal.rotation.z=-a;petal.name='Cathedral rose stained petal';
    const rib=box(rose,'Cathedral rose radial stone tracery',[.075,1.55,.1],[Math.sin(a)*.92,Math.cos(a)*.92,.03],stoneMaterial('mortar'));rib.rotation.z=-a;
  }
  addMesh(rose,new THREE.TorusGeometry(.38,.08,6,16),stoneMaterial('mortar'),new THREE.Vector3(0,0,.07)).name='Cathedral rose central eye';
  // The cathedra is the physical seat of the new bishop's office, visible through the choir window.
  box(g,'Cathedral raised bishop choir dais',[5,.5,3],[0,.9,-9.7],stoneMaterial('mortar'));
  box(g,'Cathedral bishop cathedra seat',[1.3,.2,1.15],[0,1.7,-10.2],timberMaterial('dark'));
  box(g,'Cathedral bishop cathedra carved back',[1.35,2.5,.22],[0,2.35,-10.7],timberMaterial('dark'));
  box(g,'Cathedral bishop purple seat cushion',[1.05,.12,.9],[0,1.86,-10.2],sharedBuildingDetailMaterial('paintRed'));
  for(const x of [-.6,.6]) box(g,'Cathedral cathedra arm support',[.15,.95,.9],[x,1.65,-10.2],timberMaterial('dark'));
  return root;
}
