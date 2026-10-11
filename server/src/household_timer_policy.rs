//! Counters anchored to the household service clock rather than rewritten
//! every tick. The clock itself excludes pauses and named holy days.
pub fn counter_at(base: u32, base_tick: u64, rate: i8, tick: u64) -> u32 {
    let elapsed = tick.saturating_sub(base_tick);
    if rate >= 0 {
        base.saturating_add(elapsed.saturating_mul(rate as u64).min(u32::MAX as u64) as u32)
    } else {
        base.saturating_sub(elapsed.saturating_mul(-(rate as i16) as u64).min(u32::MAX as u64) as u32)
    }
}

/// Keep the original anchor if it already describes this counter exactly.
pub fn retain_anchor(base: u32, base_tick: u64, rate: i8, tick: u64, value: u32, next_rate: i8) -> bool {
    rate == next_rate && counter_at(base, base_tick, rate, tick) == value
}

/// Stock transfers do not advance welfare. A row already evaluated by this
/// transaction's household step keeps its output-clock anchor.
pub fn write_tick(input: u64, output: u64, existing_anchor: u64, stepped: bool) -> u64 {
    if stepped { output } else { input.max(existing_anchor.min(output)) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stock_transfers_preserve_the_welfare_step() {
        let mut anchor = (1, 10, 1);
        for output in 11..=1000 {
            let input = output - 1;
            let prior = counter_at(anchor.0, anchor.1, anchor.2, input);
            let stock_tick = write_tick(input, output, anchor.1, false);
            assert!(retain_anchor(anchor.0, anchor.1, anchor.2, stock_tick, prior, 1));
            // Changed stock may stamp a fresh, equivalent anchor.
            anchor = (prior, stock_tick, 1);
            let next = prior + 1;
            assert!(retain_anchor(anchor.0, anchor.1, anchor.2, output, next, 1));
            let cached = (next, output, 1);
            assert_eq!(write_tick(input, output, cached.1, false), output);
            assert_eq!(counter_at(cached.0, cached.1, cached.2, input), next);
        }
        assert_eq!(counter_at(anchor.0, anchor.1, anchor.2, 1000), 991);
    }
    #[test]
    fn uninterrupted_shortages_do_not_require_counter_writes() {
        for tick in 11..=60_010 {
            assert_eq!(counter_at(1, 10, 1, tick), (tick-9) as u32);
            assert!(retain_anchor(1,10,1,tick,(tick-9) as u32,1));
        }
        assert!(!retain_anchor(1,10,1,100,0,0));
    }
    #[test]
    fn recovery_clamps_and_holidays_hold_the_service_clock() {
        let mut value=32u32;
        for tick in 101..=120 {
            value=value.saturating_sub(2);
            assert_eq!(counter_at(32,100,-2,tick),value);
            assert!(retain_anchor(32,100,-2,tick,value,-2));
        }
        for _ in 0..600 { assert_eq!(counter_at(32,100,-2,103),26); }
        assert_eq!(counter_at(32,100,0,u64::MAX),32);
        assert_eq!(counter_at(u32::MAX-1,1,1,u64::MAX),u32::MAX);
        assert_eq!(counter_at(32,100,1,50),32);
    }
    #[test]
    fn changing_rates_matches_tick_by_tick_welfare() {
        let mut anchor=(0,0,0);
        let mut expected=0u32;
        let mut writes=0;
        for tick in 1..=10_000 {
            let rate=if tick<4_000 || tick>=8_000 {1} else {-2};
            expected=if rate>0 {expected.saturating_add(1)} else {expected.saturating_sub(2)};
            if !retain_anchor(anchor.0,anchor.1,anchor.2,tick,expected,rate) {
                anchor=(expected,tick,rate); writes+=1;
            }
            assert_eq!(counter_at(anchor.0,anchor.1,anchor.2,tick),expected);
        }
        assert_eq!(writes,3);
    }
}
