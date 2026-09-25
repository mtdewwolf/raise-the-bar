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
| Enter / Space | Start / retry / skip replay |
| Esc / P | Pause |
| M | Mute |
| B | Blood on / off (also a button on the main menu) |

**Touch (phones and tablets):** hold the **left half** of the screen for S and the **right half** for K. Both thumbs together give the full pull-up. Tap ❚❚ to pause, then tap anywhere to resume. Works in portrait and landscape, with haptic buzzes on slips and falls where the device supports it.

**How to climb:** hold a key to pull with that arm. When you **release** a key while that arm is bent (you've pulled yourself up), the hand lets go and throws itself upward. A free hand grabs any bar it passes, as long as it isn't moving too fast for your current grip.

- Hold S+K, then release both at the top to **hop** the whole body up to the next bar.
- Hold S+K and release only one key to climb hand over hand.
- Pull on one side only to rotate and swing, which you need to reach offset bars.

## Learning the hop

- **Release cue.** Your arms (and the on-screen buttons) glow yellow while letting go would launch the hand upward, and orange when you've held too long and are sinking.
- **Coaching.** Until you've climbed a few bars, prompts walk you through it: hold, keep pulling, *LET GO NOW!*
- **Early bars are forgiving.** The first dozen bars allow sloppier, faster catches.
- **Slow motion** kicks in for clutch catches: grabbing a bar while dropping fast, after a long one-handed flight, or on nearly empty stamina.

## Ghosts, replays and the Daily Ladder

The physics is fully deterministic. It uses only arithmetic that gives the same result in every browser, so a whole run is just its ladder seed plus the moments the keys changed. That's usually under 200 characters.

- **Daily Ladder:** everyone gets the same ladder each (UTC) day. Your best run on it comes back as a ghost to race.
- **Watch replay / Race this run** after any fall.
- **Share challenge:** copies a link with the run built in. Whoever opens it can watch your run or race your ghost on the exact same ladder. Links only work for other people once the game is hosted online (e.g. GitHub Pages), not from a local file.

## Systems

- **Verlet ragdoll** with 15 point masses, rigid torso bracing, arm and leg segments, muscle forces and leg tone. Nothing is scripted or animated: every climb comes out of forces and constraints.
- **Grip load** comes from the body's centre-of-mass acceleration. Hanging on one hand, swinging hard or catching at speed all load the grip. If the load exceeds your grip strength, you slip.
- **Stamina.** Pulling drains it (two-arm pulls drain it about 2.5× as fast as one). Hanging recovers it for a while, then starts to tire you. Low stamina weakens pulls and grip, lowers the fastest catch you can make, removes core stabilisation (more sway) and adds tremor. At zero stamina your grip gives out.
- **Procedural ladder.** Bars get further apart, shorter and more offset with height, while staying within reach.
- **Springy bars, particles, screen shake, WebAudio sound effects, and a ragdoll that tumbles off the bars when you fall.**
- **Blood (optional).** Hitting the floor sprays cartoon blood that splats on the mat and pools under the body, more for harder landings. Turn it off with **B** or the 🩸 button on the main menu; the choice is remembered.
- **Action replay.** After a fall, the last 3 seconds play back in slow motion (slowest at the slip and the landing) with a zoomed camera, deeper slowed-down sound effects and a sports-commentator line, before the game-over card. Press Enter / Space or tap to skip.
- The best height is saved in `localStorage`.
