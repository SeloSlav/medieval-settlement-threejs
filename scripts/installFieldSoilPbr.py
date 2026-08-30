#!/usr/bin/env python3
"""Install FAL PATINA field-soil candidates as runtime PBR state sets.

Raw model output remains immutable in the material-review archive. Runtime
copies correct PATINA's tangent-normal convention, constrain roughness for the
named soil condition, derive conservative cavity AO, and preserve generation
metadata without ever reading or writing the FAL credential.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageStat


ROOT = Path(__file__).resolve().parents[1]
REVIEW_ROOT = ROOT / "artifacts" / "pbr-material-review" / "patina-candidates"
TARGET_ROOT = ROOT / "public" / "assets" / "textures" / "terrain" / "field_soil_states_v1"


@dataclass(frozen=True)
class FieldSoilMaterial:
    state: str
    slug: str
    normal_strength: float
    roughness_minimum: float
    roughness_maximum: float
    metres_per_tile: float


MATERIALS = (
    FieldSoilMaterial("ploughed", "field-soil-fresh-ploughed-v1", 0.58, 0.74, 0.96, 2.8),
    FieldSoilMaterial("seedbed", "field-soil-fine-seedbed-v1", 0.40, 0.84, 0.99, 2.4),
    FieldSoilMaterial("fallow", "field-soil-weathered-fallow-v1", 0.34, 0.82, 0.99, 3.2),
    FieldSoilMaterial("harvested", "field-soil-dry-harvested-v3", 0.32, 0.86, 1.00, 2.9),
)


def require(path: Path) -> Path:
    if not path.is_file():
        raise FileNotFoundError(path)
    return path


def copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(require(source), target)


def wrap_blur(image: Image.Image, radius: float) -> Image.Image:
    image = image.convert("L")
    width, height = image.size
    tiled = Image.new("L", (width * 3, height * 3))
    for y in range(3):
        for x in range(3):
            tiled.paste(image, (x * width, y * height))
    blurred = tiled.filter(ImageFilter.GaussianBlur(radius))
    return blurred.crop((width, height, width * 2, height * 2))


def derive_ao(height_path: Path, output_path: Path) -> None:
    height = Image.open(require(height_path)).convert("L")
    cavities = []
    for radius, gain in ((3.0, 2.0), (12.0, 1.55), (36.0, 1.15)):
        neighbourhood = wrap_blur(height, radius)
        cavity = ImageChops.subtract(neighbourhood, height)
        cavity = cavity.point(lambda value, scale=gain: min(255, round(value * scale)))
        cavities.append(cavity)
    combined = ImageChops.lighter(cavities[0], cavities[1])
    combined = ImageChops.lighter(combined, cavities[2])
    combined = ImageEnhance.Contrast(combined).enhance(1.22)
    combined.point(lambda value: max(154, 255 - round(value * 0.72))).save(output_path)


def prepare_runtime_normal(source: Path, target: Path, strength: float) -> dict[str, object]:
    image = Image.open(require(source)).convert("RGB")
    source_mean = ImageStat.Stat(image).mean
    mean_x = source_mean[0] / 127.5 - 1.0
    mean_y = -(source_mean[1] / 127.5 - 1.0)
    output = bytearray(image.width * image.height * 3)
    offset = 0
    pixels = image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
    for red, green, _blue in pixels:
        nx = (red / 127.5 - 1.0 - mean_x) * strength
        ny = (-(green / 127.5 - 1.0) - mean_y) * strength
        inverse_length = 1.0 / math.sqrt(nx * nx + ny * ny + 1.0)
        output[offset] = round((nx * inverse_length * 0.5 + 0.5) * 255)
        output[offset + 1] = round((ny * inverse_length * 0.5 + 0.5) * 255)
        output[offset + 2] = round((inverse_length * 0.5 + 0.5) * 255)
        offset += 3
    runtime = Image.frombytes("RGB", image.size, bytes(output))
    runtime.save(target, optimize=True)
    return {
        "greenChannelFlipped": True,
        "meanTiltRemoved": True,
        "xyStrength": strength,
        "sourceMeanRgb": [round(value, 3) for value in source_mean],
        "runtimeMeanRgb": [round(value, 3) for value in ImageStat.Stat(runtime).mean],
    }


def prepare_roughness(
    source: Path,
    target: Path,
    minimum: float,
    maximum: float,
) -> None:
    image = Image.open(require(source)).convert("L")
    image.point(
        lambda value: round((minimum + (maximum - minimum) * (value / 255)) * 255)
    ).save(target, optimize=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def install(material: FieldSoilMaterial) -> dict[str, object]:
    source = REVIEW_ROOT / material.slug
    target = TARGET_ROOT / material.state
    target.mkdir(parents=True, exist_ok=True)
    copy(source / "basecolor.png", target / "albedo.png")
    normal_processing = prepare_runtime_normal(
        source / "normal.png",
        target / "normal.png",
        material.normal_strength,
    )
    prepare_roughness(
        source / "roughness.png",
        target / "roughness.png",
        material.roughness_minimum,
        material.roughness_maximum,
    )
    copy(source / "height.png", target / "height.png")
    derive_ao(source / "height.png", target / "ao.png")
    Image.new("L", Image.open(source / "basecolor.png").size, 0).save(
        target / "metalness.png",
        optimize=True,
    )
    copy(source / "generation.json", target / "generation.json")
    files = {
        name: sha256(target / name)
        for name in ("albedo.png", "normal.png", "roughness.png", "ao.png", "height.png", "metalness.png")
    }
    metadata = {
        "state": material.state,
        "sourceModel": "fal-ai/patina/material",
        "reviewCandidate": material.slug,
        "metresPerTile": material.metres_per_tile,
        "normalProcessing": normal_processing,
        "roughnessRange": [material.roughness_minimum, material.roughness_maximum],
        "metalness": 0,
        "maps": files,
    }
    (target / "runtime-material.json").write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf8",
    )
    (target / "README.md").write_text(
        f"""# {material.state.title()} field soil PBR

- Generated by `fal-ai/patina/material` from `{material.slug}`.
- Physical texture scale: `{material.metres_per_tile:.1f}` metres per tile.
- Base color is sRGB; normal, roughness, AO, height, and metalness are linear.
- Runtime normal flips PATINA's green channel, removes mean tilt, and limits XY relief to `{material.normal_strength:.2f}`.
- Roughness is constrained to `{material.roughness_minimum:.2f}–{material.roughness_maximum:.2f}`; metalness is zero.
- Raw API output and its exact prompt remain in `artifacts/pbr-material-review/patina-candidates/{material.slug}/`.
""",
        encoding="utf8",
    )
    return metadata


def main() -> None:
    TARGET_ROOT.mkdir(parents=True, exist_ok=True)
    installed = [install(material) for material in MATERIALS]
    manifest = {
        "version": 1,
        "coordinateDomain": "world-xz-metres",
        "antiTiling": "shared low-frequency coordinate warp across all PBR channels",
        "edgeTransition": "continuous fieldEdgeBlend alpha over a deterministic irregular metre-scale band",
        "states": {entry["state"]: entry for entry in installed},
        "growing": {
            "source": "../mammoth_terrain_dirt",
            "reason": "Established crop soil reuses the approved backyard garden-bed loam.",
            "metresPerTile": 2.2,
        },
        "unploughed": {
            "source": "native terrain",
            "reason": "Unworked land does not receive an artificial cultivated-soil overlay.",
        },
    }
    (TARGET_ROOT / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf8",
    )
    print(f"Installed {len(installed)} field-soil PBR state sets in {TARGET_ROOT}")


if __name__ == "__main__":
    main()
