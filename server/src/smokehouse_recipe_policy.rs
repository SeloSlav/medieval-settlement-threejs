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
}
