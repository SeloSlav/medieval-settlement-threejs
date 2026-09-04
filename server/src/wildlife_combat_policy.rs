//! Pursuit distances and speeds shared by wildlife behavior and steering.

pub const GUARD_DOG_CHASE_SPEED: f64 = 4.8;
pub const FOX_FLEE_SPEED: f64 = 3.35;
pub const WOLF_FLEE_SPEED: f64 = 3.0;
pub const ANIMAL_CONTACT_DISTANCE: f64 = 2.15;
pub const GUARD_DOG_BITE_DAMAGE: f64 = 13.0;
pub const GUARD_DOG_BITE_INTERVAL: f64 = 1.05;

/// Stop short of the prey's center and test contact after moving. Checking
/// only before movement makes a fox that moves > bite range per tick unbiteable.
pub fn guard_dog_pursuit_step(
    x: f64, z: f64, target_x: f64, target_z: f64, dt: f64,
) -> (f64, f64, bool) {
    let dx = target_x - x;
    let dz = target_z - z;
    let range = dx.hypot(dz);
    if range <= ANIMAL_CONTACT_DISTANCE {
        return (x, z, true);
    }
    let travel = (GUARD_DOG_CHASE_SPEED * dt.max(0.0))
        .min((range - ANIMAL_CONTACT_DISTANCE * 0.7).max(0.0));
    (x + dx / range * travel, z + dz / range * travel,
        range - travel <= ANIMAL_CONTACT_DISTANCE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::military_steering::{CombatSteeringGrid, SteeringBody, SteeringBounds};

    #[test]
    fn dogs_catch_and_kill_fleeing_wildlife_at_every_game_speed() {
        for game_speed in [1.0, 4.0, 8.0] {
            for flee_speed in [FOX_FLEE_SPEED, WOLF_FLEE_SPEED] {
                let dt = 0.2 * 0.75 * game_speed;
                let mut dog_x = 0.0;
                let mut prey_x = 14.0;
                let mut health = 70.0;
                let mut cooldown: f64 = 0.0;
                for _ in 0..(30.0 / dt) as usize {
                    cooldown = (cooldown - dt).max(0.0);
                    let (x, z, contact) = guard_dog_pursuit_step(dog_x, 0.0, prey_x, 0.0, dt);
                    assert_eq!(z, 0.0);
                    dog_x = x;
                    assert!(dog_x <= prey_x, "pursuit must not pass through prey");
                    if contact && cooldown <= 0.0 {
                        health -= GUARD_DOG_BITE_DAMAGE;
                        cooldown = GUARD_DOG_BITE_INTERVAL;
                    }
                    if health <= 0.0 { break; }
                    prey_x += flee_speed * dt;
                }
                assert!(health <= 0.0, "prey at {flee_speed} escaped a dog at {game_speed}x");
            }
        }
    }

    #[test]
    fn distant_or_paused_dogs_cannot_bite() {
        assert_eq!(guard_dog_pursuit_step(0.0, 0.0, 20.0, 0.0, 0.0), (0.0, 0.0, false));
        assert!(!guard_dog_pursuit_step(0.0, 0.0, 20.0, 0.0, 0.15).2);
        assert!(guard_dog_pursuit_step(0.0, 0.0, 5.0, 0.0, 1.2).2);
    }

    #[test]
    fn pursuit_survives_shared_steering_and_separation() {
        for game_speed in [1.0, 4.0, 8.0] {
            for flee_speed in [FOX_FLEE_SPEED, WOLF_FLEE_SPEED] {
                let dt = 0.2 * 0.75 * game_speed;
                let mut dog = SteeringBody { id: 1, faction: 12, target_id: 2,
                    ..SteeringBody::default() };
                let mut prey = SteeringBody { id: 2, faction: 13, x: 14.0,
                    ..SteeringBody::default() };
                let mut grid = CombatSteeringGrid::default();
                let mut health = 70.0;
                let mut cooldown: f64 = 0.0;
                for _ in 0..(40.0 / dt) as usize {
                    cooldown = (cooldown - dt).max(0.0);
                    let (x, z, contact) = guard_dog_pursuit_step(dog.x, dog.z, prey.x, prey.z, dt);
                    if contact && cooldown <= 0.0 {
                        health -= GUARD_DOG_BITE_DAMAGE;
                        cooldown = GUARD_DOG_BITE_INTERVAL;
                    }
                    if health <= 0.0 { break; }
                    // Match the final writer: faction intent is constrained by
                    // the same shared crowd solver before the next heartbeat.
                    dog.goal_x = x;
                    dog.goal_z = z;
                    dog.speed = (x - dog.x).hypot(z - dog.z) / dt;
                    prey.goal_x = prey.x + flee_speed * dt;
                    prey.goal_z = prey.z;
                    prey.speed = flee_speed;
                    grid.begin();
                    grid.push(dog);
                    grid.push(prey);
                    grid.finish();
                    grid.integrate_all_bounded(dt, SteeringBounds {
                        min_x: -500.0, max_x: 500.0, min_z: -500.0, max_z: 500.0,
                    });
                    dog = grid.body(0);
                    prey = grid.body(1);
                }
                assert!(health <= 0.0, "steering let prey at {flee_speed} escape at {game_speed}x");
            }
        }
    }
}
