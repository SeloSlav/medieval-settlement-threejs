from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(r"C:\WebProjects\medieval-road-system")
OUTPUT_DIR = ROOT / ".tmp" / "translucency-candidates"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

JOBS = [
    {
        "name": "fern",
        "albedo": ROOT / ".tmp" / "seedthree-fern" / "assets" / "leaves" / "fern_albedo.png",
        "current": ROOT / ".tmp" / "seedthree-fern" / "assets" / "leaves" / "fern_translucency.png",
        "generated": Path(r"C:\Users\Asus\.codex\generated_images\019fd21f-55fe-7b71-b1f3-d577f3d56c56\exec-8078eeef-092c-43b0-b95e-946ef9ab1b9c.png"),
    },
    {
        "name": "juniper_scrub",
        "albedo": ROOT / ".tmp" / "seedthree-juniper" / "assets" / "leaves" / "juniper_scrub_albedo.png",
        "current": ROOT / ".tmp" / "seedthree-juniper" / "assets" / "leaves" / "juniper_scrub_translucency.png",
        "generated": Path(r"C:\Users\Asus\.codex\generated_images\019fd21f-55fe-7b71-b1f3-d577f3d56c56\exec-43acda84-b7af-4ef6-bed1-5bc39edd9f67.png"),
    },
    {
        "name": "cattail_reed_card",
        "albedo": ROOT / ".tmp" / "seedthree-cattail" / "assets" / "leaves" / "cattail_reed_card.png",
        "current": ROOT / ".tmp" / "seedthree-cattail" / "assets" / "leaves" / "cattail_reed_card_translucency.png",
        "generated": Path(r"C:\Users\Asus\.codex\generated_images\019fd21f-55fe-7b71-b1f3-d577f3d56c56\exec-d3812fd5-c5f8-4097-bd9e-b865a4f3063c.png"),
    },
]


for job in JOBS:
    albedo = Image.open(job["albedo"]).convert("RGBA")
    current = Image.open(job["current"]).convert("L")
    generated = Image.open(job["generated"]).convert("L")
    if generated.size != albedo.size:
        generated = generated.resize(albedo.size, Image.Resampling.LANCZOS)

    # Remove model-scale speckle while retaining anatomical transitions.
    generated = generated.filter(ImageFilter.GaussianBlur(radius=0.65))

    alpha = np.asarray(albedo, dtype=np.uint8)[..., 3].astype(np.float32) / 255.0
    current_values = np.asarray(current, dtype=np.uint8)
    generated_values = np.asarray(generated, dtype=np.uint8)

    # The source alpha is the canonical UV silhouette. Model output contributes
    # only the corrected tissue-thickness values inside that exact silhouette.
    values = np.rint(generated_values.astype(np.float32) * alpha).astype(np.uint8)
    values[current_values == 0] = 0

    candidate = Image.fromarray(values, mode="L").convert("RGB")
    output_path = OUTPUT_DIR / f"{job['name']}_translucency.png"
    candidate.save(output_path, format="PNG", optimize=True)
    print(output_path)
