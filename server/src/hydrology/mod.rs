use crate::hydrology_grid_generated::{
    HYDROLOGY_GRID_MAX_X, HYDROLOGY_GRID_MAX_Z, HYDROLOGY_GRID_MIN_X, HYDROLOGY_GRID_MIN_Z,
    HYDROLOGY_GRID_RESOLUTION, HYDROLOGY_GRID_SCORES,
};

pub fn sample_hydrology_score(x: f64, z: f64) -> f64 {
    if x < HYDROLOGY_GRID_MIN_X
        || x > HYDROLOGY_GRID_MAX_X
        || z < HYDROLOGY_GRID_MIN_Z
        || z > HYDROLOGY_GRID_MAX_Z
    {
        return 0.0;
    }

    let span_x = HYDROLOGY_GRID_MAX_X - HYDROLOGY_GRID_MIN_X;
    let span_z = HYDROLOGY_GRID_MAX_Z - HYDROLOGY_GRID_MIN_Z;
    let gx = ((x - HYDROLOGY_GRID_MIN_X) / span_x) * (HYDROLOGY_GRID_RESOLUTION as f64 - 1.0);
    let gz = ((z - HYDROLOGY_GRID_MIN_Z) / span_z) * (HYDROLOGY_GRID_RESOLUTION as f64 - 1.0);

    let ix0 = gx
        .floor()
        .clamp(0.0, (HYDROLOGY_GRID_RESOLUTION - 2) as f64) as usize;
    let iz0 = gz
        .floor()
        .clamp(0.0, (HYDROLOGY_GRID_RESOLUTION - 2) as f64) as usize;
    let ix1 = ix0 + 1;
    let iz1 = iz0 + 1;
    let tx = gx - ix0 as f64;
    let tz = gz - iz0 as f64;

    let s00 = grid_at(ix0, iz0);
    let s10 = grid_at(ix1, iz0);
    let s01 = grid_at(ix0, iz1);
    let s11 = grid_at(ix1, iz1);

    let top = s00 * (1.0 - tx) + s10 * tx;
    let bottom = s01 * (1.0 - tx) + s11 * tx;
    (top * (1.0 - tz) + bottom * tz).clamp(0.0, 1.0)
}

pub fn well_capacity_from_hydrology(base_capacity: f64, hydrology_score: f64) -> f64 {
    base_capacity * (0.32 + 0.68 * hydrology_score.clamp(0.0, 1.0))
}

fn grid_at(ix: usize, iz: usize) -> f64 {
    let index = iz * HYDROLOGY_GRID_RESOLUTION + ix;
    HYDROLOGY_GRID_SCORES[index] as f64
}

#[cfg(test)]
mod tests {
    use super::sample_hydrology_score;

    #[test]
    fn hydrology_score_is_bounded() {
        let score = sample_hydrology_score(0.0, 0.0);
        assert!((0.0..=1.0).contains(&score));
    }
}
