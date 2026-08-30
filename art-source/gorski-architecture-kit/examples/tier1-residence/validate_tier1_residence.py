from __future__ import annotations

import json
import os
from pathlib import Path

import bmesh
import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_TIER1_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_REPORT = OUTPUT_ROOT / "out" / "tier1_residence_validation_v27.json"


def architecture_objects() -> list[bpy.types.Object]:
    return [
        obj
        for obj in bpy.data.objects
        if obj.get("t1_instance") and not obj.get("preview_only")
    ]


def triangle_count(obj: bpy.types.Object) -> int:
    if obj.type != "MESH":
        return 0
    return sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons)


def nonmanifold_edges(obj: bpy.types.Object) -> int:
    if obj.type != "MESH":
        return 0
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    count = sum(1 for edge in bm.edges if not edge.is_manifold)
    bm.free()
    return count


def main() -> None:
    objects = architecture_objects()
    meshes = [obj for obj in objects if obj.type == "MESH"]
    sources = [str(obj.get("source_component_id", "")) for obj in objects]
    unit_scale_violations = [
        obj.name
        for obj in objects
        if any(abs(value - 1.0) > 1.0e-6 for value in obj.scale)
    ]
    missing_metric_uv = [
        obj.name
        for obj in meshes
        if obj.data.uv_layers.get("GK_UV0") is None
    ]
    nonmanifold = {
        obj.name: count
        for obj in meshes
        if (count := nonmanifold_edges(obj)) > 0
    }
    material_tiles = sorted(
        {
            str(material.get("atlas_tile"))
            for obj in meshes
            for material in obj.data.materials
            if material is not None and material.get("atlas_tile")
        }
    )
    forbidden_tokens = ("vegetation", "crop", "firewoodpile", "smokeemitter", "windowglow")
    forbidden_authored_state = [
        obj.name
        for obj in bpy.data.objects
        if any(token in obj.name.lower() for token in forbidden_tokens)
    ]
    square_hole_walls = [source for source in sources if source == "assembly_custom_aperture_wall"]
    dark_apertures = [source for source in sources if source == "assembly_dark_unglazed_aperture"]
    window_inserts = [source for source in sources if source.startswith("opening_window_")]
    roof_panels = [source for source in sources if source.startswith("roof_shingle_panel_")]
    retopped_roof_skins = [source for source in sources if source == "assembly_custom_retopped_shingle_skin"]
    applied_eave_trim = [source for source in sources if source.startswith("roof_shingle_eave_edge_")]
    roof_aperture_panels = [obj for obj in meshes if obj.get("roof_aperture_id") == "tier1-smoke-exit"]
    surface_smoke_meshes = [source for source in sources if source == "assembly_dark_roof_smoke_opening"]
    foundation_corners = [source for source in sources if source == "foundation_corner_fieldstone_h0p35m"]
    roof_triangles = sum(
        triangle_count(obj)
        for obj in meshes
        if str(obj.get("source_component_id", "")).startswith(
            ("roof_shingle_", "roof_thatch_smoke_vent", "assembly_custom_retopped_shingle_skin")
        )
    )
    total_triangles = sum(triangle_count(obj) for obj in meshes)

    checks = {
        "allInstanceScalesAreOne": not unit_scale_violations,
        "allMeshesHaveMetricUv": not missing_metric_uv,
        "allMeshesAreManifold": not nonmanifold,
        "threePlainSquareApertures": len(dark_apertures) == 3,
        "noDecorativeWindowInserts": not window_inserts,
        "twoRetopologizedAtlasShingleSkins": len(retopped_roof_skins) == 2 and not roof_panels,
        "wholeResidenceUnderNineThousandTriangles": total_triangles <= 9_000,
        "noAppliedEaveEdgeTrim": not applied_eave_trim,
        "actualRoofSmokeAperture": bool(roof_aperture_panels) and not surface_smoke_meshes,
        "fourClosedFoundationCorners": len(foundation_corners) == 4,
        "noRuntimeOrVegetationDressingAuthored": not forbidden_authored_state,
        # The preview-only packed-earth plane is intentionally excluded from the
        # architecture object set; the shell itself uses six production atlas tiles.
        "atlasMaterialsPacked": len(material_tiles) >= 6,
        "foundationUsesJointFreeStoneFace": "quarry-stone" in material_tiles,
        "noMortaredWallTextureOnIndividualFoundationStones": "fieldstone-mortar" not in material_tiles,
    }
    payload = {
        "id": "gorski-tier1-residence-validation-v4",
        "passed": all(checks.values()),
        "checks": checks,
        "counts": {
            "architectureObjects": len(objects),
            "meshes": len(meshes),
            "triangles": total_triangles,
            "roofTriangles": roof_triangles,
            "roofTriangleShare": round(roof_triangles / total_triangles, 4) if total_triangles else 0.0,
            "retopologizedRoofSkins": len(retopped_roof_skins),
            "legacySolidShinglePanels": len(roof_panels),
            "customApertureWallPieces": len(square_hole_walls),
            "darkUnglazedApertures": len(dark_apertures),
            "apertureCutRoofPanels": len(roof_aperture_panels),
            "foundationCorners": len(foundation_corners),
        },
        "atlasTiles": material_tiles,
        "violations": {
            "unitScale": unit_scale_violations,
            "missingMetricUv": missing_metric_uv,
            "nonmanifoldEdges": nonmanifold,
            "decorativeWindowInserts": window_inserts,
            "surfaceSmokeMeshes": surface_smoke_meshes,
            "appliedEaveTrim": applied_eave_trim,
            "forbiddenAuthoredState": forbidden_authored_state,
        },
    }
    OUT_REPORT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))
    if not payload["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
