//! Stable brewhouse recipe policy persisted on each building.

pub const BREWERY_RECIPE_ALE: u8 = 0;
pub const BREWERY_RECIPE_CIDER: u8 = 1;
pub const BREWERY_RECIPE_MEAD: u8 = 2;
pub const BREWERY_RECIPE_AUTO: u8 = 3;
pub const BREWERY_RECIPE_PEAR_CIDER: u8 = 4;

pub fn is_valid_brewery_recipe_policy(policy: u8) -> bool {
    matches!(
        policy,
        BREWERY_RECIPE_ALE
            | BREWERY_RECIPE_CIDER
            | BREWERY_RECIPE_MEAD
            | BREWERY_RECIPE_AUTO
            | BREWERY_RECIPE_PEAR_CIDER
    )
}

pub fn normalize_brewery_recipe_policy(policy: u8) -> u8 {
    if is_valid_brewery_recipe_policy(policy) {
        policy
    } else {
        BREWERY_RECIPE_ALE
    }
}

/// Focused breweries request only the inputs used by the selected recipe.
/// Auto may request every valid recipe input so it can follow available stock.
pub fn brewery_recipe_requests_input(policy: u8, input_recipe: u8) -> bool {
    is_valid_brewery_recipe_policy(input_recipe)
        && input_recipe != BREWERY_RECIPE_AUTO
        && (normalize_brewery_recipe_policy(policy) == BREWERY_RECIPE_AUTO
            || normalize_brewery_recipe_policy(policy) == input_recipe)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_breweries_remain_on_ale_and_all_recipe_choices_are_stable() {
        assert_eq!(normalize_brewery_recipe_policy(0), BREWERY_RECIPE_ALE);
        assert_eq!(normalize_brewery_recipe_policy(1), BREWERY_RECIPE_CIDER);
        assert_eq!(normalize_brewery_recipe_policy(2), BREWERY_RECIPE_MEAD);
        assert_eq!(normalize_brewery_recipe_policy(3), BREWERY_RECIPE_AUTO);
        assert_eq!(
            normalize_brewery_recipe_policy(4),
            BREWERY_RECIPE_PEAR_CIDER
        );
        assert_eq!(normalize_brewery_recipe_policy(255), BREWERY_RECIPE_ALE);
    }

    #[test]
    fn focused_recipes_request_only_their_own_inputs_while_auto_requests_all() {
        for recipe in [
            BREWERY_RECIPE_ALE,
            BREWERY_RECIPE_CIDER,
            BREWERY_RECIPE_MEAD,
            BREWERY_RECIPE_PEAR_CIDER,
        ] {
            assert!(brewery_recipe_requests_input(BREWERY_RECIPE_AUTO, recipe));
        }
        assert!(brewery_recipe_requests_input(
            BREWERY_RECIPE_CIDER,
            BREWERY_RECIPE_CIDER
        ));
        assert!(!brewery_recipe_requests_input(
            BREWERY_RECIPE_CIDER,
            BREWERY_RECIPE_ALE
        ));
        assert!(!brewery_recipe_requests_input(
            BREWERY_RECIPE_CIDER,
            BREWERY_RECIPE_MEAD
        ));
        assert!(!brewery_recipe_requests_input(
            BREWERY_RECIPE_AUTO,
            BREWERY_RECIPE_AUTO
        ));
        assert!(!brewery_recipe_requests_input(BREWERY_RECIPE_AUTO, 255));
    }
}
