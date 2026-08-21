from __future__ import annotations

import argparse
import json
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFont


def parse_pages(spec: str | None, count: int):
    if not spec or spec.lower() == "all":
        return list(range(count))
    pages = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = (int(v) for v in part.split("-", 1))
            pages.update(range(start - 1, end))
        else:
            pages.add(int(part) - 1)
    return sorted(p for p in pages if 0 <= p < count)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--dpi", type=int, default=96)
    parser.add_argument("--pages", default="all")
    parser.add_argument("--contact-cols", type=int, default=4)
    parser.add_argument("--contact-rows", type=int, default=4)
    parser.add_argument("--thumb-width", type=int, default=240)
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    pages_dir = output_dir / "pages"
    contacts_dir = output_dir / "contacts"
    pages_dir.mkdir(parents=True, exist_ok=True)
    contacts_dir.mkdir(parents=True, exist_ok=True)

    pdf = pdfium.PdfDocument(args.pdf)
    selected = parse_pages(args.pages, len(pdf))
    scale = args.dpi / 72.0
    rendered = []
    sizes = []
    for page_index in selected:
        page = pdf[page_index]
        width_pt, height_pt = page.get_size()
        sizes.append({"page": page_index + 1, "width_pt": width_pt, "height_pt": height_pt})
        bitmap = page.render(scale=scale)
        image = bitmap.to_pil().convert("RGB")
        page_path = pages_dir / f"page-{page_index + 1:04d}.png"
        image.save(page_path, optimize=True)
        rendered.append((page_index + 1, page_path))
        page.close()

    per_sheet = args.contact_cols * args.contact_rows
    font = ImageFont.load_default()
    for sheet_index in range(0, len(rendered), per_sheet):
        batch = rendered[sheet_index : sheet_index + per_sheet]
        thumb_h = int(args.thumb_width * 1.5)
        label_h = 22
        sheet = Image.new(
            "RGB",
            (args.contact_cols * (args.thumb_width + 12) + 12, args.contact_rows * (thumb_h + label_h + 12) + 12),
            "#b9b9b9",
        )
        draw = ImageDraw.Draw(sheet)
        for offset, (page_number, path) in enumerate(batch):
            row, col = divmod(offset, args.contact_cols)
            x = 12 + col * (args.thumb_width + 12)
            y = 12 + row * (thumb_h + label_h + 12)
            with Image.open(path) as im:
                thumb = im.copy()
                thumb.thumbnail((args.thumb_width, thumb_h), Image.Resampling.LANCZOS)
                px = x + (args.thumb_width - thumb.width) // 2
                py = y + label_h + (thumb_h - thumb.height) // 2
                sheet.paste(thumb, (px, py))
            draw.text((x + 4, y + 3), f"Page {page_number}", fill="black", font=font)
        contact_path = contacts_dir / f"contact-{sheet_index // per_sheet + 1:03d}.png"
        sheet.save(contact_path, optimize=True)

    (output_dir / "render-report.json").write_text(
        json.dumps({"pdf": str(Path(args.pdf).resolve()), "page_count": len(pdf), "rendered_pages": selected, "sizes": sizes}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"page_count": len(pdf), "rendered": len(rendered), "contact_sheets": (len(rendered) + per_sheet - 1) // per_sheet}))


if __name__ == "__main__":
    main()
