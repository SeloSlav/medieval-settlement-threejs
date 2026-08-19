import * as THREE from 'three';
import {
  addMesh,
  sharedBuildingMaterial,
  stoneMaterial,
  timberMaterial,
} from '../buildingMaterials.ts';

export type FacadeFace =
  | 'positive-z'
  | 'negative-z'
  | 'positive-x'
  | 'negative-x';

type FacadeOpeningBaseOptions = {
  position: THREE.Vector3;
  face: FacadeFace;
  width: number;
  height: number;
  namePrefix?: string;
};

export type ProceduralWindowOptions = FacadeOpeningBaseOptions & {
  paneMaterial?: THREE.Material;
  frameMaterial?: THREE.Material;
  sillMaterial?: THREE.Material;
  shutterMaterial?: THREE.Material;
  shutters?: boolean;
};

export type ProceduralDoorOptions = FacadeOpeningBaseOptions & {
  revealMaterial?: THREE.Material;
  leafMaterial?: THREE.Material;
  frameMaterial?: THREE.Material;
  thresholdMaterial?: THREE.Material;
  hardwareMaterial?: THREE.Material;
  doubleLeaf?: boolean;
};

export type ProceduralWindowParts = {
  root: THREE.Group;
  reveal: THREE.Mesh;
  pane: THREE.Mesh;
  frame: THREE.Mesh[];
  shutters: THREE.Mesh[];
};

export type ProceduralDoorParts = {
  root: THREE.Group;
  reveal: THREE.Mesh;
  leaf: THREE.Mesh;
  frame: THREE.Mesh[];
  seams: THREE.Mesh[];
  hinges: THREE.Mesh[];
  latch: THREE.Mesh;
};

function orientFacadeRoot(root: THREE.Group, face: FacadeFace): void {
  if (face === 'negative-z') root.rotation.y = Math.PI;
  else if (face === 'positive-x') root.rotation.y = Math.PI * 0.5;
  else if (face === 'negative-x') root.rotation.y = -Math.PI * 0.5;
}

function createOpeningRoot(
  parent: THREE.Group,
  options: FacadeOpeningBaseOptions,
  kind: 'door' | 'window',
): THREE.Group {
  const prefix = options.namePrefix ?? 'Building';
  const root = new THREE.Group();
  root.name = `${prefix} procedural ${kind} opening`;
  root.position.copy(options.position);
  orientFacadeRoot(root, options.face);
  root.userData.facadeOpeningKind = kind;
  root.userData.facadeOpeningFace = options.face;
  root.userData.facadeOpeningWidth = options.width;
  root.userData.facadeOpeningHeight = options.height;
  root.userData.hasCrossBars = false;
  parent.add(root);
  return root;
}

function tagPart(mesh: THREE.Mesh, name: string, role: string): THREE.Mesh {
  mesh.name = name;
  mesh.userData.facadeOpeningRole = role;
  return mesh;
}

/**
 * Builds a recessed glazed opening in a local façade frame. The glass remains
 * one clear surface; structure is carried by the perimeter casing and sill,
 * never by a generic cross over the pane.
 */
export function addProceduralWindow(
  parent: THREE.Group,
  options: ProceduralWindowOptions,
): ProceduralWindowParts {
  const {
    width,
    height,
    paneMaterial = sharedBuildingMaterial('glass'),
    frameMaterial = stoneMaterial('light'),
    sillMaterial = frameMaterial,
    shutterMaterial = timberMaterial('weathered'),
    shutters = false,
    namePrefix = 'Building',
  } = options;
  const root = createOpeningRoot(parent, options, 'window');
  const frameWidth = THREE.MathUtils.clamp(Math.min(width, height) * 0.14, 0.08, 0.14);
  const casingDepth = 0.13;

  const reveal = tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.055),
      sharedBuildingMaterial('interiorDark'),
      new THREE.Vector3(0, 0, -0.035),
    ),
    `${namePrefix} window shadowed reveal`,
    'window-reveal',
  );
  const pane = tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(width, height, 0.045),
      paneMaterial,
      new THREE.Vector3(0, 0, 0.012),
    ),
    `${namePrefix} clear window pane`,
    'window-pane',
  );

  const frame: THREE.Mesh[] = [];
  for (const side of [-1, 1] as const) {
    frame.push(tagPart(
      addMesh(
        root,
        new THREE.BoxGeometry(frameWidth, height + frameWidth * 2, casingDepth),
        frameMaterial,
        new THREE.Vector3(side * (width * 0.5 + frameWidth * 0.5), 0, 0.035),
      ),
      `${namePrefix} window ${side < 0 ? 'left' : 'right'} jamb`,
      'window-jamb',
    ));
  }
  frame.push(tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(width, frameWidth, casingDepth),
      frameMaterial,
      new THREE.Vector3(0, height * 0.5 + frameWidth * 0.5, 0.035),
    ),
    `${namePrefix} window lintel`,
    'window-lintel',
  ));
  frame.push(tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(width + frameWidth * 2.7, frameWidth, casingDepth + 0.12),
      sillMaterial,
      new THREE.Vector3(0, -height * 0.5 - frameWidth * 0.5, 0.085),
    ),
    `${namePrefix} projecting window sill`,
    'window-sill',
  ));

  const shutterMeshes: THREE.Mesh[] = [];
  if (shutters) {
    for (const side of [-1, 1] as const) {
      shutterMeshes.push(tagPart(
        addMesh(
          root,
          new THREE.BoxGeometry(width * 0.34, height * 0.92, 0.065),
          shutterMaterial,
          new THREE.Vector3(side * width * 0.72, 0, 0.055),
        ),
        `${namePrefix} open window shutter`,
        'window-shutter',
      ));
    }
  }

  return { root, reveal, pane, frame, shutters: shutterMeshes };
}

/**
 * Builds a readable timber door without decorative cross bracing. Narrow seam
 * lines describe boards; compact hinge plates and a latch provide believable
 * hardware without obscuring the leaf.
 */
export function addProceduralDoor(
  parent: THREE.Group,
  options: ProceduralDoorOptions,
): ProceduralDoorParts {
  const {
    width,
    height,
    revealMaterial = sharedBuildingMaterial('interiorDark'),
    leafMaterial = timberMaterial('mid'),
    frameMaterial = stoneMaterial('light'),
    thresholdMaterial = stoneMaterial('mid'),
    hardwareMaterial = sharedBuildingMaterial('metalIron'),
    doubleLeaf = width >= 1.65,
    namePrefix = 'Building',
  } = options;
  const root = createOpeningRoot(parent, options, 'door');
  root.userData.doubleLeaf = doubleLeaf;
  const frameWidth = THREE.MathUtils.clamp(width * 0.13, 0.12, 0.2);

  const reveal = tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.055),
      revealMaterial,
      new THREE.Vector3(0, height * 0.5, -0.035),
    ),
    `${namePrefix} shadowed door reveal`,
    'door-reveal',
  );
  const leaf = tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(width, height, 0.09),
      leafMaterial,
      new THREE.Vector3(0, height * 0.5, 0.025),
    ),
    `${namePrefix} timber plank door leaf`,
    'door-leaf',
  );

  const frame: THREE.Mesh[] = [];
  for (const side of [-1, 1] as const) {
    frame.push(tagPart(
      addMesh(
        root,
        new THREE.BoxGeometry(frameWidth, height + frameWidth, 0.17),
        frameMaterial,
        new THREE.Vector3(side * (width * 0.5 + frameWidth * 0.5), height * 0.5, 0.025),
      ),
      `${namePrefix} door ${side < 0 ? 'left' : 'right'} jamb`,
      'door-jamb',
    ));
  }
  frame.push(tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(width + frameWidth * 2, frameWidth, 0.18),
      frameMaterial,
      new THREE.Vector3(0, height + frameWidth * 0.5, 0.025),
    ),
    `${namePrefix} door lintel`,
    'door-lintel',
  ));
  frame.push(tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(width + frameWidth * 1.2, 0.1, 0.25),
      thresholdMaterial,
      new THREE.Vector3(0, 0.05, 0.065),
    ),
    `${namePrefix} door threshold`,
    'door-threshold',
  ));

  const plankCount = THREE.MathUtils.clamp(Math.round(width / 0.3), 3, 9);
  const seams: THREE.Mesh[] = [];
  for (let seamIndex = 1; seamIndex < plankCount; seamIndex++) {
    const x = -width * 0.5 + width * (seamIndex / plankCount);
    seams.push(tagPart(
      addMesh(
        root,
        new THREE.BoxGeometry(0.012, height * 0.91, 0.012),
        revealMaterial,
        new THREE.Vector3(x, height * 0.5, 0.078),
      ),
      `${namePrefix} door vertical plank seam`,
      'door-plank-seam',
    ));
  }

  const hinges: THREE.Mesh[] = [];
  const hingeSides = doubleLeaf ? [-1, 1] as const : [1] as const;
  for (const side of hingeSides) {
    for (const y of [height * 0.28, height * 0.72]) {
      hinges.push(tagPart(
        addMesh(
          root,
          new THREE.BoxGeometry(Math.min(0.22, width * 0.18), 0.065, 0.035),
          hardwareMaterial,
          new THREE.Vector3(side * width * 0.38, y, 0.096),
        ),
        `${namePrefix} localized door hinge plate`,
        'door-hinge',
      ));
    }
  }

  const latchX = doubleLeaf ? width * 0.07 : -width * 0.31;
  const latch = tagPart(
    addMesh(
      root,
      new THREE.BoxGeometry(0.055, 0.22, 0.045),
      hardwareMaterial,
      new THREE.Vector3(latchX, height * 0.52, 0.104),
    ),
    `${namePrefix} door iron latch`,
    'door-latch',
  );

  return { root, reveal, leaf, frame, seams, hinges, latch };
}
