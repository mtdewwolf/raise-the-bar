# Raising the Bar

A two-key, physics-driven salmon-ladder climbing game. **Two keys. One ladder. How hard could it be?**

## Play

Open `index.html` in any modern desktop browser. That's it: one self-contained file with no dependencies, no build step and no network access.

## Controls

| Key | Action |
| --- | --- |
| **S** | Left arm: pull while gripping, reach up while free |
| **K** | Right arm: pull while gripping, reach up while free |
| **S + K** | Full pull-up: stronger pull, drains stamina fast |
| Enter / Space | Start / retry |
| Esc / P | Pause |
| M | Mute |

**Touch (phones and tablets):** hold the **left half** of the screen for S and the **right half** for K. Both thumbs together give the full pull-up. Tap ❚❚ to pause, then tap anywhere to resume. Works in portrait and landscape, with haptic buzzes on slips and falls where the device supports it.

**How to climb:** hold a key to pull with that arm. When you **release** a key while that arm is bent (you've pulled yourself up), the hand lets go and throws itself upward. A free hand grabs any bar it passes, as long as it isn't moving too fast for your current grip.

- Hold S+K, then release both at the top to **hop** the whole body up to the next bar.
- Hold S+K and release only one key to climb hand over hand.
- Pull on one side only to rotate and swing, which you need to reach offset bars.

## Systems

- **Verlet ragdoll** with 15 point masses, rigid torso bracing, arm and leg segments, muscle forces and leg tone. Nothing is scripted or animated: every climb comes out of forces and constraints.
- **Grip load** comes from the body's centre-of-mass acceleration. Hanging on one hand, swinging hard or catching at speed all load the grip. If the load exceeds your grip strength, you slip.
- **Stamina.** Pulling drains it (two-arm pulls drain it about 2.5× as fast as one). Hanging recovers it for a while, then starts to tire you. Low stamina weakens pulls and grip, lowers the fastest catch you can make, removes core stabilisation (more sway) and adds tremor. At zero stamina your grip gives out.
- **Procedural ladder.** Bars get further apart, shorter and more offset with height, while staying within reach.
- **Springy bars, particles, screen shake, WebAudio sound effects, and a ragdoll that tumbles off the bars when you fall.**
- The best height is saved in `localStorage`.
