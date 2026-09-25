# Raising the Bar

A two-key, physics-driven salmon-ladder climbing game. **Two keys. One ladder. How hard could it be?**

## Play

Open `index.html` in any modern desktop browser. That's it: one self-contained file with no dependencies, no build step and no network access.

## Android

The `android/` folder is an Android app that wraps the same `index.html` in a full-screen WebView. Nothing is duplicated: the build copies the game into the APK. The app runs fully offline and adds:

- a full-screen immersive mode that keeps the screen on while you play
- the **back button**, which pauses the climb, then returns to the menu, then exits
- the Android share sheet for **Share challenge**, plus opening shared challenge links in the app
- haptics, sound and saved progress, same as the browser version
- foldable support, tuned for the Galaxy Z Fold inner screen:
  - Folding or unfolding mid-run keeps your climb going instead of restarting the app. Split screen and pop-up view work too.
  - Rendering is sharp at the inner screen's pixel density.
  - **Flex mode:** half-fold the phone in landscape (tabletop) and the climb stays on the top half while the bottom half becomes a controller with large left and right pads.

**Get an APK:** every push that touches the game builds one in GitHub Actions (*Android APK* workflow → *raising-the-bar-apk* artifact). Install `app-release.apk` on your phone; you may need to allow installs from unknown sources.

**Build it yourself:** open `android/` in Android Studio, or run `./gradlew assembleRelease` from `android/` (needs JDK 17 and the Android SDK). The APK ends up in `android/app/build/outputs/apk/`. Release builds use the debug signing key so they install straight away. Set up your own `signingConfig` before publishing to Google Play.

Challenge links from the app point at `https://mtdewwolf.github.io/raise-the-bar/`. That URL only works for friends if the game is published on GitHub Pages. To use a different address, change `shareHost` / `sharePath` in `android/app/build.gradle`.

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
- The best height is saved in `localStorage`.
