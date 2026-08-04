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


def prepare_portrait(source: Path, destination: Path) -> None:
    with Image.open(source) as image:
        rgb = image.convert("RGB")
        edge = min(rgb.size)
        left = (rgb.width - edge) // 2
        top = (rgb.height - edge) // 2
        portrait = rgb.crop((left, top, left + edge, top + edge))
        portrait.thumbnail((560, 560), Image.Resampling.LANCZOS)
        portrait.save(destination, "WEBP", quality=88, method=6)


def prepare_charge(source: Image.Image, index: int, destination: Path) -> None:
    col = index % 4
    row = index // 4
    x0 = round(col * source.width / 4)
    x1 = round((col + 1) * source.width / 4)
    y0 = round(row * source.height / 4)
    y1 = round((row + 1) * source.height / 4)
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
        for index, charge in enumerate(CHARGES):
            prepare_charge(atlas, index, charge_dir / f"{charge}.png")

    print(f"Prepared {len(PORTRAITS)} portraits and {len(CHARGES)} recolorable charges in {output_dir}")


if __name__ == "__main__":
    main()
