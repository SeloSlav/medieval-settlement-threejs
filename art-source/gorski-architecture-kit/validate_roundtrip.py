from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parent


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Round-trip validate the exported architecture kit GLB.")
    parser.add_argument("--glb", type=Path, default=ROOT / "out" / "gorski_architecture_kit.glb")
    parser.add_argument("--manifest", type=Path, default=ROOT / "out" / "gorski_architecture_kit_manifest.json")
    parser.add_argument("--report", type=Path, default=ROOT / "out" / "roundtrip-validation.json")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def main() -> None:
    args = _args()
    glb_path = args.glb.resolve()
    manifest = json.loads(args.manifest.resolve().read_text(encoding="utf-8"))
    expected_parts = {part["id"]: part for part in manifest["parts"]}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))
    objects = [object_ for object_ in bpy.data.objects if object_.type == "MESH" and object_.get("gk_id")]
    ids = [object_["gk_id"] for object_ in objects]
    errors: list[str] = []
    warnings: list[str] = []
    duplicates = sorted(part_id for part_id, count in Counter(ids).items() if count > 1)
    if duplicates:
        errors.append(f"duplicate ids after GLB import: {duplicates}")
    missing = sorted(set(expected_parts) - set(ids))
    extra = sorted(set(ids) - set(expected_parts))
    if missing:
        errors.append(f"missing imported parts: {missing[:20]}")
    if extra:
        errors.append(f"unexpected imported parts: {extra[:20]}")

    imported_by_id = {object_["gk_id"]: object_ for object_ in objects}
    total_triangles = 0
    for part_id, expected in expected_parts.items():
        object_ = imported_by_id.get(part_id)
        if object_ is None:
            continue
        triangles = sum(max(0, len(polygon.vertices) - 2) for polygon in object_.data.polygons)
        total_triangles += triangles
        if triangles <= 0:
            errors.append(f"{part_id}: no triangles after import")
        if triangles > int(expected["triangleBudget"]):
            errors.append(f"{part_id}: round-trip triangle count {triangles} exceeds budget {expected['triangleBudget']}")
        if object_.get("gk_family") != expected["family"]:
            errors.append(f"{part_id}: family metadata lost in GLB")
        if not object_.get("gk_origin_contract"):
            errors.append(f"{part_id}: origin metadata lost in GLB")
        if not object_.material_slots:
            errors.append(f"{part_id}: materials lost in GLB")
        if not object_.data.uv_layers:
            errors.append(f"{part_id}: UV0 lost in GLB")

    report = {
        "schemaVersion": 2,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "glb": str(glb_path),
        "partsExpected": len(expected_parts),
        "partsImported": len(objects),
        "familiesImported": dict(sorted(Counter(object_["gk_family"] for object_ in objects).items())),
        "totalImportedTriangles": total_triangles,
        "errors": errors,
        "warnings": warnings,
    }
    args.report.resolve().write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("GK_ROUNDTRIP_JSON " + json.dumps({"status": report["status"], "partsExpected": len(expected_parts), "partsImported": len(objects), "triangles": total_triangles, "errors": len(errors)}, separators=(",", ":")))
    if errors:
        for error in errors:
            print(f"ERROR {error}")
        raise RuntimeError(f"GLB round-trip validation failed with {len(errors)} error(s)")
    print(f"GK_ROUNDTRIP_OK report={args.report.resolve()}")


if __name__ == "__main__":
    main()
