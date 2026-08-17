pub const THRESHING_PRIORITY_LOW: u8 = 1;
pub const THRESHING_PRIORITY_AUTO: u8 = 2;
pub const THRESHING_PRIORITY_HIGH: u8 = 3;
pub const THRESHING_PRIORITY_DEFAULT: u8 = THRESHING_PRIORITY_AUTO;

const TASK_IDLE: u8 = 0;
const TASK_SURPLUS_THRESHING: u8 = 1;
const TASK_NORMAL_FIELD: u8 = 2;
const TASK_DEMAND_THRESHING: u8 = 3;
const TASK_HIGH_FIELD: u8 = 4;
const TASK_URGENT_FIELD: u8 = 5;
const TASK_PRIORITY_THRESHING: u8 = 6;
const TASK_HARVEST: u8 = 7;

pub fn is_valid_threshing_priority(priority: u8) -> bool {
    matches!(
        priority,
        THRESHING_PRIORITY_LOW | THRESHING_PRIORITY_AUTO | THRESHING_PRIORITY_HIGH
    )
}

pub fn normalize_threshing_priority(priority: u8) -> u8 {
    if is_valid_threshing_priority(priority) {
        priority
    } else {
        THRESHING_PRIORITY_DEFAULT
    }
}

/// Harvesting is always the farm crew's first duty because an unfinished crop
/// is lost at the end of its harvest window. The player's priority controls the
/// order of all less perishable field work.
pub fn field_task_rank(priority: u8, harvesting: bool) -> u8 {
    if priority == 0 {
        return TASK_IDLE;
    }
    if harvesting {
        return TASK_HARVEST;
    }
    match priority {
        3 => TASK_URGENT_FIELD,
        2 => TASK_HIGH_FIELD,
        _ => TASK_NORMAL_FIELD,
    }
}

/// Low leaves threshing until field work is quiet. Auto restores seed and one
/// dispatch load between high and normal field work, then returns to the
/// fields. High deliberately puts threshing ahead of every non-harvest job.
pub fn threshing_task_rank(priority: u8, demanded: bool) -> u8 {
    match normalize_threshing_priority(priority) {
        THRESHING_PRIORITY_HIGH => TASK_PRIORITY_THRESHING,
        THRESHING_PRIORITY_AUTO if demanded => TASK_DEMAND_THRESHING,
        _ => TASK_SURPLUS_THRESHING,
    }
}

pub fn threshing_preempts_fields(
    priority: u8,
    demanded: bool,
    highest_ready_field_rank: u8,
) -> bool {
    threshing_task_rank(priority, demanded) > highest_ready_field_rank
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn harvest_always_preempts_threshing() {
        assert!(!threshing_preempts_fields(
            THRESHING_PRIORITY_HIGH,
            true,
            field_task_rank(1, true),
        ));
    }

    #[test]
    fn automatic_demand_sits_between_high_and_normal_fields() {
        let demand = threshing_task_rank(THRESHING_PRIORITY_AUTO, true);
        assert!(demand < field_task_rank(2, false));
        assert!(demand > field_task_rank(1, false));
    }

    #[test]
    fn high_focus_preempts_non_harvest_fieldwork() {
        assert!(threshing_preempts_fields(
            THRESHING_PRIORITY_HIGH,
            false,
            field_task_rank(3, false),
        ));
    }
}
