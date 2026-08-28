from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import sys

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from kit import spec
from kit.core import evaluated_triangle_count, vertex_hash
from kit.coverage import BUILDING_COVERAGE, SUPPLEMENTAL_COVERAGE


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate the complete modular Gorski architecture kit.")
    parser.add_argument("--manifest", type=Path, default=ROOT / "out" / "gorski_architecture_kit_manifest.json")
    parser.add_argument("--catalog", type=Path, default=REPO_ROOT / "src" / "generated" / "gameBalance.ts")
    parser.add_argument("--report", type=Path, default=ROOT / "out" / "validation.json")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def _catalog_building_kinds(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    match = re.search(r"export const BUILDING_KINDS\s*=\s*(\[[^;]+?\])\s+as const", source)
    if not match:
        raise ValueError(f"could not read BUILDING_KINDS from {path}")
    return json.loads(match.group(1))


def _mesh_findings(object_: bpy.types.Object) -> tuple[int, int, int]:
    mesh = object_.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        nonmanifold = sum(1 for edge in bm.edges if len(edge.link_faces) != 2)
        degenerate = sum(1 for face in bm.faces if face.calc_area() < 1e-9)
        loose = sum(1 for vertex in bm.verts if not vertex.link_edges)
        return nonmanifold, degenerate, loose
    finally:
        bm.free()


def main() -> None:
    args = _args()
    manifest = json.loads(args.manifest.resolve().read_text(encoding="utf-8"))
    expected_parts = {part["id"]: part for part in manifest["parts"]}
    objects = [object_ for object_ in bpy.data.objects if object_.type == "MESH" and object_.get("gk_id")]
    ids = [object_["gk_id"] for object_ in objects]
    actual_parts = {object_["gk_id"]: object_ for object_ in objects}
    errors: list[str] = []
    warnings: list[str] = []
    metrics: dict[str, object] = {}

    duplicate_ids = sorted(part_id for part_id, count in Counter(ids).items() if count > 1)
    if duplicate_ids:
        errors.append(f"duplicate part ids: {duplicate_ids}")
    missing_objects = sorted(set(expected_parts) - set(actual_parts))
    extra_objects = sorted(set(actual_parts) - set(expected_parts))
    if missing_objects:
        errors.append(f"manifest parts missing from blend: {missing_objects[:12]}")
    if extra_objects:
        errors.append(f"blend parts missing from manifest: {extra_objects[:12]}")
    if len(objects) < 300:
        errors.append(f"component library is unexpectedly small: {len(objects)} parts")

    material_names = {material.name for material in bpy.data.materials if material.name.startswith("GK_Mat_")}
    if set(f"GK_Mat_{key}" for key in spec.MATERIAL_SPECS) - material_names:
        errors.append("one or more shared material palette entries are missing")

    total_triangles = 0
    nonmanifold_objects = 0
    for part_id, object_ in actual_parts.items():
        definition = expected_parts.get(part_id, {})
        scale = tuple(float(value) for value in object_.scale)
        if any(abs(value - 1.0) > 1e-6 for value in scale):
            errors.append(f"{part_id}: transform scale is not canonical 1,1,1 ({scale})")
        if any(abs(value) > 1e-6 for value in object_.rotation_euler):
            errors.append(f"{part_id}: display rotation must remain zero")
        if object_.parent is not None:
            errors.append(f"{part_id}: component is parented and therefore assembly-dependent")
        if not object_.material_slots:
            errors.append(f"{part_id}: no shared material assigned")
        elif any(slot.material is None or not slot.material.name.startswith("GK_Mat_") for slot in object_.material_slots):
            errors.append(f"{part_id}: non-kit or empty material slot")
        if not object_.get("gk_family") or not object_.get("gk_origin_contract"):
            errors.append(f"{part_id}: required family/origin metadata missing")
        if len(object_.data.uv_layers) != 1 or object_.data.uv_layers[0].name != "GK_UV0":
            errors.append(f"{part_id}: expected one metric GK_UV0 texture coordinate set")
        elif len(object_.data.uv_layers[0].data) != len(object_.data.loops):
            errors.append(f"{part_id}: incomplete GK_UV0 loop coverage")
        if object_.get("gk_uv_contract") != "GK_UV0; metric planar projection; 1 UV unit per metre":
            errors.append(f"{part_id}: UV contract metadata missing or drifted")
        if object_.get("gk_region") != spec.REGION or object_.get("gk_era") != spec.ERA:
            errors.append(f"{part_id}: region/era metadata drift")
        if len(object_.data.vertices) == 0 or len(object_.data.polygons) == 0:
            errors.append(f"{part_id}: empty mesh")
            continue
        if any(not all(math.isfinite(value) for value in vertex.co) for vertex in object_.data.vertices):
            errors.append(f"{part_id}: non-finite vertex coordinate")
        triangles = evaluated_triangle_count(object_)
        total_triangles += triangles
        budget = int(object_.get("gk_triangle_budget", spec.TRIANGLE_BUDGET_DEFAULT))
        if triangles > budget:
            errors.append(f"{part_id}: {triangles} triangles exceeds budget {budget}")
        expected_hash = definition.get("vertexHash")
        if expected_hash and vertex_hash(object_) != expected_hash:
            errors.append(f"{part_id}: deterministic vertex hash differs from manifest")
        nonmanifold, degenerate, loose = _mesh_findings(object_)
        if nonmanifold:
            nonmanifold_objects += 1
            if not bool(object_.get("gk_allow_nonmanifold", False)):
                errors.append(f"{part_id}: {nonmanifold} non-manifold boundary edges without documented allowance")
            else:
                warnings.append(f"{part_id}: documented non-manifold boundary edge count {nonmanifold}")
        if degenerate:
            errors.append(f"{part_id}: {degenerate} degenerate faces")
        if loose:
            errors.append(f"{part_id}: {loose} loose vertices")
        tags = json.loads(object_.get("gk_tags", "[]"))
        seams = json.loads(object_.get("gk_seams", "[]"))
        snap_sockets = json.loads(object_.get("gk_snap_sockets", "[]"))
        if seams != snap_sockets:
            errors.append(f"{part_id}: snap-socket metadata differs from authored seams")
        if "fraction-authored" in tags and len(seams) < 2:
            errors.append(f"{part_id}: authored fraction lacks seam contract")

    catalog_kinds = _catalog_building_kinds(args.catalog.resolve())
    missing_coverage = sorted(set(catalog_kinds) - set(BUILDING_COVERAGE))
    extra_coverage = sorted(set(BUILDING_COVERAGE) - set(catalog_kinds))
    if missing_coverage:
        errors.append(f"in-game building kinds without kit coverage: {missing_coverage}")
    if extra_coverage:
        errors.append(f"coverage rows not in authoritative catalog: {extra_coverage}")
    for category, coverage in {**BUILDING_COVERAGE, **SUPPLEMENTAL_COVERAGE}.items():
        part_refs = coverage.get("parts", [])
        if len(part_refs) < 2:
            errors.append(f"{category}: coverage must cite at least two reusable components")
        unknown = sorted(set(part_refs) - set(expected_parts))
        if unknown:
            errors.append(f"{category}: unknown component refs {unknown}")
        if not coverage.get("rationale"):
            errors.append(f"{category}: coverage rationale missing")

    required_coverage_sets = {
        "burgage thatch roof": (SUPPLEMENTAL_COVERAGE["residence_tier_0"], {"roof_thatch_panel_4m_full", "roof_thatch_ridge_4m", "roof_thatch_eave_edge_4m", "roof_thatch_smoke_vent"}),
        "established shingle roof": (SUPPLEMENTAL_COVERAGE["residence_tier_2"], {"roof_shingle_panel_4m_full", "roof_shingle_ridge_4m", "roof_shingle_verge_edge_full", "roof_shingle_dormer_cap_1p2m"}),
        "prosperous tile roof": (SUPPLEMENTAL_COVERAGE["residence_tier_3"], {"roof_tile_panel_4m_full", "roof_tile_ridge_4m", "roof_tile_eave_edge_4m", "roof_tile_chimney_flashing"}),
        "high-status roof forms": (SUPPLEMENTAL_COVERAGE["residence_tier_4"], {"roof_tile_halfhip_end_2p4m", "roof_tile_hip_cap_full", "roof_tile_dormer_cap_1p2m"}),
        "parish church exterior": (BUILDING_COVERAGE["chapel"], {"civic_chapel_facade_gable_4m", "civic_chapel_nave_bay_lancet_4m", "civic_chapel_apse_halfround", "opening_window_lancet_pair", "opening_window_oculus_stone", "opening_church_arch_door_double", "roof_tile_apse_halfcone_3m", "roof_tile_belfry_pyramid_2m", "civic_church_cross_iron_large"}),
        "wayside shrine devotional set": (BUILDING_COVERAGE["wayside_shrine"], {"civic_shrine_plinth_stone", "civic_shrine_niche_stone", "opening_shrine_icon_insert", "civic_shrine_votive_ledge", "roof_shingle_shrine_gable_1p5m", "civic_shrine_iron_cross"}),
    }
    for requirement, (coverage, required_parts) in required_coverage_sets.items():
        missing = sorted(required_parts - set(coverage["parts"]))
        if missing:
            errors.append(f"{requirement}: incomplete production vocabulary {missing}")

    family_counts = Counter(object_["gk_family"] for object_ in objects)
    expected_families = {"foundations", "walls", "frames", "openings", "roofs", "enclosures", "siteworks", "extraction", "production", "agriculture", "civic", "props"}
    missing_families = sorted(expected_families - set(family_counts))
    if missing_families:
        errors.append(f"required component families missing: {missing_families}")
    if any(count < 8 for count in family_counts.values()):
        errors.append(f"one or more component families are underdeveloped: {dict(family_counts)}")
    production_minima = {"roofs": 100, "openings": 25, "civic": 45, "frames": 50, "extraction": 30, "enclosures": 30, "props": 35}
    for family, minimum in production_minima.items():
        if family_counts.get(family, 0) < minimum:
            errors.append(f"{family}: production vocabulary has {family_counts.get(family, 0)} parts, expected at least {minimum}")
    forbidden_names = [object_.name for object_ in objects if any(token in object_.name.lower() for token in ("assembled_building", "finished_building", "complete_house"))]
    if forbidden_names:
        errors.append(f"finished-building assemblies found: {forbidden_names}")
    vegetation_parts = sorted(object_["gk_id"] for object_ in objects if "agri_crop_strip" in object_["gk_id"] or "vegetation" in json.loads(object_.get("gk_tags", "[]")))
    if vegetation_parts:
        errors.append(f"living vegetation belongs to SeedThree, not this kit: {vegetation_parts}")
    if "GK_Mat_foliage" in material_names or "GK_Mat_crop" in material_names:
        errors.append("living vegetation/crop palette entries found; SeedThree owns those materials")

    metrics.update({
        "parts": len(objects),
        "families": dict(sorted(family_counts.items())),
        "totalTriangles": total_triangles,
        "sharedMaterials": len(material_names),
        "buildingCatalogKinds": len(catalog_kinds),
        "buildingCoverageKinds": len(BUILDING_COVERAGE),
        "supplementalCoverageKinds": len(SUPPLEMENTAL_COVERAGE),
        "nonmanifoldObjects": nonmanifold_objects,
        "uvMappedObjects": sum(1 for object_ in objects if object_.data.uv_layers),
        "requiredProductionVocabularySets": len(required_coverage_sets),
    })
    report = {
        "schemaVersion": 1,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "blend": bpy.data.filepath,
        "manifest": str(args.manifest.resolve()),
        "status": "pass" if not errors else "fail",
        "metrics": metrics,
        "errors": errors,
        "warnings": warnings,
        "checks": [
            "authoritative building-catalog coverage",
            "coverage references resolve to modular components",
            "unique ids and deterministic vertex hashes",
            "canonical transforms and unparented component ownership",
            "mesh finiteness, topology, degeneracy, and triangle budgets",
            "shared palette materials and required metadata",
            "metric GK_UV0 coverage and texture contract metadata",
            "authored-fraction seam contracts",
            "minimum family breadth and no finished-building assemblies",
            "named residence-roof, church, and shrine production vocabularies",
            "no living vegetation or crop meshes (SeedThree ownership)",
        ],
    }
    args.report.resolve().write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("GK_VALIDATION_JSON " + json.dumps({"status": report["status"], **metrics, "errors": len(errors), "warnings": len(warnings)}, separators=(",", ":")))
    if errors:
        for error in errors:
            print(f"ERROR {error}")
        raise RuntimeError(f"Gorski architecture kit validation failed with {len(errors)} error(s)")
    print(f"GK_VALIDATE_OK report={args.report.resolve()}")


if __name__ == "__main__":
    main()
