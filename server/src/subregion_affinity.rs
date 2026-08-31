use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::db::*;

const RESIDENCE_RURAL_AREA: f64 = 420.0;
const RESIDENCE_URBAN_AREA: f64 = 320.0;
const BUILDING_RURAL_MARGIN: f64 = 9.0;
const BUILDING_URBAN_MARGIN: f64 = 12.0;

#[derive(Clone, Copy, Debug, Default)]
pub struct LandUseProfile {
    pub meadow: f64,
    pub woodland: f64,
    pub farmland: f64,
    pub rural: f64,
    pub urban: f64,
}

impl LandUseProfile {
    pub fn meadow_multiplier(self) -> f64 {
        1.0 + (self.meadow * 0.34).min(0.20)
    }

    pub fn pollination_multiplier(self) -> f64 {
        self.meadow_multiplier()
    }

    pub fn forestry_multiplier(self) -> f64 {
        1.0 + (self.woodland * 0.32).min(0.18)
    }

    pub fn meadow_grazing_multiplier(self) -> f64 {
        1.0 + (self.meadow * 0.18).min(0.10)
    }

    pub fn woodland_pannage_multiplier(self) -> f64 {
        1.0 + (self.woodland * 0.22).min(0.12)
    }

    pub fn woodland_wild_harvest_multiplier(self) -> f64 {
        1.0 + (self.woodland * 0.20).min(0.10)
    }

    pub fn cultivation_multiplier(self) -> f64 {
        1.0 + (self.farmland * 0.75).min(0.15)
    }

    pub fn husbandry_multiplier(self) -> f64 {
        1.0 + (self.rural * 0.60).min(0.12)
    }

    pub fn industry_multiplier(self) -> f64 {
        1.0 + (self.urban * 0.60).min(0.12)
    }

    /// Compose every land-use affinity that changes a building's production
    /// cycle. Categories remain independent, so a tannery can benefit from
    /// both woodland bark gathering and urban workshop practice.
    pub fn production_throughput_multiplier(self, kind: &str) -> f64 {
        let industry = if is_urban_workshop(kind) {
            self.industry_multiplier()
        } else {
            1.0
        };
        let woodland = if kind == "tannery" {
            self.forestry_multiplier()
        } else {
            1.0
        };
        let meadow = if kind == "windmill" {
            self.meadow_multiplier()
        } else {
            1.0
        };
        let farmland = if kind == "monastery" {
            self.cultivation_multiplier()
        } else {
            1.0
        };
        industry * woodland * meadow * farmland
    }
}

pub fn compute_land_use_profile(ctx: &ReducerContext) -> LandUseProfile {
    let Some(config) = ctx.db.world_config().id().find(&0) else {
        return LandUseProfile {
            meadow: 0.61,
            woodland: 0.39,
            ..LandUseProfile::default()
        };
    };
    let generation_size = match config.map_size {
        0 => 620.0,
        2 => 1_753.624_817_342_637_8,
        _ => 1_240.0,
    };
    let total_area = generation_size * generation_size;
    let mut farmland_area = ctx
        .db
        .farm_field()
        .iter()
        .map(|field| field.area.max(0.0))
        .sum::<f64>();
    farmland_area += ctx
        .db
        .vineyard_parcel()
        .iter()
        .map(|parcel| parcel.area.max(0.0))
        .sum::<f64>();
    let mut rural_area = ctx
        .db
        .pasture()
        .iter()
        .map(|pasture| pasture.area.max(0.0))
        .sum::<f64>();
    let mut urban_area = 0.0;

    for building in ctx.db.building().iter() {
        let Some(definition) = building_def(&building.kind) else {
            continue;
        };
        let rural = is_rural_building(&building.kind);
        let margin = if rural {
            BUILDING_RURAL_MARGIN
        } else {
            BUILDING_URBAN_MARGIN
        };
        let claim = std::f64::consts::PI * (definition.pick_radius + margin).powi(2);
        if rural {
            rural_area += claim;
        } else {
            urban_area += claim;
        }
    }
    for residence in ctx.db.residence().iter() {
        if residence.tier >= 3 {
            urban_area += RESIDENCE_URBAN_AREA;
        } else {
            rural_area += RESIDENCE_RURAL_AREA;
        }
    }

    let raw_claimed = farmland_area + rural_area + urban_area;
    let claim_scale = if raw_claimed > total_area {
        total_area / raw_claimed
    } else {
        1.0
    };
    farmland_area *= claim_scale;
    rural_area *= claim_scale;
    urban_area *= claim_scale;
    let natural_area = (total_area - farmland_area - rural_area - urban_area).max(0.0);
    let woodland_ratio = 0.18 + f64::from(config.forest_density.min(100)) / 100.0 * 0.42;
    let woodland_area = natural_area * woodland_ratio;
    let meadow_area = natural_area - woodland_area;

    LandUseProfile {
        meadow: meadow_area / total_area,
        woodland: woodland_area / total_area,
        farmland: farmland_area / total_area,
        rural: rural_area / total_area,
        urban: urban_area / total_area,
    }
}

pub fn is_urban_workshop(kind: &str) -> bool {
    matches!(
        kind,
        "charcoal_burner"
            | "smithy"
            | "weaponsmith_armorer"
            | "bowyer_fletcher"
            | "potter_kiln"
            | "brewery"
            | "smokehouse"
            | "bakery"
            | "carpenter"
            | "spinning_retting_house"
            | "weaver"
            | "tannery"
            | "cobbler"
            | "chandlery"
    )
}

fn is_rural_building(kind: &str) -> bool {
    matches!(
        kind,
        "founders_camp"
            | "salvage_pile"
            | "reforester"
            | "woodcutters_lodge"
            | "stone_quarry"
            | "large_quarry"
            | "mine"
            | "well"
            | "hunters_hall"
            | "foragers_shed"
            | "fishing_camp"
            | "wayside_shrine"
            | "stable"
            | "watchtower"
            | "palisaded_refuge"
            | "threshing_barn"
            | "pastoral_farmstead"
            | "swineherd"
            | "monastery"
            | "apiary"
            | "watermill"
            | "windmill"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn affinities_are_global_bounded_multipliers() {
        let meadow_realm = LandUseProfile {
            meadow: 0.70,
            woodland: 0.20,
            farmland: 0.04,
            rural: 0.04,
            urban: 0.02,
        };
        let urban_realm = LandUseProfile {
            meadow: 0.20,
            woodland: 0.15,
            farmland: 0.15,
            rural: 0.20,
            urban: 0.30,
        };
        assert!(meadow_realm.pollination_multiplier() > urban_realm.pollination_multiplier());
        assert!(meadow_realm.meadow_grazing_multiplier() > urban_realm.meadow_grazing_multiplier());
        assert!(
            meadow_realm.woodland_pannage_multiplier() > urban_realm.woodland_pannage_multiplier()
        );
        assert!(
            meadow_realm.woodland_wild_harvest_multiplier()
                > urban_realm.woodland_wild_harvest_multiplier()
        );
        assert!(urban_realm.industry_multiplier() > meadow_realm.industry_multiplier());
        assert!(
            meadow_realm.production_throughput_multiplier("tannery")
                > meadow_realm.production_throughput_multiplier("cobbler")
        );
        assert!(
            (meadow_realm.production_throughput_multiplier("tannery")
                - meadow_realm.forestry_multiplier() * meadow_realm.industry_multiplier())
            .abs()
                < 1e-12
        );
        assert_eq!(
            meadow_realm.production_throughput_multiplier("windmill"),
            meadow_realm.meadow_multiplier()
        );
        assert_eq!(
            urban_realm.production_throughput_multiplier("monastery"),
            urban_realm.cultivation_multiplier()
        );
        assert!(meadow_realm.pollination_multiplier() <= 1.20);
        assert!(meadow_realm.meadow_grazing_multiplier() <= 1.10);
        assert!(meadow_realm.woodland_pannage_multiplier() <= 1.12);
        assert!(meadow_realm.woodland_wild_harvest_multiplier() <= 1.10);
        assert!(urban_realm.industry_multiplier() <= 1.12);
    }

    #[test]
    fn five_land_uses_form_one_whole() {
        let profile = LandUseProfile {
            meadow: 0.42,
            woodland: 0.31,
            farmland: 0.12,
            rural: 0.09,
            urban: 0.06,
        };
        let sum =
            profile.meadow + profile.woodland + profile.farmland + profile.rural + profile.urban;
        assert!((sum - 1.0).abs() < 1e-12);
    }
}
