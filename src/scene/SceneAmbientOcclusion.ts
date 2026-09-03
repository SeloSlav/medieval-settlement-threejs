import * as THREE from 'three';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';
import type { SceneAtmosphere } from './SceneAtmosphere.ts';
import { sceneTsl, type SceneNode } from './sceneTsl.ts';

const { Fn, diffuseColor, materialAO, max, min, mix, mrt, normalView, normalWorld, output, reference, vec3, vec4 } = sceneTsl;

export type SceneAmbientLights = { hemisphere: THREE.HemisphereLight; ambient: THREE.AmbientLight };

/** A single scene MRT supplies HDR color, normals, depth, and ambient irradiance.
 * Reconstruct only the hemispheric + ambient diffuse contribution; directional
 * sunlight, emissive materials, the sky and atmospheric inscattering are excluded.
 * Material AO and atmospheric transmittance are applied once to this estimate.
 * This is not a full deferred-lighting decomposition (e.g. indirect specular is
 * deliberately left untouched).
 */
export function createSceneAmbientOcclusion(
  sourcePass: unknown, camera: THREE.PerspectiveCamera,
  lights: SceneAmbientLights, atmosphere: SceneAtmosphere,
) {
  const scenePass = sourcePass as {
    setMRT(node: SceneNode): void;
    getTextureNode(name: string): SceneNode;
    getViewZNode(): SceneNode;
  };
  const hemi = lights.hemisphere;
  const ambient = lights.ambient;
  const skyWeight = normalWorld.y.mul(0.5).add(0.5);
  const irradiance = mix(reference('groundColor', 'color', hemi), reference('color', 'color', hemi), skyWeight)
    .mul(reference('intensity', 'float', hemi))
    .add(reference('color', 'color', ambient).mul(reference('intensity', 'float', ambient)));
  const indirect = Fn((_, builder) => {
    const material = builder.material as THREE.MeshStandardMaterial & { lights?: boolean; aoNode?: typeof materialAO };
    if (!material.isMeshStandardMaterial && !material.lights) return vec4(0);
    return vec4(irradiance.mul(diffuseColor.rgb).mul(material.aoNode ?? materialAO)
      .mul(atmosphere.visibility).mul(1 / Math.PI), 1);
  })();
  scenePass.setMRT(mrt({ output, normal: vec4(normalView, 1), indirect }));
  const color = scenePass.getTextureNode('output');
  const normal = scenePass.getTextureNode('normal');
  const depth = scenePass.getTextureNode('depth');
  const ambientBuffer = scenePass.getTextureNode('indirect');
  const gather = ao(depth, normal, camera);
  gather.resolutionScale = 0.5;
  gather.radius.value = 3.2;
  gather.thickness.value = 1.6;
  gather.samples.value = 16;
  gather.distanceExponent.value = 1.4;
  gather.distanceFallOff.value = 0.9;
  gather.scale.value = 1.25;
  gather.useTemporalFiltering = false;
  const filter = denoise(gather.getTextureNode(), depth, normal, camera);
  filter.radius.value = 2;
  filter.depthPhi.value = 1;
  filter.normalPhi.value = 16;
  const visibility = (filter as unknown as SceneNode).r.clamp(0, 1);
  const indirectBounded = min(max(ambientBuffer.rgb, vec3(0)), color.rgb);
  const shaded = vec4(color.rgb.sub(indirectBounded.mul(visibility.oneMinus())), color.a);
  return {
    color: shaded, visibility, normal: normal.rgb.mul(0.5).add(0.5),
    depth: scenePass.getViewZNode().negate().div(600).clamp(0, 1),
    indirect: ambientBuffer,
    dispose: () => {
      (gather as unknown as { dispose(): void }).dispose();
      // DenoiseNode owns a generated noise texture but has no dispose method.
      filter.noiseNode.value.dispose();
    },
    settings: { radius: 3.2, thickness: 1.6, samples: 16, resolutionScale: 0.5, temporal: false },
  };
}
