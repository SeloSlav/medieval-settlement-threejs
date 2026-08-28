from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import bpy

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from kit import spec
from kit.core import create_part_object, evaluated_triangle_count, vertex_hash
from kit.coverage import ALL_COVERAGE, BUILDING_COVERAGE, SUPPLEMENTAL_COVERAGE
from kit.materials import create_materials
from kit.registry import build_registry


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the complete Gorski Kotar architecture component kit.")
    parser.add_argument("--out", type=Path, default=ROOT / "out")
    parser.add_argument("--no-glb", action="store_true")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def _reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene["gk_kit_version"] = spec.KIT_VERSION
    scene["gk_region"] = spec.REGION
    scene["gk_era"] = spec.ERA
    scene["gk_grid_m"] = spec.GRID
    scene["gk_contract"] = "component library only; no finished building assemblies"


def _new_collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    if parent is None:
        bpy.context.scene.collection.children.link(collection)
    else:
        parent.children.link(collection)
    return collection


def _dimensions(object_: bpy.types.Object) -> tuple[float, float, float]:
    xs = [corner[0] for corner in object_.bound_box]
    ys = [corner[1] for corner in object_.bound_box]
    zs = [corner[2] for corner in object_.bound_box]
    return max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)


def _arrange_family(objects: list[bpy.types.Object], start_y: float) -> float:
    columns = 8
    x_step = 9.0
    y_step = 8.0
    for index, object_ in enumerate(objects):
        column = index % columns
        row = index // columns
        object_.location = (column * x_step, start_y - row * y_step, 0.0)
        object_["gk_display_location"] = list(object_.location)
    rows = max(1, (len(objects) + columns - 1) // columns)
    return start_y - rows * y_step - 6.0


def _export_glb(path: Path, objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for object_ in objects:
        object_.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
    )


def main() -> None:
    args = _args()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    _reset_scene()
    materials = create_materials()
    registry = build_registry()

    root_collection = _new_collection("GK_COMPONENT_LIBRARY")
    family_collections: dict[str, bpy.types.Collection] = {}
    objects_by_family: dict[str, list[bpy.types.Object]] = defaultdict(list)
    all_objects: list[bpy.types.Object] = []

    for definition in registry.definitions:
        collection = family_collections.get(definition.family)
        if collection is None:
            collection = _new_collection(f"GK_FAMILY_{definition.family.upper()}", root_collection)
            collection["gk_family"] = definition.family
            family_collections[definition.family] = collection
        object_ = create_part_object(definition, materials, collection)
        if hasattr(object_, "asset_mark"):
            object_.asset_mark()
            if object_.asset_data:
                object_.asset_data.description = f"{definition.label} — {spec.REGION}, {spec.ERA}"
                object_.asset_data.author = "Codex architecture-kit-codex"
                for tag in definition.tags[:12]:
                    object_.asset_data.tags.new(tag)
        objects_by_family[definition.family].append(object_)
        all_objects.append(object_)

    cursor_y = 0.0
    for family in sorted(objects_by_family):
        cursor_y = _arrange_family(objects_by_family[family], cursor_y)

    part_manifest = []
    total_triangles = 0
    for definition, object_ in zip(registry.definitions, all_objects):
        triangles = evaluated_triangle_count(object_)
        total_triangles += triangles
        part_manifest.append({
            "id": definition.id,
            "name": object_.name,
            "family": definition.family,
            "label": definition.label,
            "tags": list(definition.tags),
            "seams": list(definition.seams),
            "openingContract": definition.opening_contract,
            "originContract": object_["gk_origin_contract"],
            "allowNonmanifold": definition.allow_nonmanifold,
            "triangleBudget": definition.triangle_budget,
            "triangles": triangles,
            "dimensionsM": [round(value, 5) for value in _dimensions(object_)],
            "displayLocationM": [round(value, 5) for value in object_.location],
            "materials": [slot.material.get("gk_material_key", slot.material.name) for slot in object_.material_slots],
            "vertexHash": vertex_hash(object_),
            "provenance": definition.provenance,
        })

    family_counts = Counter(definition.family for definition in registry.definitions)
    manifest = {
        "schemaVersion": 1,
        "kit": {
            "name": "Gorski Kotar / Primorje 1550 Modular Architecture Kit",
            "version": spec.KIT_VERSION,
            "region": spec.REGION,
            "era": spec.ERA,
            "unit": "metre",
            "gridM": spec.GRID,
            "axes": {"run": "+X", "depth": "+Y", "up": "+Z"},
            "scope": "modular components only; no finished individual building assemblies",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
        "summary": {
            "partCount": len(part_manifest),
            "familyCount": len(family_counts),
            "totalTriangles": total_triangles,
            "buildingCategories": len(BUILDING_COVERAGE),
            "supplementalCategories": len(SUPPLEMENTAL_COVERAGE),
        },
        "families": dict(sorted(family_counts.items())),
        "materials": {key: {"rgba": list(values[0]), "roughness": values[1], "metallic": values[2]} for key, values in spec.MATERIAL_SPECS.items()},
        "coverage": ALL_COVERAGE,
        "parts": part_manifest,
        "sources": [
            {"kind": "project", "path": "docs/design/building-visual-language.md", "role": "locked local visual language"},
            {"kind": "project", "path": "src/generated/gameBalance.ts", "role": "authoritative in-game building catalog"},
            {"kind": "upstream", "path": "vendor/architecture-kit-upstream", "role": "Lunarsong architecture-kit method and validators", "revision": "bf2d7a0f2912807afe7d2477c515a5d024e8232f"},
            {"kind": "historical", "url": "https://hrcak.srce.hr/file/264086", "role": "traditional Gorski Kotar house materials and form"},
            {"kind": "historical", "url": "https://enciklopedija.hr/clanak/rudarstvo", "role": "Croatian mining context"},
        ],
    }
    manifest_path = out_dir / "gorski_architecture_kit_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    blend_path = out_dir / "gorski_architecture_kit.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)
    glb_path = out_dir / "gorski_architecture_kit.glb"
    if not args.no_glb:
        _export_glb(glb_path, all_objects)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path), compress=True)

    print(f"GK_BUILD_OK parts={len(part_manifest)} families={len(family_counts)} triangles={total_triangles}")
    print(f"GK_BLEND={blend_path}")
    print(f"GK_GLB={glb_path if not args.no_glb else 'skipped'}")
    print(f"GK_MANIFEST={manifest_path}")


if __name__ == "__main__":
    main()
