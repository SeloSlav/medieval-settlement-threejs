import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  float,
  hash,
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
  add(value: TslNode): TslNode;
  sub(value: TslNode): TslNode;
  mul(value: TslNode): TslNode;
  y: TslNode;
  x: TslNode;
  z: TslNode;
};

const WATER_BODY_COLOR = vec3(0.29, 0.576, 0.659) as TslNode;
const WATER_FOAM_COLOR = vec3(0.949, 0.98, 0.969) as TslNode;
const WATER_BASE_OPACITY = 0.86;
const SHORE_LAP_MAX = 0.13;
const SHORE_FOAM_MAX = 0.82;

function buildRiverWaterShaderNodes() {
  const foamBaseAttr = attribute('foamBase', 'float') as TslNode;
  const featherAttr = attribute('featherAlpha', 'float') as TslNode;
  const simDeltaAttr = attribute('simDelta', 'float') as TslNode;

  const wx = positionLocal.x as TslNode;
  const wz = positionLocal.z as TslNode;
  const shoreMask = pow(foamBaseAttr, float(0.72) as TslNode) as TslNode;

  const lapA = sin(time.mul(2.35).add(wx.mul(0.34)).add(wz.mul(0.12)) as TslNode);
  const lapB = sin(time.mul(3.85).sub(wx.mul(0.21)).add(wz.mul(0.31)) as TslNode);
  const lapC = sin(time.mul(1.65).add(wx.mul(0.11)).sub(wz.mul(0.27)) as TslNode);
  const lap = shoreMask
    .mul(float(SHORE_LAP_MAX) as TslNode)
    .mul(lapA.mul(0.52).add(lapB.mul(0.33)).add(lapC.mul(0.15)) as TslNode) as TslNode;

  const rippleSeed = wx.mul(0.24).add(time.mul(0.38)).add(wz.mul(0.24)).sub(time.mul(0.31)) as TslNode;
  const ripple = hash(rippleSeed).sub(0.5).mul(shoreMask).mul(0.035) as TslNode;

  const positionNode = vec3(
    positionLocal.x,
    positionLocal.y.add(simDeltaAttr.add(lap).add(ripple)),
    positionLocal.z,
  ) as TslNode;

  const foamNoise = hash(wx.mul(0.42).add(time.mul(0.44)).add(wz.mul(0.42)).sub(time.mul(0.36)) as TslNode);
  const foamWave = sin(time.mul(4.4).add(wx.mul(0.19)).sub(wz.mul(0.16)) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamPulse = sin(time.mul(6.1).add(wx.mul(0.11)).sub(wz.mul(0.27)) as TslNode)
    .mul(0.5)
    .add(0.5) as TslNode;
  const foamStrength = min(
    float(SHORE_FOAM_MAX) as TslNode,
    pow(shoreMask, float(1.15) as TslNode).mul(
      float(0.34).add(foamNoise.mul(0.34)).add(foamWave.mul(0.24)).add(foamPulse.mul(0.22)) as TslNode,
    ) as TslNode,
  ) as TslNode;
  const colorNode = mix(WATER_BODY_COLOR, WATER_FOAM_COLOR, foamStrength) as TslNode;

  const edgeNoiseA = hash(wx.mul(0.36).add(time.mul(0.11)).add(wz.mul(0.36)).sub(time.mul(0.08)) as TslNode)
    .sub(0.5)
    .mul(0.2) as TslNode;
  const edgeNoiseB = hash(wx.mul(0.11).sub(7.4).add(wz.mul(0.11)).add(3.1) as TslNode)
    .sub(0.5)
    .mul(0.12) as TslNode;
  const animatedFeather = pow(
    smoothstep(float(0.02) as TslNode, float(1) as TslNode, featherAttr.add(edgeNoiseA).add(edgeNoiseB) as TslNode),
    float(0.76) as TslNode,
  ) as TslNode;
  const opacityNode = (float(WATER_BASE_OPACITY) as TslNode).mul(animatedFeather) as TslNode;

  return { positionNode, colorNode, opacityNode };
}

let sharedWaterMaterial: MeshStandardNodeMaterial | null = null;

export function getSharedRiverWaterMaterial(): MeshStandardNodeMaterial {
  if (!sharedWaterMaterial) {
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
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    material.positionNode = nodes.positionNode;
    material.colorNode = nodes.colorNode;
    material.opacityNode = nodes.opacityNode;
    sharedWaterMaterial = material;
  }
  return sharedWaterMaterial;
}

export function disposeSharedRiverWaterMaterial(): void {
  sharedWaterMaterial?.dispose();
  sharedWaterMaterial = null;
}
