import {createWorldLayout} from './src/resources/WorldLayout.ts';
import {DEFAULT_WORLD_GENERATION_SETTINGS} from './src/world/worldGenerationSettings.ts';
import {createPhysicalDepositFootprints,polygonOverlapsPhysicalDeposit} from './src/resources/physicalDepositProtection.ts';
const blocks=[[-163,-55],[-163,5],[-163,70],[-68,-125],[-68,-55],[88,-125],[88,-55],[88,5],[88,70],[-68,70],[-163,-125],[-68,-195]];
for(let i=0;i<64;i++){
  const seed=0x4d50a350+i*97;
  let valid=true;
  for(const mapSize of ['small','large'] as const){
    const layout=createWorldLayout({...DEFAULT_WORLD_GENERATION_SETTINGS,seed,terrainPreset:'mrkopalj_polje',mapSize,topography:8,hydrology:0,forestDensity:28});
    const deposits=createPhysicalDepositFootprints(layout);
    if(blocks.some(([x,z])=>polygonOverlapsPhysicalDeposit([{x,z},{x:x+72,z},{x:x+72,z:z+34},{x,z:z+34}],deposits))){valid=false;break;}
  }
  if(valid){console.log(JSON.stringify({seed,hex:seed.toString(16)}));break;}
  if(i===63)throw Error('No common clear seed');
}
