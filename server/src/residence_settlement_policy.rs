/// New households may occupy an empty cottage before local distribution is
/// established. Once a household exists, further arrivals require every
/// tier-active need to hold its established recovery buffer.
pub fn settlement_buffers_ready<I>(population: u32, buffers: I) -> bool
where
    I: IntoIterator<Item = (f64, f64)>,
{
    population == 0
        || buffers
            .into_iter()
            .all(|(stock, required)| stock + 1e-9 >= required.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::settlement_buffers_ready;
    use std::time::{Duration, Instant};

    #[test]
    fn first_settler_can_establish_an_empty_household() {
        assert!(settlement_buffers_ready(0, [(0.0, 6.0), (0.0, 8.0)]));
    }

    #[test]
    fn established_household_waits_for_every_active_buffer() {
        assert!(!settlement_buffers_ready(
            3,
            [(8.0, 8.0), (4.9, 5.0), (6.0, 6.0)]
        ));
        assert!(settlement_buffers_ready(
            3,
            [(8.0, 8.0), (5.0, 5.0), (6.0, 6.0)]
        ));
    }

    #[test]
    fn negative_thresholds_cannot_block_growth() {
        assert!(settlement_buffers_ready(2, [(0.0, -1.0)]));
    }

    #[test]
    fn large_settlement_forecasts_remain_allocation_free_and_fast() {
        let started = Instant::now();
        let mut ready = 0_u32;
        for index in 0..100_000 {
            if settlement_buffers_ready(
                6,
                [
                    (8.0, 8.0),
                    (5.0, 5.0),
                    (6.0, 6.0),
                    (4.0, 4.0),
                    (3.0, 3.0),
                    (if index % 2 == 0 { 2.0 } else { 1.0 }, 2.0),
                ],
            ) {
                ready += 1;
            }
        }
        assert_eq!(ready, 50_000);
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
