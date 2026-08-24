from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

from derive_pbr_maps import ensure_square_tile, height_to_normal


def _save_tile_set(source: Path, albedo_path: Path, *, normal_strength: float) -> None:
    albedo_path.parent.mkdir(parents=True, exist_ok=True)
    albedo = ensure_square_tile(source, 1024)
    albedo.save(albedo_path, optimize=True)

    height = ImageEnhance.Contrast(ImageOps.grayscale(albedo)).enhance(1.22)
    height = height.filter(ImageFilter.GaussianBlur(0.9))
    height_to_normal(height, normal_strength).save(
        _map_path(albedo_path, "normal"),
        optimize=True,
    )

    # Young stems and dead twigs are both strongly dielectric and broadly rough.
    # Lighter raised fibres are only a little smoother than the crevices.
    luminance = np.asarray(ImageOps.grayscale(albedo), dtype=np.float32) / 255.0
    roughness = np.clip(0.94 - luminance * 0.16, 0.72, 0.96)
    Image.fromarray(np.uint8(np.round(roughness * 255)), "L").save(
        _map_path(albedo_path, "roughness"),
        optimize=True,
    )


def _map_path(albedo_path: Path, channel: str) -> Path:
    name = albedo_path.name
    if "_albedo" in name:
        return albedo_path.with_name(name.replace("_albedo", f"_{channel}"))
    if "-albedo" in name:
        return albedo_path.with_name(name.replace("-albedo", f"-{channel}"))
    raise ValueError(f"albedo output needs an albedo suffix: {albedo_path}")


def _dilate_leaf_rgb(rgb: np.ndarray, alpha: np.ndarray, passes: int = 12) -> np.ndarray:
    """Flood nearby transparent texels with edge colour to prevent black mips."""
    out = rgb.astype(np.float32).copy()
    known = alpha > 10
    height, width = known.shape
    for _ in range(passes):
        sums = np.zeros_like(out)
        counts = np.zeros((height, width), dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted_known = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            shifted_rgb = np.roll(np.roll(out, dy, axis=0), dx, axis=1)
            if dy == -1:
                shifted_known[-1, :] = False
            elif dy == 1:
                shifted_known[0, :] = False
            if dx == -1:
                shifted_known[:, -1] = False
            elif dx == 1:
                shifted_known[:, 0] = False
            sums += shifted_rgb * shifted_known[..., None]
            counts += shifted_known
        fill = (~known) & (counts > 0)
        out[fill] = sums[fill] / counts[fill, None]
        known |= fill
    return np.uint8(np.clip(np.round(out), 0, 255))


def _save_leaf_set(source: Path, albedo_path: Path) -> None:
    albedo_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert("RGBA")
    # Preserve the tall leaf aspect ratio while keeping a close-camera texture.
    image.thumbnail((768, 1152), Image.Resampling.LANCZOS)
    rgba = np.asarray(image, dtype=np.uint8).copy()
    alpha = rgba[..., 3]
    # Remove the generated studio glow but retain fine stinging hairs and teeth.
    alpha = np.uint8(np.clip((alpha.astype(np.int16) - 7) * 1.16, 0, 255))
    alpha[alpha < 14] = 0
    rgba[..., :3] = _dilate_leaf_rgb(rgba[..., :3], alpha)
    rgba[..., 3] = alpha
    Image.fromarray(rgba, "RGBA").save(albedo_path, optimize=True)

    luminance = (
        rgba[..., 0].astype(np.float32) * 0.2126
        + rgba[..., 1].astype(np.float32) * 0.7152
        + rgba[..., 2].astype(np.float32) * 0.0722
    ) / 255.0
    mask = alpha.astype(np.float32) / 255.0
    height = np.clip((0.28 + luminance * 0.72) * mask, 0, 1)
    height_image = Image.fromarray(np.uint8(np.round(height * 255)), "L")
    height_image = height_image.filter(ImageFilter.GaussianBlur(0.55))
    normal = np.asarray(height_to_normal(height_image, 4.2), dtype=np.uint8).copy()
    normal[alpha == 0] = (128, 128, 255)
    Image.fromarray(normal, "RGB").save(
        albedo_path.with_name(albedo_path.name.replace("_albedo", "_normal")),
        optimize=True,
    )

    roughness = np.clip(0.95 - luminance * 0.18, 0.76, 0.95)
    roughness[alpha == 0] = 0.72
    roughness_rgb = np.repeat(
        np.uint8(np.round(roughness * 255))[..., None],
        3,
        axis=2,
    )
    Image.fromarray(roughness_rgb, "RGB").save(
        albedo_path.with_name(albedo_path.name.replace("_albedo", "_roughness")),
        optimize=True,
    )

    # Thin blade tissue transmits strongly; opaque veins remain restrained.
    green_dominance = np.clip(
        rgba[..., 1].astype(np.float32)
        - (rgba[..., 0].astype(np.float32) + rgba[..., 2].astype(np.float32)) * 0.38,
        0,
        255,
    ) / 255.0
    translucency = np.clip(mask * (0.38 + green_dominance * 0.42), 0, 0.82)
    translucency_rgb = np.repeat(
        np.uint8(np.round(translucency * 255))[..., None],
        3,
        axis=2,
    )
    Image.fromarray(translucency_rgb, "RGB").save(
        albedo_path.with_name(albedo_path.name.replace("_albedo", "_translucency")),
        optimize=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--leaf-source", type=Path, required=True)
    parser.add_argument("--stem-source", type=Path, required=True)
    parser.add_argument("--twig-source", type=Path, required=True)
    args = parser.parse_args()

    _save_leaf_set(
        args.leaf_source,
        Path("vendor/seedthree/assets/leaves/stinging_nettle_single_albedo.png"),
    )
    _save_tile_set(
        args.stem_source,
        Path("vendor/seedthree/assets/bark/stinging_nettle_stem_albedo.png"),
        normal_strength=2.8,
    )
    _save_tile_set(
        args.twig_source,
        Path("public/assets/textures/vegetation/forest-floor-twig-albedo.png"),
        normal_strength=3.8,
    )


if __name__ == "__main__":
    main()
