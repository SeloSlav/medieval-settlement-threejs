# Sons of Eva manuscript contract

## Reference

- Retained source: `C:\WebProjects\medieval-road-system\.codex-work\sons-of-eva\Echoes-of-Immortality-v35.docx`
- Original source: `C:\Babushka\Echoes-of-Immortality-v35.docx`
- SHA-256 (both copies): `2F83F5976BCBE3BD2DFADB42E75839C8B0894E92BDCEBE76121207E33FD308F0`
- Source size: 2,101,517 bytes.
- Word-rendered source: 636 pages, 168,582 words, 4,938 Word paragraphs.
- OOXML inspection: 4,869 body paragraphs, no tables, two map images, three sections, 25 package parts.
- Evidence:
  - `reference-inspection.json`
  - `template-style-evidence.json`
  - `reference-page-text.json`
  - `reference-render\Echoes-of-Immortality-v35.pdf`
  - `reference-png\pages\page-0001.png` through `page-0636.png`
  - `reference-png\contacts\contact-001.png` through `contact-040.png`
- All 636 rendered pages were reviewed in the forty contact sheets. Title, copyright, contents, prose, chapter openings, maps, afterword, landscape insert, wiki, and glossary patterns were checked separately. Full-page checks used pages 1, 26, 27, and 609.

## Page system

- Trim: 6.00 x 9.00 inches.
- Primary orientation: portrait.
- Margins: 0.50 inch on every side.
- Header and footer distance: 0.30 inch.
- Header/footer: blank; no running heads and no visible page numbers.
- Odd/even headers: disabled. Different first page: disabled.
- Reference section patterns:
  1. Portrait main manuscript.
  2. Landscape 9.00 x 6.00-inch map insert, same 0.50-inch margins.
  3. Portrait return for main text and back matter.
- Sons of Eva Chapter 1 uses one portrait section only. The landscape map pattern and extra section breaks are removed because there is no map content.
- Each chapter begins on a new page using an explicit page break before its heading. Avoid blank spacer pages.

## Typography and paragraph roles

### Body / Normal

- Style: `Normal`.
- Font: Bookman Old Style, 12 pt, black, regular.
- Alignment: justified.
- First-line indent: 0.20 inch.
- Left/right indent: 0.
- Line spacing: 1.15.
- Space after: 6 pt. Space before: 0 pt.
- Widow/orphan behavior follows the source style/settings.
- Dialogue remains in ordinary body paragraphs. Internal direct thought uses italic runs within Normal paragraphs.

### Chapter heading

- Real paragraph style: `Heading 1`.
- Base: Normal. Next style: Normal.
- First line: `CHAPTER ONE` (and subsequent spelled-out numbers), 14 pt, bold, centered.
- Second line in the same paragraph: the outline chapter title, 18 pt, bold, centered.
- First-line indent: 0. Keep with next and keep together.
- Spacing before: 20 pt; inherited/zero spacing after.
- Exactly one empty Normal paragraph follows each chapter heading, matching the source opening pattern.
- Chapter 1 slot text: `CHAPTER ONE` + line break + `ACCESSION`.
- The second line uses the canonical outline title rather than repeating `TOMAS`, because every present-day chapter has the same POV and the outline supplies distinct chapter titles.

### Scene break

- Centered Normal paragraph containing exactly `∆∆∆` (U+2206 repeated three times), Times New Roman 12 pt italic, with no first-line indent.
- One blank paragraph appears before and after a scene break.
- Use only when the scene actually changes. Chapter 1 is designed as one continuous shift and does not require this component.

### Title page

- Three centered blank Normal paragraphs establish the source's vertical position.
- Series line: `БABUSHKA`, 40 pt, centered, first-line indent 0.
- Title line: `SONS OF EVA`, 22 pt, centered, first-line indent 0.
- Two centered blank Normal paragraphs.
- Author line: `By Martin Erlic`, 16 pt, centered, first-line indent 0.
- Explicit page break follows the author line.
- The source's `BOOK ONE` label is omitted because the supplied Sons of Eva canon does not assign a numbered series position. No placeholder or invented book number is used.

## Lists, tables, figures, fields, and recurring components

- Fiction chapters use prose only. No lists or tables are introduced.
- No map, figure, caption, text box, or callout is included in the Chapter 1 manuscript.
- No TOC is included until enough chapters/front matter exist to make it useful.
- The reference's TOC, REF, PAGEREF, and PAGE field material is removed with the source body; the Chapter 1 manuscript contains no fields.
- Headers and footers remain empty.
- No comments, tracked changes, or content controls are introduced.

## Content flow

1. Title page.
2. Page break.
3. Chapter 1 heading.
4. Approximately 1,750 words of continuous close-third narrative through Tomas.
5. The final displayed word is `FEMALE`.

Future chapter installments are appended after explicit page breaks using the same chapter-heading component. The same DOCX becomes the cumulative manuscript.

## Slot map

- `word/document.xml` / whole body: **rewrite-authorized**. The reference novel's title/front matter, maps, chapters, and back matter are removed and replaced with Sons of Eva content.
- Title block paragraphs: **rewrite-authorized** for series title, book title, and author.
- Chapter heading and body paragraphs: **new content** using retained paragraph styles and documented direct-run exceptions.
- Final body `w:sectPr`: **preserve geometry**, with the resulting single section kept portrait at 6 x 9 inches and 0.50-inch margins.
- Headers/footers: **preserve empty**.
- Source TOC, maps, wiki, glossary, ISBNs, copyright page, and acknowledgements: **remove**. They are unsupported source slots and would falsely belong to the new book.

## Text coverage and stable locators

- Source evidence covers body paragraphs, headings, page breaks, inline runs, section properties, headers, footers, tables, images, and fields.
- Stable style locators: `Normal`, `Heading1`, `Heading2`, `Title`, and `Subtitle` in `word/styles.xml`.
- Stable geometry locator: final `w:sectPr` in `word/document.xml` plus Word section audit.
- Stable title/chapter locators in the output: opening centered Normal paragraphs and Heading 1 paragraphs beginning with `CHAPTER `.
- The complete baseline package inventory, including paths, sizes, and SHA-256 hashes, is stored in `reference-inspection.json` under `package_parts`.

## Package preservation

- Preserve as design authority: `word/styles.xml`, `word/theme/theme1.xml`, `word/fontTable.xml`, `word/numbering.xml`, compatibility settings required by Word, and the final portrait section geometry.
- Preserve semantically: empty header/footer behavior, language/font inheritance, and style IDs.
- Editable: `word/document.xml`, document relationships needed to remove obsolete maps/fields, and document/core/app properties for the new title.
- Removable because source-specific: source image relationships/media, TOC field instructions, unused landscape section, and back-matter content.
- Opaque source `customXml` is not relied on for design or content. It may remain untouched if the library preserves it; its loss is not a fidelity failure because the output contains no controls or slots dependent on it.
- Full baseline hashes remain available in `reference-inspection.json`. The original retained reference must continue to match the recorded SHA-256 after authoring.

## Fidelity and shipping gates

- The output must render at 6 x 9 inches with no unexpected landscape pages.
- Title and chapter opening must remain recognizably derived from source pages 1 and 26.
- Body type, justification, indent, paragraph rhythm, and margins must match source page 27.
- No stale source title, character, ISBN, map, TOC, wiki, glossary, or copyright text may survive.
- No clipping, overlap, broken glyphs, orphaned headings, accidental blank pages, or visible headers/footers.
- The final DOCX must be rendered through Microsoft Word because LibreOffice is unavailable on this workstation, then every final page must be inspected at full-page and 100% image scale.
- The original reference hash must remain unchanged.
