from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


PORTRAITS = {
    "exec-8de356b6-2315-4a65-b815-989b5b3daf83.png": "nikola-zrinski.webp",
    "exec-b37de255-a039-4f79-86cf-b98c9fc4fa17.png": "katarina-frankapan.webp",
    "exec-5ace5e8d-ef01-482c-82d2-7df145c7c66b.png": "stjepan-frankapan.webp",
    "exec-ceaf134e-5393-4da0-aeb3-4463329cb0d3.png": "franjo-frankapan.webp",
    "exec-53919337-983f-4bf6-be7c-b939be1f6a3c.png": "petar-erdody.webp",
    "exec-3fb55eeb-c630-46ae-80b5-5091ffa7aeca.png": "petar-keglevic.webp",
    "exec-45a861ad-c291-437a-9a51-fa3674f9c0df.png": "ivan-lenkovic.webp",
    "exec-f8085d3f-a916-414c-a3bb-aa56a3fa1d13.png": "juraj-draskovic.webp",
    "exec-c8cd5c9a-8013-4947-a43e-5a88dd5bc635.png": "gaspar-alapic.webp",
    "exec-61573fdb-e40a-4848-9fee-2385da066b07.png": "franjo-tahi.webp",
    "exec-87f37368-45bd-497d-a9d2-3f8f7068ac6c.png": "nikola-jurisic.webp",
    "exec-1c45f74d-939c-4565-825b-4421d2c10869.png": "vuk-frankapan.webp",
}

CHARGES = (
    "lion",
    "eagle",
    "wolf",
    "bear",
    "stag",
    "boar",
    "falcon",
    "raven",
    "tower",
    "key",
    "sword",
    "axes",
    "star",
    "crescent",
    "fleur-de-lis",
    "oak-branch",
)

CHARGE_ATLAS = "exec-ba739b1f-a803-45ec-9f6c-21565e8e025d.png"

ADDITIONAL_CHARGE_ATLASES = (
    (
        "exec-f7df67f6-6799-4a7b-a795-f3a73f027b15.png",
        5,
        5,
        (
            "latin-cross", "patriarchal-cross", "papal-cross", "cross-pattee", "cross-potent",
            "cross-moline", "cross-fleury", "cross-bottony", "cross-crosslet", "maltese-cross",
            "jerusalem-cross", "calvary-cross", "tau-cross", "chi-rho", "ihs-monogram",
            "lamb-of-god", "pelican-in-piety", "holy-dove", "chalice-and-host", "keys-of-saint-peter",
            "crown-of-thorns", "three-nails", "anchor-cross", "crowned-cross", "passion-ladder",
        ),
    ),
    (
        "exec-27647092-ad2d-467a-b2ca-5e8ccf8fc0c7.png",
        5,
        5,
        (
            "madonna-and-child", "marian-monogram", "saint-james-shell", "saint-catherine-wheel", "saint-paul-sword",
            "crossed-keys", "bishop-mitre", "abbot-crozier", "papal-tiara", "rosary",
            "censer", "sanctus-bell", "closed-gospel", "open-gospel", "monstrance",
            "reliquary", "church", "chapel", "monastery", "baptismal-font",
            "lily", "rose", "grape-cluster", "wheat-sheaf", "olive-branch",
        ),
    ),
    (
        "exec-4d906a3b-f496-4613-b26a-6ec648e1ff88.png",
        5,
        5,
        (
            "griffin", "wyvern", "dragon", "unicorn", "horse",
            "bull", "ram", "goat", "hound", "fox",
            "lynx", "hare", "squirrel", "dolphin", "fish",
            "pike-fish", "swan", "rooster", "owl", "peacock",
            "stork", "pelican", "bee", "serpent", "double-headed-eagle",
        ),
    ),
    (
        "exec-66993333-acf4-4421-a4a2-1d0a58cf72eb.png",
        5,
        5,
        (
            "spear", "halberd", "mace", "war-hammer", "bow-and-arrow",
            "crossbow", "quiver", "round-shield", "great-helm", "gauntlet",
            "spur", "horseshoe", "hunting-horn", "war-banner", "single-axe",
            "scythe", "ploughshare", "blacksmith-hammer", "anvil", "wagon-wheel",
            "anchor", "sailing-ship", "chain-links", "portcullis", "castle",
        ),
    ),
    (
        "exec-72dc749b-89fa-48f0-8ac5-0797ca303f1a.png",
        2,
        2,
        ("sun", "comet", "mountain", "waves"),
    ),
)

CHARGE_INK_THRESHOLD = 18
GRID_GUTTER_SEARCH_RATIO = 0.22
GRID_GUTTER_BAND_RATIO = 0.008


def prepare_portrait(source: Path, destination: Path) -> None:
    with Image.open(source) as image:
        rgb = image.convert("RGB")
        edge = min(rgb.size)
        left = (rgb.width - edge) // 2
        top = (rgb.height - edge) // 2
        portrait = rgb.crop((left, top, left + edge, top + edge))
        portrait.thumbnail((560, 560), Image.Resampling.LANCZOS)
        portrait.save(destination, "WEBP", quality=88, method=6)


def find_charge_grid(source: Image.Image, columns: int, rows: int) -> tuple[list[int], list[int]]:
    """Find the dark gutters between generated atlas cells.

    The image generator lays the charges out in a regular grid, but the rows are
    not always spaced at exact fractions of the canvas. Cutting at those exact
    fractions can therefore include the top of the next row. Locate the nearby
    low-ink gutter instead, using a short band so an incidental blank scanline
    inside a charge is not mistaken for a cell boundary.
    """
    grayscale = source.convert("L")
    pixels = grayscale.load()
    x_ink = [0] * grayscale.width
    y_ink = [0] * grayscale.height

    for y in range(grayscale.height):
        row_ink = 0
        for x in range(grayscale.width):
            if pixels[x, y] >= CHARGE_INK_THRESHOLD:
                x_ink[x] += 1
                row_ink += 1
        y_ink[y] = row_ink

    def gutter_cuts(projection: list[int], divisions: int) -> list[int]:
        size = len(projection)
        cell_size = size / divisions
        search_radius = max(1, round(cell_size * GRID_GUTTER_SEARCH_RATIO))
        band_radius = max(1, round(cell_size * GRID_GUTTER_BAND_RATIO))
        cuts = [0]

        for division in range(1, divisions):
            expected = round(division * cell_size)
            search_start = max(band_radius, expected - search_radius)
            search_end = min(size - band_radius, expected + search_radius + 1)

            def gutter_score(position: int) -> tuple[int, int, int]:
                ink = sum(projection[position - band_radius:position + band_radius + 1])
                return ink, abs(position - expected), position

            cuts.append(min(range(search_start, search_end), key=gutter_score))

        cuts.append(size)
        return cuts

    return gutter_cuts(x_ink, columns), gutter_cuts(y_ink, rows)


def prepare_charge(
    source: Image.Image,
    index: int,
    destination: Path,
    columns: int = 4,
    rows: int = 4,
    grid: tuple[list[int], list[int]] | None = None,
) -> None:
    col = index % columns
    row = index // columns
    x_cuts, y_cuts = grid if grid is not None else find_charge_grid(source, columns, rows)
    x0, x1 = x_cuts[col], x_cuts[col + 1]
    y0, y1 = y_cuts[row], y_cuts[row + 1]
    cell = source.crop((x0, y0, x1, y1)).convert("L")
    cell = ImageEnhance.Contrast(cell).enhance(1.45)
    alpha = cell.point(lambda value: 0 if value < 18 else min(255, round((value - 18) * 1.18)))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.35))

    bounds = alpha.getbbox()
    if bounds is None:
        raise RuntimeError(f"Charge {index} is empty")
    trimmed = alpha.crop(bounds)
    trimmed.thumbnail((218, 218), Image.Resampling.LANCZOS)
    mask = Image.new("L", (256, 256), 0)
    mask.paste(trimmed, ((256 - trimmed.width) // 2, (256 - trimmed.height) // 2))
    rgba = Image.new("RGBA", (256, 256), (255, 255, 255, 0))
    rgba.putalpha(mask)
    rgba.save(destination, "PNG", optimize=True)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: processNobleSetupAssets.py SOURCE_DIR OUTPUT_DIR")

    source_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    portrait_dir = output_dir / "portraits"
    charge_dir = output_dir / "charges"
    portrait_dir.mkdir(parents=True, exist_ok=True)
    charge_dir.mkdir(parents=True, exist_ok=True)

    for source_name, output_name in PORTRAITS.items():
        prepare_portrait(source_dir / source_name, portrait_dir / output_name)

    with Image.open(source_dir / CHARGE_ATLAS) as atlas:
        grid = find_charge_grid(atlas, 4, 4)
        for index, charge in enumerate(CHARGES):
            prepare_charge(atlas, index, charge_dir / f"{charge}.png", grid=grid)

    additional_count = 0
    for source_name, columns, rows, charges in ADDITIONAL_CHARGE_ATLASES:
        if len(charges) != columns * rows:
            raise RuntimeError(f"{source_name} has {len(charges)} names for a {columns}x{rows} atlas")
        with Image.open(source_dir / source_name) as atlas:
            grid = find_charge_grid(atlas, columns, rows)
            for index, charge in enumerate(charges):
                prepare_charge(atlas, index, charge_dir / f"{charge}.png", columns, rows, grid)
        additional_count += len(charges)

    print(
        f"Prepared {len(PORTRAITS)} portraits and "
        f"{len(CHARGES) + additional_count} recolorable charges in {output_dir}"
    )


if __name__ == "__main__":
    main()
