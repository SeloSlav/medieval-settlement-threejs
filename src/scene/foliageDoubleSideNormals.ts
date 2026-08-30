import * as THREE from 'three';
import { normalViewGeometry } from 'three/tsl';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { chainMaterialShaderPatch } from './materialShaderPatch.ts';

const FOLIAGE_NORMAL_FRAGMENT_BEGIN = `
float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;

#ifdef FLAT_SHADED

	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );

#else

	vec3 normal = normalize( vNormal );

#endif

#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )

	#ifdef USE_TANGENT

		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );

	#else

		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);

	#endif

#endif

#ifdef USE_CLEARCOAT_NORMALMAP

	#ifdef USE_TANGENT

		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );

	#else

		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );

	#endif

#endif

vec3 nonPerturbedNormal = normal;
`;

const FOLIAGE_NORMALS_CACHE_KEY = 'foliage-double-side-normals-v1';

function patchFoliageDoubleSideNormalsShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  if (!shader.fragmentShader.includes('#include <normal_fragment_begin>')) return;

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_begin>',
    FOLIAGE_NORMAL_FRAGMENT_BEGIN,
  );
}

/**
 * Keep baked vertex normals on double-sided foliage instead of mirroring them on back faces.
 * See: https://discourse.threejs.org/t/backface-directional-lighting/7379
 */
export function applyFoliageDoubleSideNormals(material: THREE.Material): void {
  if (material.side !== THREE.DoubleSide) return;

  material.forceSinglePass = true;
  chainMaterialShaderPatch(material, FOLIAGE_NORMALS_CACHE_KEY, patchFoliageDoubleSideNormalsShader);
}

/** WebGPU/TSL variant: use geometry normals without backface negation. */
export function applyFoliageDoubleSideNormalsNode(material: MeshStandardNodeMaterial): void {
  if (material.side !== THREE.DoubleSide) return;

  material.forceSinglePass = true;
  material.normalNode = normalViewGeometry;
}
