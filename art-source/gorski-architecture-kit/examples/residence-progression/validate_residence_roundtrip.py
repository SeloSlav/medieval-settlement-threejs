from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parent
TIER = int(os.environ.get("GK_RESIDENCE_TIER", "2"))
if TIER not in (2, 3, 4):
    raise ValueError("GK_RESIDENCE_TIER must be 2, 3, or 4")

STEM = f"residence_tier_{TIER}_kit_v1"
OUT_DIR = ROOT / "out"
GLB_PATH = OUT_DIR / f"{STEM}.glb"
MANIFEST_PATH = OUT_DIR / f"{STEM}_assembly.json"
NATIVE_VALIDATION_PATH = OUT_DIR / f"{STEM}_validation.json"
REPORT_PATH = OUT_DIR / f"{STEM}_roundtrip_validation.json"
ROUNDTRIP_TRIANGLE_BUDGETS = {2: 45000, 3: 65000, 4: 90000}


def triangle_count(obj: bpy.types.Object) -> int:
    return sum(max(0, len(polygon.vertices) - 2) for polygon in obj.data.polygons)


def material_keys(obj: bpy.types.Object) -> set[str]:
    return {
        str(slot.material.get("gk_material_key"))
        for slot in obj.material_slots
        if slot.material is not None and slot.material.get("gk_material_key")
    }


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    native = json.loads(NATIVE_VALIDATION_PATH.read_text(encoding="utf-8"))
    expected_source_counts = Counter(str(item["source"]) for item in manifest["placements"])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))

    errors: list[str] = []
    warnings: list[str] = []
    roots = [obj for obj in bpy.data.objects if obj.get("residence_kit_assembly")]
    if len(roots) != 1:
        errors.append(f"expected one residence assembly root, imported {len(roots)}")
    elif int(roots[0].get("residence_tier", -1)) != TIER:
        errors.append("residence tier metadata was lost or changed")
    elif roots[0].get("source_kit") != "gorski-architecture-kit-1.1.0":
        errors.append("source-kit provenance metadata was lost")

    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if len(meshes) != int(native["meshCount"]):
        errors.append(
            f"mesh count changed during GLB round trip: expected {native['meshCount']}, imported {len(meshes)}"
        )

    source_counts: Counter[str] = Counter()
    imported_material_keys: set[str] = set()
    total_triangles = 0
    for obj in meshes:
        triangles = triangle_count(obj)
        total_triangles += triangles
        if triangles <= 0:
            errors.append(f"{obj.name}: empty mesh after import")
        # glTF names the first TEXCOORD_0 channel `UVMap` on re-import even
        # when the authored Blender layer was `GK_UV0`; channel presence is
        # the round-trip contract, while the native report checks its name.
        if not obj.data.uv_layers:
            errors.append(f"{obj.name}: UV0 lost during GLB round trip")
        if not obj.material_slots:
            errors.append(f"{obj.name}: material slots lost during GLB round trip")
        keys = material_keys(obj)
        imported_material_keys.update(keys)
        if not keys:
            errors.append(f"{obj.name}: semantic gk_material_key metadata lost")
        source_id = obj.get("source_component_id")
        if not source_id:
            errors.append(f"{obj.name}: source_component_id metadata lost")
        else:
            source_counts[str(source_id)] += 1
        if not obj.get("residence_kit_instance"):
            errors.append(f"{obj.name}: residence_kit_instance metadata lost")

    if source_counts != expected_source_counts:
        errors.append(
            "source-component placement counts changed during GLB round trip: "
            f"expected {dict(sorted(expected_source_counts.items()))}, "
            f"imported {dict(sorted(source_counts.items()))}"
        )

    if total_triangles > ROUNDTRIP_TRIANGLE_BUDGETS[TIER]:
        errors.append(
            f"round-trip triangle count {total_triangles} exceeds Tier {TIER} budget "
            f"{ROUNDTRIP_TRIANGLE_BUDGETS[TIER]}"
        )
    if total_triangles != int(native["triangleCount"]):
        warnings.append(
            "glTF export applied the kit's non-destructive edge-detail modifiers: "
            f"native control mesh {native['triangleCount']} triangles; imported runtime mesh {total_triangles} triangles"
        )

    expected_material_keys = set(map(str, native["materialKeys"]))
    if imported_material_keys != expected_material_keys:
        errors.append(
            "semantic material set changed during GLB round trip: "
            f"expected {sorted(expected_material_keys)}, imported {sorted(imported_material_keys)}"
        )

    report = {
        "schemaVersion": 1,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "tier": TIER,
        "status": "pass" if not errors else "fail",
        "glb": str(GLB_PATH.resolve()),
        "meshCountExpected": int(native["meshCount"]),
        "meshCountImported": len(meshes),
        "triangleCountExpected": int(native["triangleCount"]),
        "triangleCountImported": total_triangles,
        "triangleBudget": ROUNDTRIP_TRIANGLE_BUDGETS[TIER],
        "sourceComponentCounts": dict(sorted(source_counts.items())),
        "materialKeys": sorted(imported_material_keys),
        "errors": errors,
        "warnings": warnings,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        "GK_RESIDENCE_ROUNDTRIP_JSON "
        + json.dumps(
            {
                "tier": TIER,
                "status": report["status"],
                "meshes": len(meshes),
                "triangles": total_triangles,
                "errors": len(errors),
            },
            separators=(",", ":"),
        )
    )
    if errors:
        for error in errors:
            print(f"ERROR {error}")
        raise RuntimeError(f"Residence Tier {TIER} GLB round-trip validation failed")
    print(f"GK_RESIDENCE_ROUNDTRIP_OK report={REPORT_PATH.resolve()}")


if __name__ == "__main__":
    main()
