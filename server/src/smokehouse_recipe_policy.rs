//! Stable player-selected Smokehouse recipe.

pub const SMOKEHOUSE_RECIPE_AUTO: u8 = 0;
pub const SMOKEHOUSE_RECIPE_CURED_MEAT: u8 = 1;
pub const SMOKEHOUSE_RECIPE_SMOKED_FISH: u8 = 2;
pub const SMOKEHOUSE_RECIPE_CHEESE: u8 = 3;

pub fn is_valid_smokehouse_recipe_policy(policy: u8) -> bool {
    matches!(
        policy,
        SMOKEHOUSE_RECIPE_AUTO
            | SMOKEHOUSE_RECIPE_CURED_MEAT
            | SMOKEHOUSE_RECIPE_SMOKED_FISH
            | SMOKEHOUSE_RECIPE_CHEESE
    )
}

pub fn normalize_smokehouse_recipe_policy(policy: u8) -> u8 {
    if is_valid_smokehouse_recipe_policy(policy) {
        policy
    } else {
        SMOKEHOUSE_RECIPE_AUTO
    }
}

/// Whether a Smokehouse should actively request the food input represented by
/// `input_recipe`. Auto may request every valid recipe input; an explicit
/// choice requests only its own ingredient. This is intentionally separate
/// from physical storage acceptance so existing and inbound alternate stock is
/// never rejected or deleted.
pub fn smokehouse_recipe_requests_input(policy: u8, input_recipe: u8) -> bool {
    is_valid_smokehouse_recipe_policy(input_recipe)
        && input_recipe != SMOKEHOUSE_RECIPE_AUTO
        && (matches!(
            normalize_smokehouse_recipe_policy(policy),
            SMOKEHOUSE_RECIPE_AUTO
        ) || normalize_smokehouse_recipe_policy(policy) == input_recipe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_rows_remain_automatic_and_explicit_recipes_are_stable() {
        assert_eq!(normalize_smokehouse_recipe_policy(0), SMOKEHOUSE_RECIPE_AUTO);
        assert_eq!(
            normalize_smokehouse_recipe_policy(SMOKEHOUSE_RECIPE_CURED_MEAT),
            SMOKEHOUSE_RECIPE_CURED_MEAT
        );
        assert_eq!(
            normalize_smokehouse_recipe_policy(SMOKEHOUSE_RECIPE_SMOKED_FISH),
            SMOKEHOUSE_RECIPE_SMOKED_FISH
        );
        assert_eq!(
            normalize_smokehouse_recipe_policy(SMOKEHOUSE_RECIPE_CHEESE),
            SMOKEHOUSE_RECIPE_CHEESE
        );
        assert_eq!(normalize_smokehouse_recipe_policy(255), SMOKEHOUSE_RECIPE_AUTO);
    }

    #[test]
    fn automatic_requests_every_recipe_while_explicit_focus_requests_only_its_input() {
        for input in [
            SMOKEHOUSE_RECIPE_CURED_MEAT,
            SMOKEHOUSE_RECIPE_SMOKED_FISH,
            SMOKEHOUSE_RECIPE_CHEESE,
        ] {
            assert!(smokehouse_recipe_requests_input(SMOKEHOUSE_RECIPE_AUTO, input));
        }
        assert!(smokehouse_recipe_requests_input(
            SMOKEHOUSE_RECIPE_SMOKED_FISH,
            SMOKEHOUSE_RECIPE_SMOKED_FISH
        ));
        assert!(!smokehouse_recipe_requests_input(
            SMOKEHOUSE_RECIPE_SMOKED_FISH,
            SMOKEHOUSE_RECIPE_CURED_MEAT
        ));
        assert!(!smokehouse_recipe_requests_input(
            SMOKEHOUSE_RECIPE_CHEESE,
            SMOKEHOUSE_RECIPE_AUTO
        ));
        assert!(!smokehouse_recipe_requests_input(
            SMOKEHOUSE_RECIPE_CURED_MEAT,
            255
        ));
    }
}
