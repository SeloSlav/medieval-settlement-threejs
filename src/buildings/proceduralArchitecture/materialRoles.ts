import type { BuildingMaterialAtlasTile } from '../buildingMaterialAtlas.ts';
import type {
  BuildingDetailMaterialKey,
  BuildingMaterialKey,
} from '../buildingMaterials.ts';
import type {
  ProceduralBuildingPlan,
  ProceduralMaterialRole,
} from './catalog.ts';

export type ProceduralArchitectureAtlasTile = Exclude<
  BuildingMaterialAtlasTile,
  'mossy-surface' | 'turf-roof' | 'thatch-roof'
>;

export type ProceduralArchitectureDetailMaterialKey = Exclude<
  BuildingDetailMaterialKey,
  'foliage' | 'crop'
>;

export type ProceduralStructuralUse =
  | 'yard-and-floor-surface'
  | 'thermal-mass-covering'
  | 'foundation-and-plinth'
  | 'load-bearing-masonry'
  | 'masonry-infill'
  | 'masonry-trim'
  | 'hearth-and-firebox'
  | 'lime-render'
  | 'timber-frame'
  | 'load-bearing-timber-wall'
  | 'roof-frame'
  | 'roof-deck'
  | 'board-cladding'
  | 'door-and-shutter-joinery'
  | 'log-wall-courses'
  | 'roof-covering'
  | 'roof-ridge-and-cap'
  | 'temporary-shelter'
  | 'awning-and-fly'
  | 'basketry-and-wattle'
  | 'lightweight-screen'
  | 'hardware-and-fasteners'
  | 'decorative-metalwork';

export type ProceduralUvProjection =
  | 'world-planar'
  | 'surface-planar'
  | 'member-aligned'
  | 'course-aligned'
  | 'roof-course-aligned'
  | 'fabric-panel-aligned'
  | 'weave-aligned';

export type ProceduralUvAxis =
  | 'world-x'
  | 'world-z'
  | 'surface-horizontal'
  | 'surface-vertical'
  | 'member-length'
  | 'member-width'
  | 'roof-eave'
  | 'roof-slope'
  | 'fabric-weft'
  | 'fabric-warp'
  | 'weave-horizontal'
  | 'weave-vertical';

export type ProceduralCourseMode =
  | 'none'
  | 'irregular-rubble'
  | 'regular-masonry-bond'
  | 'horizontal-boards'
  | 'horizontal-log-courses'
  | 'overlapping-roof-courses'
  | 'sewn-fabric-panels'
  | 'basket-weave';

export type ProceduralCourseStagger = 'none' | 'half' | 'irregular';

export type ProceduralPhysicalUvPolicy = {
  readonly projection: ProceduralUvProjection;
  readonly uAxis: ProceduralUvAxis;
  readonly vAxis: ProceduralUvAxis;
  /** World metres represented by one complete atlas repeat in U and V. */
  readonly metersPerRepeat: readonly [u: number, v: number];
  readonly rotateWithMember: boolean;
  readonly course: {
    readonly mode: ProceduralCourseMode;
    readonly nominalHeightMeters: readonly [minimum: number, maximum: number] | null;
    readonly overlapMeters: number | null;
    readonly stagger: ProceduralCourseStagger;
  };
};

export type ProceduralMaterialEvidence = {
  readonly region: 'Gorski Kotar and Croatian Littoral';
  readonly period: 'circa 1550';
  readonly confidence: 'high' | 'medium' | 'low';
  readonly scope: 'baseline' | 'conditional' | 'exceptional';
  /** Concise rationale, not a substitute for an archival citation. */
  readonly note: string;
};

export type ProceduralMaterialRoleDefinition = {
  readonly sharedMaterialKeys: readonly BuildingMaterialKey[];
  readonly sharedDetailMaterialKeys: readonly ProceduralArchitectureDetailMaterialKey[];
  readonly atlasTiles: readonly ProceduralArchitectureAtlasTile[];
  readonly historicallyPermittedUses: readonly ProceduralStructuralUse[];
  readonly prohibitedUses: readonly ProceduralStructuralUse[];
  readonly uvPolicy: ProceduralPhysicalUvPolicy;
  readonly evidence: ProceduralMaterialEvidence;
};

const BASE_EVIDENCE = {
  region: 'Gorski Kotar and Croatian Littoral',
  period: 'circa 1550',
} as const;

/**
 * Serializable material grammar for the procedural architecture compiler.
 * Renderer keys are references only; this registry never constructs materials.
 */
export const PROCEDURAL_MATERIAL_ROLE_REGISTRY = {
  'packed-earth': {
    sharedMaterialKeys: [],
    sharedDetailMaterialKeys: ['earth'],
    atlasTiles: ['packed-earth'],
    historicallyPermittedUses: ['yard-and-floor-surface', 'thermal-mass-covering'],
    prohibitedUses: ['load-bearing-masonry', 'timber-frame', 'roof-covering'],
    uvPolicy: {
      projection: 'world-planar',
      uAxis: 'world-x',
      vAxis: 'world-z',
      metersPerRepeat: [2, 2],
      rotateWithMember: false,
      course: { mode: 'none', nominalHeightMeters: null, overlapMeters: null, stagger: 'none' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'baseline',
      note: 'Compacted soil is appropriate for work yards, temporary floors, and charcoal-clamp cover, but not for unsupported walls or a weather roof.',
    },
  },
  fieldstone: {
    sharedMaterialKeys: ['masonryMid', 'masonryDark'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['fieldstone-mortar', 'quarry-stone'],
    historicallyPermittedUses: ['foundation-and-plinth', 'load-bearing-masonry', 'masonry-infill', 'hearth-and-firebox'],
    prohibitedUses: ['timber-frame', 'board-cladding', 'roof-covering'],
    uvPolicy: {
      projection: 'course-aligned',
      uAxis: 'surface-horizontal',
      vAxis: 'surface-vertical',
      metersPerRepeat: [2.4, 2.4],
      rotateWithMember: false,
      course: { mode: 'irregular-rubble', nominalHeightMeters: [0.2, 0.48], overlapMeters: null, stagger: 'irregular' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'baseline',
      note: 'Abundant gathered and quarried stone suits damp-ground footings, low walling, hearths, and extraction works throughout the regional vernacular.',
    },
  },
  'limestone-ashlar': {
    sharedMaterialKeys: ['masonryLight'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['limestone-ashlar'],
    historicallyPermittedUses: ['foundation-and-plinth', 'load-bearing-masonry', 'masonry-trim'],
    prohibitedUses: ['yard-and-floor-surface', 'timber-frame', 'roof-covering'],
    uvPolicy: {
      projection: 'course-aligned',
      uAxis: 'surface-horizontal',
      vAxis: 'surface-vertical',
      metersPerRepeat: [2.4, 2.4],
      rotateWithMember: false,
      course: { mode: 'regular-masonry-bond', nominalHeightMeters: [0.28, 0.52], overlapMeters: null, stagger: 'half' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'medium',
      scope: 'conditional',
      note: 'Dressed limestone is credible for prosperous civic or ecclesiastical plinths, portals, quoins, and trim, not as the settlement-wide default wall fabric.',
    },
  },
  'lime-plaster': {
    sharedMaterialKeys: ['plasterWhite', 'plasterYellow', 'plasterGrey', 'plasterOrange'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['lime-plaster'],
    historicallyPermittedUses: ['lime-render', 'masonry-infill'],
    prohibitedUses: ['foundation-and-plinth', 'load-bearing-masonry', 'timber-frame', 'roof-covering'],
    uvPolicy: {
      projection: 'surface-planar',
      uAxis: 'surface-horizontal',
      vAxis: 'surface-vertical',
      metersPerRepeat: [2.6, 2.6],
      rotateWithMember: false,
      course: { mode: 'none', nominalHeightMeters: null, overlapMeters: null, stagger: 'none' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'baseline',
      note: 'Lime-rich render over masonry or daub is suitable for protected wall faces; weathering belongs near splash zones and exposed frame edges.',
    },
  },
  'rough-timber': {
    sharedMaterialKeys: ['timberDark', 'timberMid', 'timberLight'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['rough-hewn-timber', 'sawn-planks'],
    historicallyPermittedUses: ['timber-frame', 'roof-frame', 'door-and-shutter-joinery'],
    prohibitedUses: ['load-bearing-masonry', 'lime-render', 'roof-covering'],
    uvPolicy: {
      projection: 'member-aligned',
      uAxis: 'member-length',
      vAxis: 'member-width',
      metersPerRepeat: [2, 2],
      rotateWithMember: true,
      course: { mode: 'none', nominalHeightMeters: null, overlapMeters: null, stagger: 'none' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'baseline',
      note: 'Local softwood and hardwood members are the primary frame, roof, door, and work-yard vocabulary; grain must follow each member rather than world axes.',
    },
  },
  'weathered-boards': {
    sharedMaterialKeys: ['timberWeathered'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['weathered-planks'],
    historicallyPermittedUses: ['board-cladding', 'roof-deck', 'door-and-shutter-joinery'],
    prohibitedUses: ['load-bearing-masonry', 'timber-frame', 'roof-covering'],
    uvPolicy: {
      projection: 'course-aligned',
      uAxis: 'member-length',
      vAxis: 'surface-vertical',
      metersPerRepeat: [2, 2],
      rotateWithMember: true,
      course: { mode: 'horizontal-boards', nominalHeightMeters: [0.18, 0.34], overlapMeters: 0.025, stagger: 'irregular' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'baseline',
      note: 'Rough boarded siding and service joinery are appropriate on sheds and ancillary ranges; boards are cladding or decking, not a substitute for the frame.',
    },
  },
  'stacked-logs': {
    sharedMaterialKeys: ['stackedTimber'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['stacked-log-wall'],
    historicallyPermittedUses: ['log-wall-courses', 'load-bearing-timber-wall'],
    prohibitedUses: ['lime-render', 'board-cladding', 'roof-covering'],
    uvPolicy: {
      projection: 'course-aligned',
      uAxis: 'surface-horizontal',
      vAxis: 'surface-vertical',
      metersPerRepeat: [2, 2],
      rotateWithMember: true,
      course: { mode: 'horizontal-log-courses', nominalHeightMeters: [0.2, 0.36], overlapMeters: null, stagger: 'half' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'medium',
      scope: 'conditional',
      note: 'Horizontal log walling is plausible for selected upland service or domestic ranges, but should not overwrite the broader frame, daub, stone, and boarded vocabulary.',
    },
  },
  'split-shingles': {
    sharedMaterialKeys: ['shingle'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['split-shingles'],
    historicallyPermittedUses: ['roof-covering', 'roof-ridge-and-cap'],
    prohibitedUses: ['timber-frame', 'load-bearing-masonry', 'board-cladding'],
    uvPolicy: {
      projection: 'roof-course-aligned',
      uAxis: 'roof-eave',
      vAxis: 'roof-slope',
      metersPerRepeat: [2.2, 2.2],
      rotateWithMember: false,
      course: { mode: 'overlapping-roof-courses', nominalHeightMeters: [0.16, 0.26], overlapMeters: 0.09, stagger: 'irregular' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'baseline',
      note: 'Split softwood shingles are the project baseline for steep wet-climate roofs in this period and region; subordinate roofs inherit the same course logic.',
    },
  },
  'clay-tiles': {
    sharedMaterialKeys: ['clayRed', 'clayDark'],
    sharedDetailMaterialKeys: ['firedClay'],
    atlasTiles: ['clay-roof-tiles', 'fired-clay'],
    historicallyPermittedUses: ['roof-covering', 'roof-ridge-and-cap'],
    prohibitedUses: ['temporary-shelter', 'awning-and-fly', 'timber-frame'],
    uvPolicy: {
      projection: 'roof-course-aligned',
      uAxis: 'roof-eave',
      vAxis: 'roof-slope',
      metersPerRepeat: [2.2, 2.2],
      rotateWithMember: false,
      course: { mode: 'overlapping-roof-courses', nominalHeightMeters: [0.25, 0.38], overlapMeters: 0.08, stagger: 'half' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'medium',
      scope: 'conditional',
      note: 'Fired roof tile is reserved for prosperous civic and ecclesiastical work with supply and skilled laying; it is not the ordinary rural roof.',
    },
  },
  slate: {
    sharedMaterialKeys: ['slate'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['slate-roof'],
    historicallyPermittedUses: ['roof-covering', 'roof-ridge-and-cap', 'masonry-trim'],
    prohibitedUses: ['temporary-shelter', 'awning-and-fly', 'timber-frame'],
    uvPolicy: {
      projection: 'roof-course-aligned',
      uAxis: 'roof-eave',
      vAxis: 'roof-slope',
      metersPerRepeat: [2.2, 2.2],
      rotateWithMember: false,
      course: { mode: 'overlapping-roof-courses', nominalHeightMeters: [0.18, 0.3], overlapMeters: 0.08, stagger: 'irregular' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'low',
      scope: 'exceptional',
      note: 'Slate must be explicitly justified by the building plan and a credible supply context; it remains an exception rather than a regional default.',
    },
  },
  'linen-canvas': {
    sharedMaterialKeys: [],
    sharedDetailMaterialKeys: ['canvas'],
    atlasTiles: ['linen-canvas'],
    historicallyPermittedUses: ['temporary-shelter', 'awning-and-fly'],
    prohibitedUses: ['load-bearing-masonry', 'timber-frame', 'roof-frame', 'roof-covering'],
    uvPolicy: {
      projection: 'fabric-panel-aligned',
      uAxis: 'fabric-weft',
      vAxis: 'fabric-warp',
      metersPerRepeat: [1.2, 1.2],
      rotateWithMember: true,
      course: { mode: 'sewn-fabric-panels', nominalHeightMeters: [0.7, 1.4], overlapMeters: 0.035, stagger: 'none' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'conditional',
      note: 'Heavy linen cloth is appropriate for temporary camps, market awnings, and reversible processing flies, never as a permanent settlement roof or wall structure.',
    },
  },
  wicker: {
    sharedMaterialKeys: [],
    sharedDetailMaterialKeys: ['wicker'],
    atlasTiles: ['wicker-weave'],
    historicallyPermittedUses: ['basketry-and-wattle', 'lightweight-screen'],
    prohibitedUses: ['foundation-and-plinth', 'load-bearing-masonry', 'timber-frame', 'roof-covering'],
    uvPolicy: {
      projection: 'weave-aligned',
      uAxis: 'weave-horizontal',
      vAxis: 'weave-vertical',
      metersPerRepeat: [1.1, 1.1],
      rotateWithMember: true,
      course: { mode: 'basket-weave', nominalHeightMeters: [0.08, 0.2], overlapMeters: null, stagger: 'half' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'baseline',
      note: 'Split rods and woven panels suit baskets, creels, hurdles, and non-structural screens; weatherproof structure still belongs to timber, stone, plaster, or shingles.',
    },
  },
  'wrought-iron': {
    sharedMaterialKeys: ['metalIron'],
    sharedDetailMaterialKeys: [],
    atlasTiles: ['wrought-iron'],
    historicallyPermittedUses: ['hardware-and-fasteners', 'decorative-metalwork'],
    prohibitedUses: ['timber-frame', 'roof-frame', 'load-bearing-masonry', 'roof-covering'],
    uvPolicy: {
      projection: 'member-aligned',
      uAxis: 'member-length',
      vAxis: 'member-width',
      metersPerRepeat: [1.2, 1.2],
      rotateWithMember: true,
      course: { mode: 'none', nominalHeightMeters: null, overlapMeters: null, stagger: 'none' },
    },
    evidence: {
      ...BASE_EVIDENCE,
      confidence: 'high',
      scope: 'baseline',
      note: 'Forged straps, hinges, latches, nails, crosses, grilles, and small mechanisms are appropriate; large structural iron frames or sheet-metal roofs are not.',
    },
  },
} as const satisfies Record<ProceduralMaterialRole, ProceduralMaterialRoleDefinition>;

export type ProceduralMaterialValidationCode =
  | 'unknown-material-role'
  | 'duplicate-material-role'
  | 'living-vegetation-material'
  | 'thatch-not-permitted'
  | 'missing-roof-covering'
  | 'canvas-roof-missing-canvas'
  | 'canvas-use-not-temporary'
  | 'roof-material-on-canvas-fly'
  | 'clay-tile-use-restricted'
  | 'slate-use-requires-explicit-plan'
  | 'ashlar-use-restricted';

export type ProceduralMaterialValidationIssue = {
  readonly severity: 'error';
  readonly code: ProceduralMaterialValidationCode;
  readonly role?: string;
  readonly message: string;
};

export type ProceduralMaterialValidationResult = {
  readonly valid: boolean;
  readonly issues: readonly ProceduralMaterialValidationIssue[];
};

const OPEN_ROOF_FORMS = ['none', 'canvas-fly', 'open-workyard'] as const;
const PERMANENT_ROOF_ROLES = ['split-shingles', 'clay-tiles', 'slate'] as const;
const LIVING_MATERIAL_PATTERN = /(?:^|[-_ ])(?:living-vegetation|foliage|crop|moss|grass-roof|turf-roof|plant-mesh)(?:$|[-_ ])/i;
const LIVING_MODULE_PATTERN = /(?:living-vegetation|foliage-mesh|crop-mesh|moss-cover|grass-roof|turf-roof|plant-mesh)/i;
const THATCH_PATTERN = /(?:^|[-_ ])(?:thatch|reed-roof|straw-roof)(?:$|[-_ ])/i;

function hasMaterialRole(
  materials: readonly string[],
  role: ProceduralMaterialRole,
): boolean {
  return materials.includes(role);
}

function isKnownMaterialRole(role: string): role is ProceduralMaterialRole {
  return Object.prototype.hasOwnProperty.call(PROCEDURAL_MATERIAL_ROLE_REGISTRY, role);
}

function containsVocabulary(plan: ProceduralBuildingPlan, vocabulary: RegExp): boolean {
  return [...plan.massing, ...plan.modules].some((value) => vocabulary.test(value));
}

/**
 * Validates the serializable material portion of a procedural building plan.
 * It intentionally operates on strings at runtime so deserialized or stale
 * plans cannot bypass the compile-time ProceduralMaterialRole union.
 */
export function validateProceduralBuildingPlanMaterials(
  plan: ProceduralBuildingPlan,
): ProceduralMaterialValidationResult {
  const issues: ProceduralMaterialValidationIssue[] = [];
  const materials = plan.materials as readonly string[];
  const seen = new Set<string>();

  const addIssue = (
    code: ProceduralMaterialValidationCode,
    message: string,
    role?: string,
  ): void => {
    issues.push({ severity: 'error', code, role, message });
  };

  for (const role of materials) {
    if (seen.has(role)) {
      addIssue('duplicate-material-role', `${plan.kind} repeats material role ${role}.`, role);
    }
    seen.add(role);
    if (LIVING_MATERIAL_PATTERN.test(role)) {
      addIssue(
        'living-vegetation-material',
        `${plan.kind} assigns living vegetation to architecture; SeedThree owns plants and crops.`,
        role,
      );
    }
    if (THATCH_PATTERN.test(role)) {
      addIssue(
        'thatch-not-permitted',
        `${plan.kind} requests thatch; split softwood shingles are the regional circa-1550 default.`,
        role,
      );
    }
    if (!isKnownMaterialRole(role)) {
      addIssue('unknown-material-role', `${plan.kind} uses unknown material role ${role}.`, role);
    }
  }

  for (const module of plan.modules) {
    if (LIVING_MODULE_PATTERN.test(module)) {
      addIssue(
        'living-vegetation-material',
        `${plan.kind} module ${module} bakes living vegetation into architecture; use a runtime SeedThree slot.`,
      );
    }
    if (THATCH_PATTERN.test(module)) {
      addIssue(
        'thatch-not-permitted',
        `${plan.kind} module ${module} uses thatch instead of the split-shingle baseline.`,
      );
    }
  }
  if (THATCH_PATTERN.test(plan.roof)) {
    addIssue(
      'thatch-not-permitted',
      `${plan.kind} uses a thatched roof form instead of the split-shingle baseline.`,
    );
  }

  const openRoof = (OPEN_ROOF_FORMS as readonly string[]).includes(plan.roof);
  const hasPermanentRoofMaterial = PERMANENT_ROOF_ROLES.some((role) =>
    hasMaterialRole(materials, role));
  if (!openRoof && !hasPermanentRoofMaterial) {
    addIssue(
      'missing-roof-covering',
      `${plan.kind} has ${plan.roof} massing but no split-shingle, restricted clay-tile, or restricted slate covering.`,
    );
  }

  const hasCanvas = hasMaterialRole(materials, 'linen-canvas');
  if (plan.roof === 'canvas-fly' && !hasCanvas) {
    addIssue(
      'canvas-roof-missing-canvas',
      `${plan.kind} declares a canvas fly but omits linen-canvas from its material roles.`,
      'linen-canvas',
    );
  }
  if (plan.roof === 'canvas-fly' && hasPermanentRoofMaterial) {
    addIssue(
      'roof-material-on-canvas-fly',
      `${plan.kind} mixes a canvas-fly roof contract with permanent tile, slate, or shingle covering.`,
    );
  }
  if (hasCanvas) {
    const temporaryOrOpen = plan.roof === 'canvas-fly'
      || plan.roof === 'open-workyard';
    const openSiteVocabulary = containsVocabulary(
      plan,
      /(?:temporary|open|camp|tent|fly|market|stall|awning)/i,
    );
    const reversibleSite = plan.status === 'site' && plan.roof === 'open-workyard';
    if (!temporaryOrOpen || (!openSiteVocabulary && !reversibleSite)) {
      addIssue(
        'canvas-use-not-temporary',
        `${plan.kind} uses linen canvas outside a temporary camp, open work site, or reversible market structure.`,
        'linen-canvas',
      );
    }
  }

  if (hasMaterialRole(materials, 'clay-tiles')) {
    const permittedFamily = plan.family === 'religious' || plan.family === 'civic';
    const permittedStatus = plan.status === 'major' || plan.status === 'landmark';
    if (!permittedFamily || !permittedStatus || openRoof) {
      addIssue(
        'clay-tile-use-restricted',
        `${plan.kind} uses clay tiles outside a major civic or ecclesiastical permanent roof.`,
        'clay-tiles',
      );
    }
  }

  if (hasMaterialRole(materials, 'slate')) {
    const explicitlyPlanned = containsVocabulary(plan, /slate/i)
      || /slate/i.test(plan.historicalNote);
    const permittedStatus = plan.status === 'major' || plan.status === 'landmark';
    if (!explicitlyPlanned || !permittedStatus || openRoof) {
      addIssue(
        'slate-use-requires-explicit-plan',
        `${plan.kind} uses exceptional slate without an explicit major-building plan and supply rationale.`,
        'slate',
      );
    }
  }

  if (hasMaterialRole(materials, 'limestone-ashlar')) {
    const permittedStatus = plan.status === 'major' || plan.status === 'landmark';
    const explicitlyRestrictedToTrim = containsVocabulary(
      plan,
      /(?:limestone|ashlar)[-_ ](?:niche|portal|opening|threshold|surround|trim|quoin)/i,
    );
    if (!permittedStatus && !explicitlyRestrictedToTrim) {
      addIssue(
        'ashlar-use-restricted',
        `${plan.kind} uses dressed limestone outside a major or landmark building without explicitly restricting it to small trim.`,
        'limestone-ashlar',
      );
    }
  }

  return { valid: issues.length === 0, issues };
}
