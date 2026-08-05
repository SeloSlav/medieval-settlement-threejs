use crate::season_policy::WeatherKind;

const PRIMARY_CELL_SIZE: f64 = 112.0;
const DETAIL_CELL_SIZE: f64 = 47.0;

pub fn wind_site_score(seed: u64, x: f64, z: f64) -> f64 {
    let seed = seed as u32;
    let primary = value_noise(
        seed ^ 0x6a09_e667,
        x / PRIMARY_CELL_SIZE,
        z / PRIMARY_CELL_SIZE,
    );
    let detail = value_noise(
        seed ^ 0xbb67_ae85,
        x / DETAIL_CELL_SIZE,
        z / DETAIL_CELL_SIZE,
    );
    (0.12 + (primary * 0.72 + detail * 0.28) * 0.88).clamp(0.0, 1.0)
}

pub fn wind_site_throughput_multiplier(seed: u64, x: f64, z: f64) -> f64 {
    0.6 + wind_site_score(seed, x, z) * 0.8
}

pub fn wind_weather_throughput_multiplier(weather: WeatherKind) -> f64 {
    match weather {
        WeatherKind::Rain => 1.15,
        WeatherKind::Drought => 0.8,
        WeatherKind::Frost => 1.08,
        WeatherKind::Fair => 1.0,
    }
}

pub fn windmill_throughput_multiplier(
    seed: u64,
    x: f64,
    z: f64,
    weather: WeatherKind,
) -> f64 {
    wind_site_throughput_multiplier(seed, x, z)
        * wind_weather_throughput_multiplier(weather)
}

fn value_noise(seed: u32, x: f64, z: f64) -> f64 {
    let cell_x = x.floor() as i32;
    let cell_z = z.floor() as i32;
    let tx = smoothstep(x - f64::from(cell_x));
    let tz = smoothstep(z - f64::from(cell_z));
    let north = lerp(
        hash_f64(seed, cell_x, cell_z),
        hash_f64(seed, cell_x.wrapping_add(1), cell_z),
        tx,
    );
    let south = lerp(
        hash_f64(seed, cell_x, cell_z.wrapping_add(1)),
        hash_f64(seed, cell_x.wrapping_add(1), cell_z.wrapping_add(1)),
        tx,
    );
    lerp(north, south, tz)
}

fn hash_f64(seed: u32, x: i32, z: i32) -> f64 {
    let mut hash = seed
        .wrapping_add(x as u32)
        .wrapping_mul(0x85eb_ca6b);
    hash = hash
        .wrapping_add(z as u32)
        .wrapping_mul(0x85eb_ca6b);
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(0x85eb_ca6b);
    hash ^= hash >> 16;
    f64::from(hash) / f64::from(u32::MAX)
}

fn smoothstep(value: f64) -> f64 {
    value * value * (3.0 - 2.0 * value)
}

fn lerp(from: f64, to: f64, t: f64) -> f64 {
    from + (to - from) * t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wind_field_is_stable_continuous_and_spatially_meaningful() {
        let seed = 0x071a_2e0d;
        let origin = wind_site_score(seed, 0.0, 0.0);
        assert!((origin - 0.832_335_070_829_543_9).abs() < 1e-12);
        assert!((wind_site_score(seed, 120.0, -80.0) - 0.473_083_903_843_778_74).abs() < 1e-12);
        assert!((wind_site_score(seed, -280.0, -210.0) - 0.564_933_314_513_912_9).abs() < 1e-12);
        assert!((0.0..=1.0).contains(&origin));
        assert_eq!(origin, wind_site_score(seed, 0.0, 0.0));
        assert!((origin - wind_site_score(seed, 0.25, 0.25)).abs() < 0.03);

        let samples = [
            wind_site_score(seed, -280.0, -210.0),
            wind_site_score(seed, -70.0, 160.0),
            wind_site_score(seed, 120.0, -80.0),
            wind_site_score(seed, 310.0, 260.0),
        ];
        let min = samples.iter().copied().fold(f64::INFINITY, f64::min);
        let max = samples.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        assert!(max - min > 0.08);
    }

    #[test]
    fn weather_changes_windmill_pace_without_stopping_it() {
        let fair = windmill_throughput_multiplier(7, 12.0, -34.0, WeatherKind::Fair);
        let rain = windmill_throughput_multiplier(7, 12.0, -34.0, WeatherKind::Rain);
        let drought = windmill_throughput_multiplier(7, 12.0, -34.0, WeatherKind::Drought);
        assert!(rain > fair);
        assert!(fair > drought);
        assert!(drought > 0.0);
    }
}
