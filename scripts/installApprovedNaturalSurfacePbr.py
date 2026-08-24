#!/usr/bin/env python3
"""Install the approved PATINA natural-surface candidates non-destructively.

The review archive remains the source of truth for raw model output. This
script writes runtime-ready copies into new semantic asset folders, corrects
the PATINA normal convention to match the project's existing maps, and packs
the dry/snow/forest terrain atlases used by the WebGPU material.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from PIL import Image, ImageStat


ROOT = Path(__file__).resolve().parents[1]
REVIEW_ROOT = ROOT / "artifacts" / "pbr-material-review" / "patina-candidates"
TEXTURE_ROOT = ROOT / "public" / "assets" / "textures"


@dataclass(frozen=True)
class ApprovedMaterial:
    slug: str
    target: str
    albedo_source: str = "basecolor.png"
    normal_strength: float = 0.6


MATERIALS = (
    ApprovedMaterial(
        "manor-grass-meadow",
        "terrain/gorski_meadow_grass_v1",
        normal_strength=0.28,
    ),
    ApprovedMaterial(
        "manor-grass-dense",
        "terrain/gorski_dense_grass_v1",
        normal_strength=0.32,
    ),
    ApprovedMaterial(
        "manor-grass-dry-v2",
        "terrain/gorski_dry_grass_v1",
        albedo_source="basecolor-runtime.png",
        normal_strength=0.5,
    ),
    ApprovedMaterial(
        "forest-leaf-litter-primary",
        "terrain/gorski_forest_litter_primary_v1",
        normal_strength=0.55,
    ),
    ApprovedMaterial(
        "forest-leaf-litter-secondary",
        "terrain/gorski_forest_litter_secondary_v1",
        normal_strength=0.55,
    ),
    ApprovedMaterial(
        "forest-mossy-karst-rock-v3",
        "props/gorski_forest_mossy_rock_v1",
        normal_strength=0.68,
    ),
    ApprovedMaterial(
        "clean-river-stone",
        "props/gorski_river_stone_v1",
        normal_strength=0.64,
    ),
    ApprovedMaterial(
        "clean-quarry-limestone-v2",
        "props/gorski_quarry_limestone_v1",
        normal_strength=0.66,
    ),
)


def require_file(path: Path) -> Path:
    if not path.is_file():
        raise FileNotFoundError(path)
    return path


def copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(require_file(source), target)


def prepare_runtime_normal(source: Path, target: Path, strength: float) -> dict[str, object]:
    """Match the established OpenGL-style green channel and remove mean tilt."""
    image = Image.open(require_file(source)).convert("RGB")
    source_mean = ImageStat.Stat(image).mean
    mean_x = source_mean[0] / 127.5 - 1.0
    # PATINA's green axis is opposite to the project's existing height-derived
    # maps, so flip before removing the model's directional mean tilt.
    mean_y = -(source_mean[1] / 127.5 - 1.0)
    output = bytearray(image.width * image.height * 3)
    offset = 0
    pixels = (
        image.get_flattened_data()
        if hasattr(image, "get_flattened_data")
        else image.getdata()
    )
    for red, green, blue in pixels:
        nx = (red / 127.5 - 1.0 - mean_x) * strength
        ny = (-(green / 127.5 - 1.0) - mean_y) * strength
        # Treat the corrected XY values as bounded slopes and rebuild a stable
        # upward-facing Z. Retaining PATINA's blue component leaves a small
        # population of near-horizontal outliers even after XY attenuation,
        # which produces grazing-angle sparkle on broad terrain.
        nz = 1.0
        inverse_length = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
        output[offset] = round((nx * inverse_length * 0.5 + 0.5) * 255)
        output[offset + 1] = round((ny * inverse_length * 0.5 + 0.5) * 255)
        output[offset + 2] = round((nz * inverse_length * 0.5 + 0.5) * 255)
        offset += 3
    runtime = Image.frombytes("RGB", image.size, bytes(output))
    target.parent.mkdir(parents=True, exist_ok=True)
    runtime.save(target, optimize=True)
    runtime_mean = ImageStat.Stat(runtime).mean
    runtime_extrema = runtime.getextrema()
    return {
        "greenChannelFlipped": True,
        "meanTiltRemoved": True,
        "xyStrength": strength,
        "sourceMeanRgb": [round(value, 3) for value in source_mean],
        "runtimeMeanRgb": [round(value, 3) for value in runtime_mean],
        "runtimeRangeRgb": [list(channel_range) for channel_range in runtime_extrema],
    }


def resize_like(image: Image.Image, target_size: tuple[int, int]) -> Image.Image:
    image = image.convert("RGB")
    if image.size == target_size:
        return image
    return image.resize(target_size, Image.Resampling.LANCZOS)


def wrap_atlas_cell(image: Image.Image, gutter: int = 64) -> Image.Image:
    """Add wrapped mip-safe borders while retaining one 1024px atlas cell."""
    image = image.convert("RGB")
    width, height = image.size
    if width != height or gutter * 2 >= width:
        raise ValueError("atlas cells must be square with room for wrapped gutters")
    content_size = width - gutter * 2
    content = image.resize((content_size, content_size), Image.Resampling.LANCZOS)
    tiled = Image.new("RGB", (content_size * 3, content_size * 3))
    for tile_y in range(3):
        for tile_x in range(3):
            tiled.paste(content, (tile_x * content_size, tile_y * content_size))
    start = content_size - gutter
    return tiled.crop((start, start, start + width, start + height))


def mirror_atlas_cell(image: Image.Image, gutter: int = 64) -> Image.Image:
    """Add reflected mip-safe borders for a manually mirrored atlas cell."""
    image = image.convert("RGB")
    width, height = image.size
    if width != height or gutter * 2 >= width:
        raise ValueError("atlas cells must be square with room for reflected gutters")
    content_size = width - gutter * 2
    content = image.resize((content_size, content_size), Image.Resampling.LANCZOS)
    tiled = Image.new("RGB", (content_size * 3, content_size * 3))
    for tile_y in range(3):
        for tile_x in range(3):
            tile = content
            if tile_x != 1:
                tile = tile.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if tile_y != 1:
                tile = tile.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            tiled.paste(content if tile_x == 1 and tile_y == 1 else tile, (
                tile_x * content_size,
                tile_y * content_size,
            ))
    start = content_size - gutter
    return tiled.crop((start, start, start + width, start + height))


def pack_four_cell_atlas(
    dry: Image.Image,
    snow: Image.Image,
    primary_leaf: Image.Image,
    secondary_leaf: Image.Image,
    target: Path,
) -> None:
    target_size = primary_leaf.size
    cells = (
        mirror_atlas_cell(resize_like(dry, target_size)),
        mirror_atlas_cell(resize_like(snow, target_size)),
        mirror_atlas_cell(primary_leaf),
        wrap_atlas_cell(secondary_leaf),
    )
    width, height = target_size
    atlas = Image.new("RGB", (width, height * len(cells)))
    for index, cell in enumerate(cells):
        atlas.paste(cell, (0, index * height))
    target.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(target, optimize=True)


def hrao_cell(directory: Path) -> Image.Image:
    height = Image.open(require_file(directory / "height.png")).convert("L")
    height_mean = ImageStat.Stat(height).mean[0]
    height_offset = 127.5 - height_mean
    height = height.point(
        lambda value: max(0, min(255, round(value + height_offset)))
    )
    roughness = Image.open(require_file(directory / "roughness.png")).convert("L")
    ao = Image.open(require_file(directory / "ao.png")).convert("L")
    if roughness.size != height.size:
        roughness = roughness.resize(height.size, Image.Resampling.LANCZOS)
    if ao.size != height.size:
        ao = ao.resize(height.size, Image.Resampling.LANCZOS)
    return Image.merge("RGB", (height, roughness, ao))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def install_material(material: ApprovedMaterial) -> dict[str, object]:
    source = REVIEW_ROOT / material.slug
    target = TEXTURE_ROOT / material.target
    target.mkdir(parents=True, exist_ok=True)
    copy_file(source / material.albedo_source, target / "albedo.png")
    normal_processing = prepare_runtime_normal(
        source / "normal.png",
        target / "normal.png",
        material.normal_strength,
    )
    copy_file(source / "roughness-runtime.png", target / "roughness.png")
    copy_file(source / "ao-derived.png", target / "ao.png")
    copy_file(source / "height.png", target / "height.png")
    copy_file(source / "metalness-runtime.png", target / "metalness.png")
    copy_file(source / "generation.json", target / "generation.json")
    readme = f"""# Approved natural-surface PBR material

- Review candidate: `{material.slug}`
- Approved: {date.today().isoformat()}
- Runtime albedo source: `{material.albedo_source}`
- Runtime normal: PATINA green channel flipped to match the project's existing
  normal convention, mean XY tilt removed, attenuated to
  `{material.normal_strength:.2f}`, then renormalized with a reconstructed
  upward-facing Z component to prevent grazing-angle spikes.
- Runtime roughness: conservative high-range review remap.
- Runtime AO: conservative height-derived review map.
- Runtime metalness: zero; this natural material is dielectric.

Raw PATINA output remains unchanged under
`artifacts/pbr-material-review/patina-candidates/{material.slug}/`.
"""
    (target / "README.md").write_text(readme, encoding="utf-8")
    return {
        "slug": material.slug,
        "target": target.relative_to(ROOT).as_posix(),
        "normalProcessing": normal_processing,
    }


def build_terrain_atlases() -> dict[str, str]:
    dry = TEXTURE_ROOT / "terrain" / "gorski_dry_grass_v1"
    primary = TEXTURE_ROOT / "terrain" / "gorski_forest_litter_primary_v1"
    secondary = TEXTURE_ROOT / "terrain" / "gorski_forest_litter_secondary_v1"
    snow = TEXTURE_ROOT / "terrain" / "snow_ground"
    albedo_atlas = dry / "snow_leaf_albedo_atlas.png"
    hrao_atlas = dry / "snow_leaf_hrao_atlas.png"
    pack_four_cell_atlas(
        Image.open(require_file(dry / "albedo.png")),
        Image.open(require_file(snow / "albedo.png")),
        Image.open(require_file(primary / "albedo.png")),
        Image.open(require_file(secondary / "albedo.png")),
        albedo_atlas,
    )
    pack_four_cell_atlas(
        hrao_cell(dry),
        hrao_cell(snow),
        hrao_cell(primary),
        hrao_cell(secondary),
        hrao_atlas,
    )
    return {
        "albedo": albedo_atlas.relative_to(ROOT).as_posix(),
        "hrao": hrao_atlas.relative_to(ROOT).as_posix(),
        "hraoChannels": "R=height, G=roughness, B=ambient occlusion",
        "cellOrderTopToBottom": "dry, snow, primary forest litter, secondary forest litter",
        "cellPaddingModesTopToBottom": "mirror, mirror, mirror, repeat",
    }


def main() -> None:
    installed = [install_material(material) for material in MATERIALS]
    atlases = build_terrain_atlases()
    files = sorted(
        path
        for material in MATERIALS
        for path in (TEXTURE_ROOT / material.target).iterdir()
        if path.is_file()
    )
    manifest = {
        "installedOn": date.today().isoformat(),
        "rawCandidatesPreserved": True,
        "deferred": [
            "medieval compacted dirt road",
            "backyard garden-bed soil",
        ],
        "materials": installed,
        "terrainAtlases": atlases,
        "files": {
            path.relative_to(ROOT).as_posix(): sha256(path)
            for path in files
        },
    }
    manifest_path = TEXTURE_ROOT / "approved-natural-surface-pbr.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Installed {len(installed)} approved PBR materials")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
