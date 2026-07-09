from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageOps


def ensure_square_tile(src: Path, size: int = 1024) -> Image.Image:
    img = Image.open(src).convert("RGB")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side)).resize((size, size), Image.Resampling.LANCZOS)
    # Softly blend mirrored borders so repeat wrapping has no hard seam.
    px = img.load()
    blend = max(24, size // 16)
    for y in range(size):
        for x in range(blend):
            t = (x / blend) ** 2 * (3 - 2 * (x / blend))
            a = px[x, y]
            b = px[size - blend + x, y]
            mix_l = tuple(round(a[i] * t + b[i] * (1 - t)) for i in range(3))
            mix_r = tuple(round(b[i] * t + a[i] * (1 - t)) for i in range(3))
            px[x, y] = mix_l
            px[size - blend + x, y] = mix_r
    for x in range(size):
        for y in range(blend):
            t = (y / blend) ** 2 * (3 - 2 * (y / blend))
            a = px[x, y]
            b = px[x, size - blend + y]
            mix_t = tuple(round(a[i] * t + b[i] * (1 - t)) for i in range(3))
            mix_b = tuple(round(b[i] * t + a[i] * (1 - t)) for i in range(3))
            px[x, y] = mix_t
            px[x, size - blend + y] = mix_b
    return img


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
    parser.add_argument("--road-source", required=True)
    parser.add_argument("--grass-source", required=True)
    args = parser.parse_args()

    road_dir = Path("public/assets/textures/roads/medieval_dirt")
    grass_dir = Path("public/assets/textures/terrain/grass_ground")
    road_dir.mkdir(parents=True, exist_ok=True)
    grass_dir.mkdir(parents=True, exist_ok=True)

    road = ensure_square_tile(Path(args.road_source))
    grass = ensure_square_tile(Path(args.grass_source))
    road.save(road_dir / "albedo.png")
    grass.save(grass_dir / "albedo.png")

    save_height_maps(road, road_dir, road=True)
    save_height_maps(grass, grass_dir, road=False)
    make_edge_mask(road_dir)
    make_rut_mask(road_dir)

    (road_dir / "README.md").write_text(
        "Medieval dirt road PBR texture set. Albedo was generated with Codex built-in image generation for this prototype; normal, roughness, AO, height, edge_mask, and rut_mask were derived locally by scripts/derive_pbr_maps.py.\n",
        encoding="utf-8",
    )
    (grass_dir / "README.md").write_text(
        "Grass-ground PBR texture set. Albedo was generated with Codex built-in image generation for this prototype; normal, roughness, AO, and height were derived locally by scripts/derive_pbr_maps.py.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
