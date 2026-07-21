/// Population loss can leave a settlement over-assigned, so only increases are blocked.
pub fn population_limit_blocks_labor_request(
    current_labor: u32,
    requested_labor: u32,
    total_population: u32,
    assigned_elsewhere: u32,
) -> bool {
    requested_labor > current_labor
        && requested_labor > total_population.saturating_sub(assigned_elsewhere)
}

#[cfg(test)]
mod tests {
    use super::population_limit_blocks_labor_request;

    #[test]
    fn overassigned_settlements_can_reduce_building_labor() {
        assert!(!population_limit_blocks_labor_request(2, 1, 5, 6));
        assert!(!population_limit_blocks_labor_request(2, 0, 5, 6));
        assert!(!population_limit_blocks_labor_request(2, 2, 5, 6));
    }

    #[test]
    fn population_limit_still_blocks_labor_increases() {
        assert!(population_limit_blocks_labor_request(2, 3, 5, 6));
        assert!(population_limit_blocks_labor_request(1, 2, 5, 4));
        assert!(!population_limit_blocks_labor_request(1, 2, 6, 4));
    }
}
