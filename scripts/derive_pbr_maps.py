from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps


def crop_square(src: Path, size: int = 1024) -> Image.Image:
    img = Image.open(src).convert("RGB")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side)).resize(
        (size, size),
        Image.Resampling.LANCZOS,
    )


def ensure_square_tile(src: Path, size: int = 1024) -> Image.Image:
    img = crop_square(src, size)
    # Softly blend mirrored borders so repeat wrapping has no hard seam.
    px = img.load()
    blend = max(24, size // 16)
    horizontal_source = img.copy().load()
    for y in range(size):
        for x in range(blend):
            u = x / (blend - 1)
            t = u * u * (3 - 2 * u)
            opposite_x = size - 1 - x
            a = horizontal_source[x, y]
            b = horizontal_source[opposite_x, y]
            edge = tuple(round((a[i] + b[i]) * 0.5) for i in range(3))
            px[x, y] = tuple(round(edge[i] * (1 - t) + a[i] * t) for i in range(3))
            px[opposite_x, y] = tuple(
                round(edge[i] * (1 - t) + b[i] * t) for i in range(3)
            )
    vertical_source = img.copy().load()
    for x in range(size):
        for y in range(blend):
            u = y / (blend - 1)
            t = u * u * (3 - 2 * u)
            opposite_y = size - 1 - y
            a = vertical_source[x, y]
            b = vertical_source[x, opposite_y]
            edge = tuple(round((a[i] + b[i]) * 0.5) for i in range(3))
            px[x, y] = tuple(round(edge[i] * (1 - t) + a[i] * t) for i in range(3))
            px[x, opposite_y] = tuple(
                round(edge[i] * (1 - t) + b[i] * t) for i in range(3)
            )
    return img


def make_secondary_forest_albedo(src: Path, size: int = 1024) -> Image.Image:
    """Regrade an already seamless, motif-neutral groundcover tile as litter.

    The grass blend has deliberately even stochastic structure. Keeping that
    structure intact and only changing its palette gives the forest shader an
    independent detail field without introducing recognizable leaf clusters,
    mirrored seams, or four-way corner rosettes.
    """
    source = ensure_square_tile(src, size)
    gray = ImageOps.grayscale(source)
    gray = ImageEnhance.Contrast(gray).enhance(1.12)
    return ImageOps.colorize(
        gray,
        black=(40, 28, 22),
        white=(118, 90, 66),
    )


def wrap_atlas_cell(image: Image.Image, gutter: int = 64) -> Image.Image:
    """Add mip-safe wrapped borders while retaining a 1024px atlas cell."""
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
    return tiled.crop((
        start,
        start,
        start + width,
        start + height,
    ))


def save_height_maps(albedo: Image.Image, out_dir: Path, *, road: bool) -> None:
    gray = ImageOps.grayscale(albedo)
    gray = ImageEnhance.Contrast(gray).enhance(1.45 if road else 1.25)
    gray = gray.filter(ImageFilter.GaussianBlur(1.0 if road else 1.4))
    if road:
        # Dirt stones/ruts read best when darker compacted grooves are slightly lower.
        height = ImageOps.invert(gray)
        height = ImageEnhance.Contrast(height).enhance(1.22)
    else:
        height = gray
        height = ImageEnhance.Contrast(height).enhance(0.85)
    height.save(out_dir / "height.png")

    rough = ImageOps.grayscale(albedo)
    rough = ImageOps.autocontrast(rough)
    if road:
        rough = ImageOps.invert(rough).point(lambda v: int(174 + v * 0.22))
    else:
        rough = ImageOps.invert(rough).point(lambda v: int(154 + v * 0.30))
    rough = rough.filter(ImageFilter.GaussianBlur(0.6))
    rough.save(out_dir / "roughness.png")

    ao = height.filter(ImageFilter.GaussianBlur(4.0))
    ao = ImageChops.multiply(ImageOps.invert(ao), Image.new("L", ao.size, 180))
    ao = ImageOps.autocontrast(ao).point(lambda v: int(168 + v * 0.34))
    ao.save(out_dir / "ao.png")

    normal = height_to_normal(height, strength=4.8 if road else 3.1)
    normal.save(out_dir / "normal.png")


def save_snow_maps(albedo: Image.Image, out_dir: Path) -> None:
    """Derive restrained snow micro-surface maps from the generated albedo."""
    gray = ImageOps.grayscale(albedo)
    height = ImageEnhance.Contrast(gray).enhance(1.18)
    height = height.filter(ImageFilter.GaussianBlur(1.2))
    height.save(out_dir / "height.png")

    # Settled snow is broadly rough, with the slightly darker compressed
    # granules providing just enough variation to catch close-camera light.
    rough = ImageOps.autocontrast(gray)
    rough = rough.point(lambda value: int(212 + value * 0.15))
    rough = rough.filter(ImageFilter.GaussianBlur(0.7))
    rough.save(out_dir / "roughness.png")

    ao = ImageOps.invert(height.filter(ImageFilter.GaussianBlur(4.0)))
    ao = ImageOps.autocontrast(ao).point(lambda value: int(210 + value * 0.15))
    ao.save(out_dir / "ao.png")

    normal = height_to_normal(height, strength=2.1)
    normal.save(out_dir / "normal.png")


def save_dry_snow_albedo_atlas(
    dry_albedo_path: Path,
    snow_albedo: Image.Image,
    out_path: Path,
) -> None:
    dry = Image.open(dry_albedo_path).convert("RGB")
    if dry.size != snow_albedo.size:
        dry = dry.resize(snow_albedo.size, Image.Resampling.LANCZOS)
    width, height = snow_albedo.size
    atlas = Image.new("RGB", (width, height * 2))
    atlas.paste(dry, (0, 0))
    atlas.paste(snow_albedo, (0, height))
    atlas.save(out_path)


def save_dry_snow_leaf_albedo_atlas(
    dry_albedo_path: Path,
    snow_albedo_path: Path,
    primary_leaf_albedo_path: Path,
    secondary_leaf_albedo_path: Path,
    out_path: Path,
) -> None:
    """Pack four terrain albedos into one binding for the WebGPU material."""
    dry = Image.open(dry_albedo_path).convert("RGB")
    snow = Image.open(snow_albedo_path).convert("RGB")
    primary_leaf = Image.open(primary_leaf_albedo_path).convert("RGB")
    secondary_leaf = Image.open(secondary_leaf_albedo_path).convert("RGB")
    target_size = primary_leaf.size
    if dry.size != target_size:
        dry = dry.resize(target_size, Image.Resampling.LANCZOS)
    if snow.size != target_size:
        snow = snow.resize(target_size, Image.Resampling.LANCZOS)
    if secondary_leaf.size != target_size:
        secondary_leaf = secondary_leaf.resize(target_size, Image.Resampling.LANCZOS)
    width, height = target_size
    atlas = Image.new("RGB", (width, height * 4))
    # Texture.flipY exposes image-bottom at low V: secondary leaf, primary
    # leaf, snow, then dry.
    atlas.paste(dry, (0, 0))
    atlas.paste(snow, (0, height))
    atlas.paste(wrap_atlas_cell(primary_leaf), (0, height * 2))
    atlas.paste(wrap_atlas_cell(secondary_leaf), (0, height * 3))
    atlas.save(out_path)


def height_to_normal(height: Image.Image, strength: float) -> Image.Image:
    width, height_px = height.size
    src = height.load()
    out = Image.new("RGB", (width, height_px))
    dst = out.load()
    for y in range(height_px):
        ym = (y - 1) % height_px
        yp = (y + 1) % height_px
        for x in range(width):
            xm = (x - 1) % width
            xp = (x + 1) % width
            dx = (src[xp, y] - src[xm, y]) / 255.0
            dy = (src[x, yp] - src[x, ym]) / 255.0
            nx = -dx * strength
            ny = -dy * strength
            nz = 1.0
            inv = 1.0 / math.sqrt(nx * nx + ny * ny + nz * nz)
            dst[x, y] = (
                int((nx * inv * 0.5 + 0.5) * 255),
                int((ny * inv * 0.5 + 0.5) * 255),
                int((nz * inv * 0.5 + 0.5) * 255),
            )
    return out


def make_edge_mask(out_dir: Path, size: int = 512) -> None:
    img = Image.new("L", (size, size), 0)
    px = img.load()
    for y in range(size):
        wave = 0.045 * math.sin(y * 0.071) + 0.025 * math.sin(y * 0.193 + 1.7)
        for x in range(size):
            u = x / (size - 1)
            threshold = 0.16 + wave
            fade = max(0.0, min(1.0, (u - threshold) / 0.62))
            alpha = fade * fade * (3 - 2 * fade)
            fleck = 0.88 + 0.12 * math.sin((x * 13.37 + y * 3.91) * 0.07)
            px[x, y] = int(max(0.0, min(1.0, alpha * fleck)) * 255)
    img = img.filter(ImageFilter.GaussianBlur(1.0))
    img.save(out_dir / "edge_mask.png")


def make_rut_mask(out_dir: Path, size: int = 512) -> None:
    img = Image.new("L", (size, size), 0)
    px = img.load()
    for y in range(size):
        wobble = 0.015 * math.sin(y * 0.06) + 0.008 * math.sin(y * 0.17)
        for x in range(size):
            u = x / (size - 1)
            stripe_a = math.exp(-((u - (0.34 + wobble)) ** 2) / 0.0018)
            stripe_b = math.exp(-((u - (0.66 - wobble)) ** 2) / 0.0018)
            broken = 0.66 + 0.34 * math.sin(y * 0.11 + math.sin(y * 0.031) * 2.0)
            px[x, y] = int(min(1.0, max(stripe_a, stripe_b) * broken) * 255)
    img = img.filter(ImageFilter.GaussianBlur(1.15))
    img.save(out_dir / "rut_mask.png")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--road-source")
    parser.add_argument("--grass-source")
    parser.add_argument("--snow-source")
    parser.add_argument("--forest-source")
    parser.add_argument("--forest-secondary-source")
    args = parser.parse_args()

    if not any((
        args.road_source,
        args.grass_source,
        args.snow_source,
        args.forest_source,
        args.forest_secondary_source,
    )):
        parser.error("provide at least one texture source")

    if args.road_source:
        road_dir = Path("public/assets/textures/roads/medieval_dirt")
        road_dir.mkdir(parents=True, exist_ok=True)
        road = ensure_square_tile(Path(args.road_source))
        road.save(road_dir / "albedo.png")
        save_height_maps(road, road_dir, road=True)
        make_edge_mask(road_dir)
        make_rut_mask(road_dir)
        (road_dir / "README.md").write_text(
            "Medieval dirt road PBR texture set. Albedo was generated with Codex built-in image generation for this prototype; normal, roughness, AO, height, edge_mask, and rut_mask were derived locally by scripts/derive_pbr_maps.py.\n",
            encoding="utf-8",
        )

    if args.grass_source:
        grass_dir = Path("public/assets/textures/terrain/grass_ground")
        grass_dir.mkdir(parents=True, exist_ok=True)
        grass = ensure_square_tile(Path(args.grass_source))
        grass.save(grass_dir / "albedo.png")
        save_height_maps(grass, grass_dir, road=False)
        (grass_dir / "README.md").write_text(
            "Grass-ground PBR texture set. Albedo was generated with Codex built-in image generation for this prototype; normal, roughness, AO, and height were derived locally by scripts/derive_pbr_maps.py.\n",
            encoding="utf-8",
        )

    if args.snow_source:
        snow_dir = Path("public/assets/textures/terrain/snow_ground")
        snow_dir.mkdir(parents=True, exist_ok=True)
        snow = ensure_square_tile(Path(args.snow_source))
        snow.save(snow_dir / "albedo.png")
        save_snow_maps(snow, snow_dir)
        save_dry_snow_albedo_atlas(
            Path("public/assets/textures/terrain/manor_grass_dry/albedo.png"),
            snow,
            Path("public/assets/textures/terrain/manor_grass_dry/snow_albedo_atlas.png"),
        )
        (snow_dir / "README.md").write_text(
            "Settled snow PBR texture set. Albedo was generated with Codex built-in image generation for this project, then processed locally for seamless tiling; normal, roughness, AO, and height were derived locally by scripts/derive_pbr_maps.py. The runtime albedo is packed with dry grass in manor_grass_dry/snow_albedo_atlas.png to stay within the terrain shader's 16-sampler portability limit.\n",
            encoding="utf-8",
        )

    if args.forest_source:
        forest_dir = Path("public/assets/textures/terrain/forest_leaf_litter")
        forest_dir.mkdir(parents=True, exist_ok=True)
        forest = ensure_square_tile(Path(args.forest_source))
        forest.save(forest_dir / "albedo.png")
        save_height_maps(forest, forest_dir, road=False)
        (forest_dir / "README.md").write_text(
            "Primary forest leaf-litter PBR texture set. The original albedo was generated with Codex built-in image generation using a user-provided forest-floor image as a material reference, then processed locally for seamless tiling; normal, roughness, AO, and height were derived locally by scripts/derive_pbr_maps.py. The runtime albedo is packed with a second independent litter variant, dry grass, and snow in manor_grass_dry/snow_leaf_albedo_atlas.png to preserve the terrain shader's portable sampler budget.\n",
            encoding="utf-8",
        )

    if args.forest_secondary_source:
        secondary_forest_dir = Path(
            "public/assets/textures/terrain/forest_leaf_litter_secondary"
        )
        secondary_forest_dir.mkdir(parents=True, exist_ok=True)
        secondary_forest = make_secondary_forest_albedo(
            Path(args.forest_secondary_source)
        )
        secondary_forest.save(secondary_forest_dir / "albedo.png")
        save_height_maps(secondary_forest, secondary_forest_dir, road=False)
        (secondary_forest_dir / "README.md").write_text(
            "Secondary forest-floor PBR texture set. The albedo is a brown regrade of the project's already seamless, motif-neutral manor grass blend, giving the forest shader an independent stochastic detail field without recognizable repeated leaf clusters; normal, roughness, AO, and height were derived locally by scripts/derive_pbr_maps.py. Runtime color is packed with the primary litter, dry grass, and snow in manor_grass_dry/snow_leaf_albedo_atlas.png.\n",
            encoding="utf-8",
        )

    if args.forest_source or args.forest_secondary_source:
        primary_leaf_path = Path(
            "public/assets/textures/terrain/forest_leaf_litter/albedo.png"
        )
        secondary_leaf_path = Path(
            "public/assets/textures/terrain/forest_leaf_litter_secondary/albedo.png"
        )
        if not primary_leaf_path.exists() or not secondary_leaf_path.exists():
            parser.error(
                "both processed forest leaf-litter albedos are required to build the atlas"
            )
        save_dry_snow_leaf_albedo_atlas(
            Path("public/assets/textures/terrain/manor_grass_dry/albedo.png"),
            Path("public/assets/textures/terrain/snow_ground/albedo.png"),
            primary_leaf_path,
            secondary_leaf_path,
            Path("public/assets/textures/terrain/manor_grass_dry/snow_leaf_albedo_atlas.png"),
        )


if __name__ == "__main__":
    main()
