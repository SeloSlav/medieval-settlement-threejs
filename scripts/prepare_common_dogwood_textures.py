from __future__ import annotations

import argparse
from pathlib import Path

from prepare_forest_floor_details import _save_leaf_set, _save_tile_set


OUTPUT_DIR = Path("src/assets/vegetation/common-dogwood")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Prepare project-owned common dogwood leaf and young-branch "
            "PBR/SSS maps from generated albedo sources."
        )
    )
    parser.add_argument("--leaf-source", type=Path, required=True)
    parser.add_argument("--branch-source", type=Path, required=True)
    args = parser.parse_args()

    _save_leaf_set(
        args.leaf_source,
        OUTPUT_DIR / "common_dogwood_single_albedo.png",
    )
    _save_tile_set(
        args.branch_source,
        OUTPUT_DIR / "common_dogwood_branch_albedo.png",
        normal_strength=2.7,
    )


if __name__ == "__main__":
    main()
