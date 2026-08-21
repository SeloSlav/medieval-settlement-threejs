from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from pypdf import PdfReader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--json", required=True)
    args = parser.parse_args()

    reader = PdfReader(args.pdf)
    pages = []
    starts = []
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        record = {
            "page": index + 1,
            "width_pt": float(page.mediabox.width),
            "height_pt": float(page.mediabox.height),
            "first_lines": lines[:8],
            "last_lines": lines[-5:],
            "text": text,
        }
        pages.append(record)
        upper = "\n".join(lines[:12]).upper()
        if re.search(r"\b(PROLOGUE|EPILOGUE|CHAPTER\s+[A-Z]+)\b", upper):
            starts.append({"page": index + 1, "first_lines": lines[:12]})
    report = {"pdf": str(Path(args.pdf).resolve()), "page_count": len(pages), "chapter_starts": starts, "pages": pages}
    Path(args.json).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"page_count": len(pages), "chapter_starts": starts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
