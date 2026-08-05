from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(r"C:\WebProjects\medieval-road-system\.tmp")
JOBS = [
    (
        ROOT / "seedthree-fern" / "assets" / "leaves" / "fern_translucency.png",
        ROOT / "seedthree-fern" / "assets" / "leaves" / "fern_albedo.png",
        (1254, 1254),
    ),
    (
        ROOT / "seedthree-juniper" / "assets" / "leaves" / "juniper_scrub_translucency.png",
        ROOT / "seedthree-juniper" / "assets" / "leaves" / "juniper_scrub_albedo.png",
        (1254, 1254),
    ),
    (
        ROOT / "seedthree-cattail" / "assets" / "leaves" / "cattail_reed_card_translucency.png",
        ROOT / "seedthree-cattail" / "assets" / "leaves" / "cattail_reed_card.png",
        (1024, 1024),
    ),
]


for map_path, albedo_path, expected_size in JOBS:
    with Image.open(map_path) as source:
        source.verify()
    transmission = Image.open(map_path)
    albedo = Image.open(albedo_path).convert("RGBA")

    assert transmission.size == expected_size
    assert albedo.size == expected_size
    assert transmission.mode == "RGB"

    rgb = np.asarray(transmission, dtype=np.uint8)
    alpha = np.asarray(albedo, dtype=np.uint8)[..., 3]
    assert np.array_equal(rgb[..., 0], rgb[..., 1])
    assert np.array_equal(rgb[..., 1], rgb[..., 2])
    assert np.all(rgb[alpha == 0] == 0)

    values = rgb[..., 0][alpha > 128]
    percentiles = np.percentile(values, [5, 25, 50, 75, 95])
    assert np.unique(values).size >= 128
    assert percentiles[0] < 80
    assert percentiles[-1] > 175

    print(
        f"{map_path.name}: {transmission.size} {transmission.mode}; "
        f"inside p05/p25/p50/p75/p95={percentiles.round(1)}; "
        f"levels={np.unique(values).size}"
    )
