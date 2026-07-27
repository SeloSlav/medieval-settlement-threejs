use crate::balance_generated::BackyardGardenKind;
use crate::season_policy::{EnvironmentState, Season, WeatherKind};

/// Calendar- and weather-bound output shared by household food and market
/// activity. Orchards concentrate their annual crop into September; poultry
/// remains productive through winter; drought cuts exposed annual plants.
pub fn backyard_garden_seasonal_multiplier(
    kind: BackyardGardenKind,
    month: u32,
    environment: EnvironmentState,
) -> f64 {
    use BackyardGardenKind::*;
    let base = match kind {
        AppleOrchard | CherryOrchard => {
            if month == 9 {
                12.0
            } else {
                0.0
            }
        }
        VegetableGarden | HerbGarden => match environment.season {
            Season::Spring | Season::Summer => 1.0,
            Season::Autumn => 0.55,
            Season::Winter => 0.0,
        },
        FlowerGarden => match environment.season {
            Season::Spring => 1.4,
            Season::Summer => 1.0,
            Season::Autumn => 0.35,
            Season::Winter => 0.0,
        },
        HenYard => {
            if environment.season == Season::Winter {
                0.75
            } else {
                1.0
            }
        }
    };
    if environment.weather == WeatherKind::Drought
        && !matches!(kind, HenYard | AppleOrchard | CherryOrchard)
    {
        base * 0.55
    } else {
        base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(season: Season, weather: WeatherKind) -> EnvironmentState {
        EnvironmentState { season, weather }
    }

    #[test]
    fn orchards_concentrate_the_crop_into_september() {
        let autumn = environment(Season::Autumn, WeatherKind::Fair);
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AppleOrchard, 8, autumn,),
            0.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::CherryOrchard, 9, autumn,),
            12.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AppleOrchard, 10, autumn,),
            0.0,
        );
    }

    #[test]
    fn annual_plants_follow_the_growing_season() {
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::VegetableGarden,
                4,
                environment(Season::Spring, WeatherKind::Fair),
            ),
            1.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::HerbGarden,
                10,
                environment(Season::Autumn, WeatherKind::Fair),
            ),
            0.55,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::FlowerGarden,
                1,
                environment(Season::Winter, WeatherKind::Frost),
            ),
            0.0,
        );
    }

    #[test]
    fn drought_spares_orchards_and_hens_but_cuts_exposed_plants() {
        let drought = environment(Season::Summer, WeatherKind::Drought);
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::VegetableGarden, 7, drought,),
            0.55,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::HenYard, 7, drought,),
            1.0,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(BackyardGardenKind::AppleOrchard, 9, drought,),
            12.0,
        );
    }

    #[test]
    fn hens_trade_lower_output_for_year_round_resilience() {
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::HenYard,
                1,
                environment(Season::Winter, WeatherKind::Frost),
            ),
            0.75,
        );
        assert_eq!(
            backyard_garden_seasonal_multiplier(
                BackyardGardenKind::HenYard,
                5,
                environment(Season::Spring, WeatherKind::Rain),
            ),
            1.0,
        );
    }
}
