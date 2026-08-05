from pathlib import Path

import numpy as np
from PIL import Image


PAIRS = [
    (
        Path(r"C:\WebProjects\medieval-road-system\.tmp\seedthree-fern\assets\leaves\fern_albedo.png"),
        Path(r"C:\Users\Asus\.codex\generated_images\019fd21f-55fe-7b71-b1f3-d577f3d56c56\exec-8078eeef-092c-43b0-b95e-946ef9ab1b9c.png"),
    ),
    (
        Path(r"C:\WebProjects\medieval-road-system\.tmp\seedthree-juniper\assets\leaves\juniper_scrub_albedo.png"),
        Path(r"C:\Users\Asus\.codex\generated_images\019fd21f-55fe-7b71-b1f3-d577f3d56c56\exec-43acda84-b7af-4ef6-bed1-5bc39edd9f67.png"),
    ),
    (
        Path(r"C:\WebProjects\medieval-road-system\.tmp\seedthree-cattail\assets\leaves\cattail_reed_card.png"),
        Path(r"C:\Users\Asus\.codex\generated_images\019fd21f-55fe-7b71-b1f3-d577f3d56c56\exec-d3812fd5-c5f8-4097-bd9e-b865a4f3063c.png"),
    ),
]


for albedo_path, generated_path in PAIRS:
    albedo = Image.open(albedo_path).convert("RGBA")
    generated = Image.open(generated_path).convert("L")
    if generated.size != albedo.size:
        generated = generated.resize(albedo.size, Image.Resampling.LANCZOS)

    alpha = np.asarray(albedo)[..., 3]
    values = np.asarray(generated)
    alpha_mask = alpha > 32
    generated_mask = values > 16
    intersection = np.count_nonzero(alpha_mask & generated_mask)
    union = np.count_nonzero(alpha_mask | generated_mask)
    inside = values[alpha_mask]
    outside = values[~alpha_mask]

    print(albedo_path.name)
    print(f"  size: {albedo.size}")
    print(f"  alpha coverage: {alpha_mask.mean() * 100:.2f}%")
    print(f"  generated coverage: {generated_mask.mean() * 100:.2f}%")
    print(f"  mask IoU: {intersection / union:.4f}")
    print(f"  outside mean/max: {outside.mean():.2f}/{outside.max()}")
    print(f"  inside percentiles: {np.percentile(inside, [0, 5, 25, 50, 75, 95, 100]).round(1)}")
