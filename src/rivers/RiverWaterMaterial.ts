import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  float,
  min,
  mix,
  positionLocal,
  pow,
  sin,
  smoothstep,
  time,
  vec3,
} from 'three/tsl';

type TslNode = {
  add(value: TslNode | number): TslNode;
  sub(value: TslNode | number): TslNode;
  mul(value: TslNode | number): TslNode;
  y: TslNode;
  x: TslNode;
  z: TslNode;
};

const WATER_BODY_COLOR = vec3(0.2, 0.44, 0.52) as TslNode;
const WATER_FOAM_COLOR = vec3(0.84, 0.91, 0.9) as TslNode;
const WATER_BASE_OPACITY = 0.84;
const SHORE_LAP_MAX = 0.11;
const SHORE_FOAM_MAX = 0.68;

function buildRiverWaterShaderNodes() {
  const foamBaseAttr = attribute('foamBase', 'float') as TslNode;
  const featherAttr = attribute('featherAlpha', 'float') as TslNode;
  const simDeltaAttr = attribute('simDelta', 'float') as TslNode;
  const position = positionLocal as TslNode;
  const frameTime = time as TslNode;

  const wx = position.x;
  const wz = position.z;
  const shoreMask = pow(foamBaseAttr, float(1.05) as TslNode) as TslNode;
  const deepWater = pow(foamBaseAttr, float(2.4) as TslNode) as TslNode;

  const lapA = sin(
    frameTime.mul(2.35).add(wx.mul(0.34)).add(wz.mul(0.12)) as TslNode,
  ) as TslNode;
  const lapB = sin(
    frameTime.mul(3.85).sub(wx.mul(0.21)).add(wz.mul(0.31)) as TslNode,
  ) as TslNode;
  const lapC = sin(
    frameTime.mul(1.65).add(wx.mul(0.11)).sub(wz.mul(0.27)) as TslNode,
  ) as TslNode;
  const lap = shoreMask
    .mul(float(SHORE_LAP_MAX) as TslNode)
    .mul(lapA.mul(0.52).add(lapB.mul(0.33)).add(lapC.mul(0.15)) as TslNode) as TslNode;

  const rippleSeed = wx.mul(0.16).add(frameTime.mul(0.28)).add(wz.mul(0.16)).sub(frameTime.mul(0.22)) as TslNode;
  const ripple = (sin(rippleSeed) as TslNode).mul(0.5).sub(0.25).mul(shoreMask).mul(0.028) as TslNode;

  const positionNode = vec3(
    position.x,
    position.y.add(simDeltaAttr.add(lap).add(ripple)),
    position.z,
  ) as TslNode;

  const foamNoise = (sin(wx.mul(0.19).add(wz.mul(0.17)).add(frameTime.mul(0.44)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamWave = (sin(frameTime.mul(4.4).add(wx.mul(0.19)).sub(wz.mul(0.16)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamPulse = (sin(frameTime.mul(6.1).add(wx.mul(0.11)).sub(wz.mul(0.27)) as TslNode) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamStrength = min(
    float(SHORE_FOAM_MAX) as TslNode,
    (pow(shoreMask, float(1.45) as TslNode) as TslNode).mul(
      (float(0.14) as TslNode)
        .add(foamNoise.mul(0.26))
        .add(foamWave.mul(0.22))
        .add(foamPulse.mul(0.18)) as TslNode,
    ) as TslNode,
  ) as TslNode;
  const colorNode = (mix(WATER_BODY_COLOR, WATER_FOAM_COLOR, foamStrength) as TslNode).mul(
    (float(0.9) as TslNode).add(deepWater.mul(0.1) as TslNode) as TslNode,
  ) as TslNode;

  const edgeWobble = (sin(wx.mul(0.07).add(wz.mul(0.05)).add(frameTime.mul(0.55)) as TslNode) as TslNode)
    .mul(0.035)
    .mul(shoreMask) as TslNode;
  const animatedFeather = pow(
    smoothstep(float(0) as TslNode, float(1) as TslNode, featherAttr.add(edgeWobble) as TslNode) as TslNode,
    float(0.92) as TslNode,
  ) as TslNode;
  const opacityNode = (float(WATER_BASE_OPACITY) as TslNode).mul(animatedFeather) as TslNode;

  return { positionNode, colorNode, opacityNode };
}

let sharedWaterMaterial: MeshStandardNodeMaterial | null = null;

export function getSharedRiverWaterMaterial(): MeshStandardNodeMaterial {
  if (sharedWaterMaterial) return sharedWaterMaterial;

  const nodes = buildRiverWaterShaderNodes();
  const material = new MeshStandardNodeMaterial();
  material.name = 'RiverWaterMaterial';
  material.color.set(0xffffff);
  material.transparent = true;
  material.opacity = 1;
  material.roughness = 0.42;
  material.metalness = 0;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.positionNode = nodes.positionNode;
  material.colorNode = nodes.colorNode;
  material.opacityNode = nodes.opacityNode;
  sharedWaterMaterial = material;
  return sharedWaterMaterial;
}

export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
}
