/**
 * Common hornbeam (Carpinus betulus) maintained as a coppiced agricultural
 * hedge. This is a field-boundary shrub, not a miniature forest tree: several
 * upright stools start at ground level, fork densely, and interlock with the
 * neighbouring stools into a stock-resistant living edge.
 *
 * SeedThree does not currently ship dedicated European-hornbeam maps. The
 * existing smooth grey broadleaf bark and small beech leaf maps are the close
 * non-fruiting temperate assets already used by the Gorski Kotar hornbeam tree
 * adapter; the morphology below is newly authored for the field hedge.
 */
export const fieldHornbeamHedge = {
  name: 'Gorski Field Hornbeam Hedge',
  latin: 'Carpinus betulus',
  category: 'shrub',
  bark: 'american_beech_albedo.png',
  leaf: 'american_beech_single_albedo.png',
  biome: 'temperate',
  tileWorldSize: 0.42,
  plantSink: 0.018,
  foliageType: 'sprayClusters',
  foliage: {
    clustersPerBranch: 3,
    clusterSize: 0.22,
    clusterSizeVar: 0.24,
    clusterQuads: 2,
    alphaTest: 0.44,
    tint: 0xc9dfaa,
    transmit: [0.28, 0.42, 0.16],
    downAngle: 42,
    downAngleV: 12,
    droop: 7,
    startFrac: 0.16,
    parentSprays: 0.62,
    rotate: 137,
  },
  params: {
    trunks: 5,
    trunkSplayDeg: 21,
    firstForkHeight: 0.1,
    armLength: 0.24,
    armFalloff: 0.84,
    forkGenerations: 4,
    branchiness: 0.86,
    forkSpread: 25,
    forkTriChance: 0.12,
    curlUp: 0.38,
    armBend: 8,
    gnarliness: 9,
    continuationKink: 6,
    forkRadiusKeep: 0.78,
    trunkRadius: 0.012,
    trunkFlare: 1.2,
    branchRepel: 0.62,
    minRadius: 0.0024,
    radialSegs: 5,
    segCurveRes: 3,
    tileWorldSize: 0.42,
    windWeightScale: 0.18,
  },
};
