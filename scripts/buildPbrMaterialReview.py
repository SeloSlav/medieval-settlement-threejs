from __future__ import annotations

import html
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import (
    Image,
    ImageChops,
    ImageDraw,
    ImageEnhance,
    ImageFilter,
    ImageFont,
    ImageOps,
    ImageStat,
)


ROOT = Path(__file__).resolve().parents[1]
REVIEW_ROOT = ROOT / "artifacts" / "pbr-material-review"
CANDIDATE_ROOT = REVIEW_ROOT / "patina-candidates"
COMPARISON_ROOT = REVIEW_ROOT / "comparisons"

BACKGROUND = "#171a1f"
PANEL = "#22262d"
PANEL_ALT = "#2b3038"
TEXT = "#f2f0e9"
MUTED = "#aeb5bf"
ACCENT = "#d6b46c"
GOOD = "#80c89b"
CONSIDER = "#e3ba67"


@dataclass(frozen=True)
class ReviewCandidate:
    slug: str
    label: str
    old_dir: str
    old_label: str
    priority: str
    verdict: str
    verdict_short: str
    runtime_note: str


CANDIDATES = [
    ReviewCandidate(
        "manor-grass-meadow",
        "Open meadow grass",
        "public/assets/textures/terrain/manor_grass_meadow",
        "Current manor grass meadow",
        "High",
        "Consider after an in-game scale test",
        "CONSIDER",
        "Runtime samples albedo, normal, roughness, and AO; keep height disabled and metalness at zero.",
    ),
    ReviewCandidate(
        "manor-grass-dense",
        "Dense shaded grass",
        "public/assets/textures/terrain/manor_grass_dense",
        "Current manor grass dense",
        "High",
        "Consider after an in-game scale test",
        "CONSIDER",
        "Runtime samples albedo, normal, roughness, and AO; preserve the dark ecological identity and distance filtering.",
    ),
    ReviewCandidate(
        "manor-grass-dry-v2",
        "Dry late-summer grass",
        "public/assets/textures/terrain/manor_grass_dry",
        "Current manor grass dry",
        "High",
        "Consider after an in-game scale test",
        "CONSIDER",
        "The accepted basecolor must also be repacked into snow_leaf_albedo_atlas.png; height remains unused.",
    ),
    ReviewCandidate(
        "forest-leaf-litter-primary",
        "Primary forest leaf litter",
        "public/assets/textures/terrain/forest_leaf_litter",
        "Current primary leaf litter",
        "Highest",
        "Strong replacement candidate",
        "REPLACE",
        "Production currently packs only this albedo; matching PBR atlases would be needed to use the new normal, roughness, and AO.",
    ),
    ReviewCandidate(
        "forest-leaf-litter-secondary",
        "Fine decomposed forest litter",
        "public/assets/textures/terrain/forest_leaf_litter_secondary",
        "Current secondary leaf litter",
        "Highest",
        "Strong replacement candidate",
        "REPLACE",
        "Production currently packs only this albedo; the new fine-scale identity is designed to decorrelate the primary layer.",
    ),
    ReviewCandidate(
        "medieval-dirt-road",
        "Medieval compacted dirt road",
        "public/assets/textures/roads/medieval_dirt",
        "Current medieval dirt road",
        "High",
        "Consider after road-width and tint tests",
        "CONSIDER",
        "Keep the existing analytic edge fade, rut mask, and wetness logic; the generated height is not currently sampled.",
    ),
    ReviewCandidate(
        "cultivated-garden-soil",
        "Cultivated garden-bed soil",
        "public/assets/textures/terrain/mammoth_terrain_dirt",
        "Current garden-bed soil",
        "Medium",
        "Strong replacement candidate",
        "REPLACE",
        "This is soil beneath crops, not a SeedThree vegetable texture; runtime needs only albedo, normal, and roughness.",
    ),
    ReviewCandidate(
        "forest-mossy-karst-rock-v3",
        "Forest mossy karst rock surface",
        "public/assets/textures/props/mossy_rock",
        "Current shared mossy rock",
        "Medium",
        "Consider for a forest-only material",
        "CONSIDER",
        "Use only in forest-density buckets. The current forest-rock population also places stones on open meadow, so retain a neutral fallback there.",
    ),
    ReviewCandidate(
        "clean-river-stone",
        "Clean water-worn river stone surface",
        "public/assets/textures/props/mossy_rock",
        "Current shared mossy rock",
        "Medium",
        "Consider for a river-specific material",
        "CONSIDER",
        "Rounded abrasion and clean mineral color mark environmental river stones; remove the current per-instance green moss tint when integrating.",
    ),
    ReviewCandidate(
        "clean-quarry-limestone-v2",
        "Clean freshly fractured quarry limestone",
        "public/assets/textures/props/mossy_rock",
        "Current shared mossy rock",
        "Medium",
        "Consider for a quarry-specific material",
        "CONSIDER",
        "Fresh pale fracture detail supports harvestable quarry identity; deliberate angular geometry and placement must remain the primary gameplay cue.",
    ),
]

ROUGHNESS_RUNTIME_RANGES = {
    "manor-grass-meadow": (0.80, 0.98),
    "manor-grass-dense": (0.82, 0.99),
    "manor-grass-dry-v2": (0.82, 0.99),
    "forest-leaf-litter-primary": (0.80, 0.98),
    "forest-leaf-litter-secondary": (0.80, 0.98),
    "medieval-dirt-road": (0.76, 0.96),
    "cultivated-garden-soil": (0.80, 0.98),
    "forest-mossy-karst-rock-v3": (0.78, 0.96),
    "clean-river-stone": (0.78, 0.95),
    "clean-quarry-limestone-v2": (0.80, 0.97),
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


FONT_TITLE = font(34, True)
FONT_SECTION = font(25, True)
FONT_LABEL = font(19, True)
FONT_SMALL = font(16)
FONT_TINY = font(14)


def open_rgb(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def fit_square(image: Image.Image, size: int) -> Image.Image:
    return ImageOps.fit(image.convert("RGB"), (size, size), Image.Resampling.LANCZOS)


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
    height = Image.open(height_path).convert("L")
    cavities = []
    for radius, gain in ((3.0, 2.0), (12.0, 1.55), (36.0, 1.15)):
        neighbourhood = wrap_blur(height, radius)
        cavity = ImageChops.subtract(neighbourhood, height)
        cavity = cavity.point(lambda value, scale=gain: min(255, round(value * scale)))
        cavities.append(cavity)
    combined = ImageChops.lighter(cavities[0], cavities[1])
    combined = ImageChops.lighter(combined, cavities[2])
    combined = ImageEnhance.Contrast(combined).enhance(1.22)
    ao = combined.point(lambda value: max(154, 255 - round(value * 0.72)))
    ao.save(output_path)


def ensure_runtime_maps(candidate: ReviewCandidate, candidate_dir: Path) -> None:
    if candidate.slug == "manor-grass-dry-v2":
        basecolor_runtime = candidate_dir / "basecolor-runtime.png"
        if not basecolor_runtime.exists():
            basecolor = Image.open(candidate_dir / "basecolor.png").convert("RGB")
            current_mean = ImageStat.Stat(
                basecolor.resize((128, 128), Image.Resampling.BILINEAR)
            ).mean
            target_mean = (116.0, 114.0, 76.0)
            graded_bands = []
            for band, source_mean, target in zip(basecolor.split(), current_mean, target_mean):
                scale = target / max(source_mean, 1.0)
                graded_bands.append(
                    band.point(lambda value, gain=scale: min(255, round(value * gain)))
                )
            Image.merge("RGB", graded_bands).save(basecolor_runtime)
    ao_path = candidate_dir / "ao-derived.png"
    if not ao_path.exists():
        derive_ao(candidate_dir / "height.png", ao_path)
    metalness_runtime = candidate_dir / "metalness-runtime.png"
    if not metalness_runtime.exists():
        base = Image.open(candidate_dir / "basecolor.png")
        Image.new("L", base.size, 0).save(metalness_runtime)
    roughness_runtime = candidate_dir / "roughness-runtime.png"
    if not roughness_runtime.exists():
        minimum, maximum = ROUGHNESS_RUNTIME_RANGES[candidate.slug]
        roughness = Image.open(candidate_dir / "roughness.png").convert("L")
        roughness = roughness.point(
            lambda value: round((minimum + (maximum - minimum) * (value / 255)) * 255)
        )
        roughness.save(roughness_runtime)


def tile_preview(image: Image.Image, size: int) -> Image.Image:
    tile_size = size // 2
    tile = fit_square(image, tile_size)
    preview = Image.new("RGB", (tile_size * 2, tile_size * 2))
    for y in range(2):
        for x in range(2):
            preview.paste(tile, (x * tile_size, y * tile_size))
    return preview


def placeholder(size: int, label: str) -> Image.Image:
    image = Image.new("RGB", (size, size), PANEL_ALT)
    draw = ImageDraw.Draw(image)
    lines = wrap_text(draw, label, FONT_SMALL, size - 36)
    total_height = len(lines) * 24
    y = (size - total_height) // 2
    for line in lines:
        box = draw.textbbox((0, 0), line, font=FONT_SMALL)
        x = (size - (box[2] - box[0])) // 2
        draw.text((x, y), line, font=FONT_SMALL, fill=MUTED)
        y += 24
    return image


def wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    chosen_font: ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        proposed = word if not line else f"{line} {word}"
        width = draw.textbbox((0, 0), proposed, font=chosen_font)[2]
        if width <= max_width:
            line = proposed
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def map_path(directory: Path, map_name: str, new: bool) -> Path | None:
    names = {
        "basecolor": "basecolor-runtime.png" if new and (directory / "basecolor-runtime.png").exists() else ("basecolor.png" if new else "albedo.png"),
        "normal": "normal.png",
        "roughness": "roughness-runtime.png" if new else "roughness.png",
        "height": "height.png",
        "ao": "ao-derived.png" if new else "ao.png",
        "metalness": "metalness.png",
    }
    path = directory / names[map_name]
    return path if path.exists() else None


def draw_labeled_image(
    canvas: Image.Image,
    image: Image.Image,
    x: int,
    y: int,
    size: int,
    label: str,
    *,
    border_color: str = "#3b424d",
) -> None:
    draw = ImageDraw.Draw(canvas)
    canvas.paste(fit_square(image, size), (x, y))
    draw.rectangle((x, y, x + size - 1, y + size - 1), outline=border_color, width=2)
    label_box_height = 31
    draw.rectangle(
        (x, y + size - label_box_height, x + size, y + size),
        fill="#121418",
    )
    draw.text((x + 10, y + size - 27), label, font=FONT_TINY, fill=TEXT)


def comparison_sheet(candidate: ReviewCandidate) -> Path:
    old_dir = ROOT / candidate.old_dir
    new_dir = CANDIDATE_ROOT / candidate.slug
    ensure_runtime_maps(candidate, new_dir)

    width, height = 1800, 1510
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.text((48, 34), candidate.label, font=FONT_TITLE, fill=TEXT)
    badge_color = GOOD if candidate.verdict_short == "REPLACE" else CONSIDER
    badge_box = draw.textbbox((0, 0), candidate.verdict, font=FONT_LABEL)
    badge_width = badge_box[2] - badge_box[0] + 36
    draw.rounded_rectangle(
        (width - 48 - badge_width, 31, width - 48, 75),
        radius=14,
        fill=badge_color,
    )
    draw.text(
        (width - 48 - badge_width + 18, 41),
        candidate.verdict,
        font=FONT_LABEL,
        fill="#151719",
    )
    draw.line((48, 94, width - 48, 94), fill="#3b414a", width=2)

    margin = 48
    gap = 40
    col_width = (width - margin * 2 - gap) // 2
    columns = [
        (margin, candidate.old_label, old_dir, False),
        (margin + col_width + gap, "New PATINA candidate", new_dir, True),
    ]
    base_size = 720
    base_y = 155
    map_size = 220
    map_gap = 23
    grid_y = 925
    for col_x, col_label, directory, is_new in columns:
        draw.rounded_rectangle(
            (col_x, 112, col_x + col_width, height - 56),
            radius=18,
            fill=PANEL,
        )
        draw.text((col_x + 24, 122), col_label, font=FONT_SECTION, fill=ACCENT if is_new else TEXT)
        base_path = map_path(directory, "basecolor", is_new)
        base_image = open_rgb(base_path) if base_path else placeholder(base_size, "missing basecolor")
        base_x = col_x + (col_width - base_size) // 2
        draw_labeled_image(canvas, base_image, base_x, base_y, base_size, "BASECOLOR")

        grid_x = col_x + (col_width - (map_size * 3 + map_gap * 2)) // 2
        grid_items = [
            ("normal", "NORMAL"),
            ("roughness", "ROUGHNESS (remapped)" if is_new else "ROUGHNESS"),
            ("height", "HEIGHT"),
            ("ao", "AO (derived)" if is_new else "AO"),
            ("metalness", "METALNESS (raw)" if is_new else "METALNESS"),
            ("tile", "2 × 2 TILE CHECK"),
        ]
        for index, (map_name, label) in enumerate(grid_items):
            x = grid_x + (index % 3) * (map_size + map_gap)
            y = grid_y + (index // 3) * (map_size + 42)
            if map_name == "tile":
                image = tile_preview(base_image, map_size)
            else:
                path = map_path(directory, map_name, is_new)
                if path:
                    image = open_rgb(path)
                elif map_name == "metalness":
                    image = Image.new("RGB", (map_size, map_size), "black")
                    label += " — runtime 0"
                else:
                    image = placeholder(map_size, "not supplied / not sampled")
            draw_labeled_image(canvas, image, x, y, map_size, label)

    note_lines = wrap_text(draw, candidate.runtime_note, FONT_SMALL, width - 120)
    note_y = height - 45 - len(note_lines) * 20
    for line in note_lines:
        draw.text((60, note_y), line, font=FONT_SMALL, fill=MUTED)
        note_y += 20

    COMPARISON_ROOT.mkdir(parents=True, exist_ok=True)
    output = COMPARISON_ROOT / f"{candidate.slug}.png"
    canvas.save(output, optimize=True)
    return output


def seam_metric(image: Image.Image) -> dict[str, float]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    left = rgb.crop((0, 0, 1, height))
    right = rgb.crop((width - 1, 0, width, height))
    top = rgb.crop((0, 0, width, 1))
    bottom = rgb.crop((0, height - 1, width, height))
    horizontal = sum(ImageStat.Stat(ImageChops.difference(left, right)).mean) / (3 * 255)
    vertical = sum(ImageStat.Stat(ImageChops.difference(top, bottom)).mean) / (3 * 255)
    return {
        "leftRightMeanAbsoluteDifference": round(horizontal, 5),
        "topBottomMeanAbsoluteDifference": round(vertical, 5),
    }


def image_metrics(path: Path) -> dict[str, object]:
    image = open_rgb(path)
    stats = ImageStat.Stat(image.resize((128, 128), Image.Resampling.BILINEAR))
    return {
        "path": path.relative_to(ROOT).as_posix(),
        "width": image.width,
        "height": image.height,
        "meanRgb": [round(value, 2) for value in stats.mean],
        "seam": seam_metric(image),
    }


def overview_sheet() -> Path:
    panel_width, panel_height = 910, 500
    width = 1900
    rows = (len(CANDIDATES) + 1) // 2
    height = 110 + rows * panel_height + 30
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.text((46, 30), "Natural-surface PBR review — current vs PATINA", font=FONT_TITLE, fill=TEXT)
    draw.text((46, 74), "Preview only: no production texture paths were changed", font=FONT_SMALL, fill=MUTED)
    for index, candidate in enumerate(CANDIDATES):
        col = index % 2
        row = index // 2
        x = 40 + col * 930
        y = 110 + row * panel_height
        draw.rounded_rectangle((x, y, x + panel_width, y + panel_height - 20), radius=18, fill=PANEL)
        draw.text((x + 22, y + 18), candidate.label, font=FONT_SECTION, fill=TEXT)
        badge_color = GOOD if candidate.verdict_short == "REPLACE" else CONSIDER
        draw.rounded_rectangle((x + panel_width - 145, y + 17, x + panel_width - 22, y + 51), radius=10, fill=badge_color)
        draw.text((x + panel_width - 129, y + 24), candidate.verdict_short, font=FONT_TINY, fill="#151719")
        old = open_rgb(ROOT / candidate.old_dir / "albedo.png")
        new_path = map_path(CANDIDATE_ROOT / candidate.slug, "basecolor", True)
        assert new_path is not None
        new = open_rgb(new_path)
        size = 390
        draw_labeled_image(canvas, old, x + 22, y + 70, size, "CURRENT")
        draw_labeled_image(canvas, new, x + 430, y + 70, size, "PATINA CANDIDATE", border_color=ACCENT)
    output = REVIEW_ROOT / "overview-current-vs-patina.png"
    canvas.save(output, optimize=True)
    return output


def write_manifest(comparisons: dict[str, Path]) -> None:
    entries = []
    for candidate in CANDIDATES:
        old_base = ROOT / candidate.old_dir / "albedo.png"
        new_base = map_path(CANDIDATE_ROOT / candidate.slug, "basecolor", True)
        assert new_base is not None
        generation = json.loads((CANDIDATE_ROOT / candidate.slug / "generation.json").read_text("utf8"))
        entries.append(
            {
                "slug": candidate.slug,
                "label": candidate.label,
                "priority": candidate.priority,
                "verdict": candidate.verdict,
                "runtimeNote": candidate.runtime_note,
                "current": image_metrics(old_base),
                "candidate": image_metrics(new_base),
                "comparison": comparisons[candidate.slug].relative_to(ROOT).as_posix(),
                "seed": generation.get("returnedSeed"),
                "requestId": generation.get("requestId"),
                "requestedPrompt": generation.get("requestedInput", {}).get("prompt"),
                "returnedPrompt": generation.get("returnedPrompt"),
                "maps": {
                    "basecolorRaw": f"artifacts/pbr-material-review/patina-candidates/{candidate.slug}/basecolor.png",
                    "basecolorRuntime": new_base.relative_to(ROOT).as_posix(),
                    "normal": f"artifacts/pbr-material-review/patina-candidates/{candidate.slug}/normal.png",
                    "roughnessRaw": f"artifacts/pbr-material-review/patina-candidates/{candidate.slug}/roughness.png",
                    "roughnessRuntime": f"artifacts/pbr-material-review/patina-candidates/{candidate.slug}/roughness-runtime.png",
                    "height": f"artifacts/pbr-material-review/patina-candidates/{candidate.slug}/height.png",
                    "metalnessRaw": f"artifacts/pbr-material-review/patina-candidates/{candidate.slug}/metalness.png",
                    "metalnessRuntime": f"artifacts/pbr-material-review/patina-candidates/{candidate.slug}/metalness-runtime.png",
                    "aoDerived": f"artifacts/pbr-material-review/patina-candidates/{candidate.slug}/ao-derived.png",
                },
            }
        )
    manifest = {
        "model": "fal-ai/patina/material",
        "productionTexturesChanged": False,
        "candidateCount": len(entries),
        "mapsReturnedByPatina": ["basecolor", "normal", "roughness", "height", "metalness"],
        "localRuntimeMaps": [
            "basecolor-runtime (dry grass v2 only)",
            "roughness-runtime",
            "ao-derived",
            "metalness-runtime",
        ],
        "candidates": entries,
    }
    (REVIEW_ROOT / "review-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf8",
    )


def write_readme() -> None:
    candidate_rows = "\n".join(
        f"| {candidate.label} | {candidate.priority} | {candidate.verdict} | `{candidate.slug}` |"
        for candidate in CANDIDATES
    )
    text = f"""# PBR material replacement review

Generated with `fal-ai/patina/material`. This is a non-destructive review set: no runtime texture path or production material was changed.

## Candidate summary

| Surface | Priority | Initial recommendation | Candidate folder |
| --- | --- | --- | --- |
{candidate_rows}

## Visual QA notes

| Candidate | What to watch before approval |
| --- | --- |
| Meadow grass | More organic and detailed, but it can read as flattened thatch; verify blade scale and normal strength in the terrain shader. |
| Dense grass | Strongest grass candidate. A few dark holes may form motifs; attenuate the raw normal response. |
| Dry grass v2 | Replaces the rejected hair-like v1 with shorter turf and a restrained palette grade; still verify that it remains distinct from meadow at game scale. |
| Primary leaf litter | Largest visual upgrade. It is darker and has a few memorable bright leaves/twigs, so test three-projection repetition under canopy. |
| Secondary litter | Excellent stochastic dark companion; intentionally reads as mixed humus with some needles rather than pure beech litter. |
| Dirt road | Cleaner and less swirled, but smoother/sandier than ideal. Test at the 5.8 m road repeat with the existing rut mask and shader tint. |
| Garden soil | Clear win: dark crumbly cultivated earth replaces a grey source with a visible tread/boot impression. |
| Forest mossy rock v3 | Correct forest identity, but large moss islands can repeat. Restrict it to woodland buckets and inspect lit normal/height seams. |
| River stone | Clean role-specific identity, though its broad diagonal bedding can read like an exposed slab. Test repetition and remove the current green tint. |
| Quarry limestone v2 | Motif-neutral and clean; it may read slightly concrete-like until paired with deliberately angular quarry geometry. |

## Full audit disposition

| Existing surface family | Production status | Review action |
| --- | --- | --- |
| `manor_grass_meadow`, `manor_grass_dense`, `manor_grass_dry` | Live terrain PBR | Generated three distinct candidates; retain the ecological blend and test physical scale in game. |
| `forest_leaf_litter`, `forest_leaf_litter_secondary` | Live albedos packed into the dry/snow/leaf atlas; standalone data maps are ignored | Generated two full candidates. Highest visual upside. Later integration should pack matching data-map atlases rather than add samplers. |
| `roads/medieval_dirt` | Live road, river-bank, shore, quarry-wear, and close-soil source | Generated one candidate without baked ruts or edges. Preserve the existing rut mask, edge fade, tint, and weather system. |
| `mammoth_terrain_dirt` | Live garden-bed soil | Generated a dedicated cultivated-soil candidate. SeedThree crop/vegetable textures were excluded. |
| `props/mossy_rock` | Live shared open-ground/forest, river, and quarry-deposit PBR | Generated three identities: woodland-only mossy stone, clean water-worn river stone, and clean freshly fractured quarry limestone. Open-meadow rocks need a neutral fallback because the current “forest” placement pass also emits rocks in low-forest-density areas. |
| `snow_ground` | Only its albedo is packed into the live atlas; standalone data maps are ignored | Keep for this round. Current snow reads well and a full replacement cannot be used without atlas/material work. |
| `roads/wood_logs` | Live UV-authored bridge/log surface | Keep. Its albedo encodes log layout, so a generic seamless PATINA tile is the wrong representation. |
| close meadow grass | Live alpha cards, not tileable ground PBR | Keep. These require foliage-card generation with preserved alpha, not PATINA Material. Forest-floor ivy is now procedural runner-and-leaf geometry and does not consume this card pipeline. |
| bilberry, fern, and juniper forest undergrowth | Live SeedThree albedo/normal/roughness/translucency cards | Keep. They already use coherent foliage-specific maps. |
| `manor_grass_blend`, `grass_ground`, `mammoth_grass_ground`, `mammoth_dead_grass_ground`, `mammoth_terrain_gravel` | Runtime-dead / archival | Audited, but no generation spend. |
| SeedThree vegetables and kitchen-crop cards | Live but explicitly excluded | No inspection-driven replacement and no generation calls. |

## Map handling

- PATINA returned `basecolor`, `normal`, `roughness`, `height`, and `metalness` at 1024×1024.
- PATINA's raw roughness predictions were systematically too glossy for these dry materials. Each candidate therefore includes a conservative high-range `roughness-runtime.png`; raw `roughness.png` remains untouched for inspection.
- Dry grass v2 includes a mild `basecolor-runtime.png` sRGB grade to restore the established straw/olive mean; its raw PATINA basecolor remains untouched.
- Natural ground and rock are dielectrics. The review retains the raw PATINA metalness for inspection and also provides an all-black `metalness-runtime.png`.
- PATINA does not return AO. `ao-derived.png` is a conservative, wrap-aware local derivation from the returned height map.
- Basecolor is the only sRGB map. Normal, roughness, height, metalness, and AO must remain linear/no-color-space.
- Height is included for completeness but is currently not sampled by the production grass or road materials.
- PATINA does not document its normal convention. These normals show a consistent negative-green bias relative to the current maps; verify Y orientation in a lit test, then flip/recenter and attenuate via normal scale if required.
- Earlier `manor-grass-dry`, `mossy-karst-rock`, `forest-mossy-karst-rock-v2`, and `clean-quarry-limestone` drafts are retained in `patina-candidates/` but excluded from the recommended gallery: dry grass v1 was too hair-like, the moss drafts were respectively too clean and too circular/repetitive, and the first quarry draft read as marble-veined.

## Rock identity integration caveats

- Forest and meadow rocks currently share one instanced material. Bucket by forest density before applying the mossy candidate; otherwise meadow stones will incorrectly become mossy.
- River-shore stones currently receive a procedural green/brown “moss” tint. Remove or neutralize that tint when testing the clean river candidate.
- Quarry resource deposits and river rocks currently receive the same shared texture objects. Load independent sets before either system disposes them.
- Constructed quarry buildings already use separate masonry PBR materials; do not retarget those.
- Texture identity supports the gameplay distinction, but quarry clusters, depressed quarry pads, angular geometry, map icons, and depletion remain the primary harvestability cues.

Open `index.html` for the gallery, `overview-current-vs-patina.png` for the compact old/new view, or `comparisons/` for one full channel sheet per surface.
"""
    (REVIEW_ROOT / "README.md").write_text(text, encoding="utf8")


def write_html(comparisons: dict[str, Path]) -> None:
    cards = []
    for candidate in CANDIDATES:
        comparison = comparisons[candidate.slug].relative_to(REVIEW_ROOT).as_posix()
        candidate_dir = f"patina-candidates/{candidate.slug}"
        has_runtime_basecolor = (
            CANDIDATE_ROOT / candidate.slug / "basecolor-runtime.png"
        ).exists()
        basecolor_links = (
            f'<a href="{candidate_dir}/basecolor-runtime.png">runtime basecolor</a>'
            f'<a href="{candidate_dir}/basecolor.png">raw basecolor</a>'
            if has_runtime_basecolor
            else f'<a href="{candidate_dir}/basecolor.png">basecolor</a>'
        )
        cards.append(
            f"""
            <article class="card">
              <div class="card-head">
                <div>
                  <p class="eyebrow">{html.escape(candidate.priority)} priority</p>
                  <h2>{html.escape(candidate.label)}</h2>
                </div>
                <span class="badge {'replace' if candidate.verdict_short == 'REPLACE' else 'consider'}">{html.escape(candidate.verdict)}</span>
              </div>
              <img src="{comparison}" alt="Old and new PBR comparison for {html.escape(candidate.label)}">
              <p>{html.escape(candidate.runtime_note)}</p>
              <nav>
                {basecolor_links}
                <a href="{candidate_dir}/normal.png">normal</a>
                <a href="{candidate_dir}/roughness-runtime.png">runtime roughness</a>
                <a href="{candidate_dir}/roughness.png">raw roughness</a>
                <a href="{candidate_dir}/height.png">height</a>
                <a href="{candidate_dir}/ao-derived.png">derived AO</a>
                <a href="{candidate_dir}/generation.json">generation metadata</a>
              </nav>
            </article>
            """
        )
    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PBR material replacement review</title>
  <style>
    :root {{ color-scheme: dark; font-family: Inter, Segoe UI, sans-serif; background: #121419; color: #f2f0e9; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: radial-gradient(circle at top, #252a32, #121419 34rem); }}
    header, main {{ width: min(1500px, calc(100% - 32px)); margin: auto; }}
    header {{ padding: 56px 0 30px; }}
    h1 {{ margin: 0 0 12px; font-size: clamp(2rem, 4vw, 4rem); line-height: 1; }}
    h2 {{ margin: 2px 0 0; font-size: 1.55rem; }}
    p {{ color: #b9c0ca; line-height: 1.55; }}
    .warning {{ border-left: 4px solid #d6b46c; padding: 12px 18px; background: #22262d; max-width: 900px; }}
    .overview {{ width: 100%; border-radius: 18px; border: 1px solid #3a414c; display: block; margin: 24px 0 50px; }}
    .card {{ background: #1e2229; border: 1px solid #383e48; border-radius: 20px; padding: 20px; margin-bottom: 34px; box-shadow: 0 22px 65px #0007; }}
    .card-head {{ display: flex; gap: 24px; justify-content: space-between; align-items: start; margin-bottom: 18px; }}
    .eyebrow {{ text-transform: uppercase; letter-spacing: .12em; font-size: .75rem; color: #d6b46c; margin: 0; }}
    .badge {{ color: #14171a; border-radius: 999px; padding: 9px 14px; font-weight: 700; white-space: nowrap; }}
    .badge.replace {{ background: #80c89b; }} .badge.consider {{ background: #e3ba67; }}
    .card img {{ width: 100%; display: block; border-radius: 12px; background: #171a1f; }}
    nav {{ display: flex; flex-wrap: wrap; gap: 10px; }}
    a {{ color: #f2d796; background: #2b3038; border-radius: 999px; padding: 8px 12px; text-decoration: none; }}
    a:hover {{ background: #3a414c; }}
    footer {{ color: #858d98; text-align: center; padding: 20px 0 70px; }}
    @media (max-width: 720px) {{ .card-head {{ display: block; }} .badge {{ display: inline-block; margin-top: 14px; }} }}
  </style>
</head>
<body>
  <header>
    <p class="eyebrow">fal-ai/patina/material · non-destructive review</p>
    <h1>Natural-surface PBR candidates</h1>
    <p class="warning">No existing texture was deleted or replaced, and no production material path changed. SeedThree vegetables were excluded.</p>
    <p><a href="README.md">Read the full inventory and integration notes</a> <a href="review-manifest.json">Open the machine-readable manifest</a></p>
  </header>
  <main>
    <img class="overview" src="overview-current-vs-patina.png" alt="Overview of current and PATINA material candidates">
    {''.join(cards)}
  </main>
  <footer>Generated for visual approval before any in-game replacement.</footer>
</body>
</html>
"""
    (REVIEW_ROOT / "index.html").write_text(document, encoding="utf8")


def main() -> None:
    missing: list[str] = []
    for candidate in CANDIDATES:
        candidate_dir = CANDIDATE_ROOT / candidate.slug
        for filename in ("basecolor.png", "normal.png", "roughness.png", "height.png", "metalness.png", "generation.json"):
            if not (candidate_dir / filename).exists():
                missing.append(f"{candidate.slug}/{filename}")
    if missing:
        raise SystemExit("Missing candidate outputs:\n" + "\n".join(missing))

    REVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    comparisons = {candidate.slug: comparison_sheet(candidate) for candidate in CANDIDATES}
    overview_sheet()
    write_manifest(comparisons)
    write_readme()
    write_html(comparisons)
    print(f"Wrote {len(comparisons)} comparison sheets to {COMPARISON_ROOT}")
    print(f"Review gallery: {REVIEW_ROOT / 'index.html'}")


if __name__ == "__main__":
    main()
