from __future__ import annotations

from .core import Registry
from .families import (
    agriculture,
    civic,
    enclosures,
    extraction,
    foundations,
    frames,
    openings,
    production,
    props,
    roofs,
    siteworks,
    walls,
)


FAMILY_MODULES = (
    foundations,
    walls,
    frames,
    openings,
    roofs,
    enclosures,
    siteworks,
    extraction,
    production,
    agriculture,
    civic,
    props,
)


def build_registry() -> Registry:
    registry = Registry()
    for module in FAMILY_MODULES:
        module.register(registry)
    return registry
