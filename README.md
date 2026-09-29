# Raising the Bar

A two-key, physics-driven salmon-ladder climbing game. **Two keys. One ladder. How hard could it be?**

## Night Arena design

The game now opens in a dark climbing lobby with electric-lime accents, a personal best readout, and separate endless, daily and weekly modes. The arena uses steel rails, illuminated edges and a night skyline. High-contrast score panels, hand pads and a stamina meter remain readable in every zone.

Leaderboards, friend challenges, achievements, the Locker, upgrades and run results share the same theme. Sound and blood preferences are saved on the device. Dialogs support keyboard focus containment and restore focus on close. Phone, landscape and foldable layouts use the same self-contained game file as Android.

This redesign preserves the shared simulation, replay versions, existing saves and server verification. Friend invite metadata follows the current page title rather than depending on the previous theme's exact title.

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

**Build it yourself:** open `android/` in Android Studio, or run `./gradlew assembleRelease` from `android/` (needs JDK 17 and the Android SDK). The APK ends up in `android/app/build/outputs/apk/`. All builds are signed with a shared test key that's committed to the repo (`android/app/test-signing.keystore`). Because every build has the same signature, a new APK installs as an update over the old one and keeps your saved bests. The key is public, so before publishing to Google Play set `RTB_KEYSTORE_FILE`, `RTB_KEYSTORE_PASSWORD`, `RTB_KEY_ALIAS` and `RTB_KEY_PASSWORD` (as Gradle properties or environment variables) to use your own private key for release builds.

*Upgrading from a build older than 1.2.0:* those were signed with a throwaway key, so uninstall the old app once before installing 1.2.0. Updates install normally after that.

Challenge links from the app point at `https://mtdewwolf.github.io/raise-the-bar/`. That URL only works for friends if the game is published on GitHub Pages. To use a different address, change `shareHost` / `sharePath` in `android/app/build.gradle`.

## Controls

| Key | Action |
| --- | --- |
| **S** | Left arm: pull while gripping, reach up while free |
| **K** | Right arm: pull while gripping, reach up while free |
| **S + K** | Full pull-up: both arms contribute; effort drains stamina |
| Enter / Space | Start / retry / skip replay |
| Esc / P | Pause |
| M | Mute |
| B | Blood on / off (also a button on the main menu) |

**Touch (phones and tablets):** hold the **left half** of the screen for S and the **right half** for K. Both thumbs together give the full pull-up. Tap ❚❚ to pause, then tap anywhere to resume. Works in portrait and landscape, with haptic buzzes on slips and falls where the device supports it.

**How to climb:** hold a key to pull with that arm. When you **release** a key while that arm is bent (you've pulled yourself up), the hand lets go and reaches upward while the body carries its existing momentum. A free hand grabs any bar it passes, as long as it isn't moving too fast for your current grip.

- Hold S+K, then release both while still rising to **hop** the whole body up to the next bar.
- Hold S+K and release only one key to climb hand over hand.
- Pull on one side only to rotate and swing, which you need to reach offset bars.

## Learning the hop

- **Release cue.** Your arms (and the on-screen buttons) glow yellow in the sweet spot, when letting go gives a strong hop. They glow orange once you've held too long and the rise has stalled.
- **Coaching.** Until you've climbed a few bars, prompts walk you through it: hold, keep pulling, *LET GO NOW!*
- **Early bars are forgiving.** The first dozen bars allow sloppier, faster catches.
- **Slow motion** kicks in for clutch catches: grabbing a bar while dropping fast, after a long one-handed flight, or on nearly empty stamina.

## Movement physics

Pulls build force over time. Muscle strength depends on fatigue, arm position, and shortening speed; two arms contribute their own forces without a combination bonus. Releases preserve momentum. Reaching and leg movements apply balanced forces and torques through the body, so moving limbs in midair cannot lift the centre of mass.

Catch loads depend on body speed and available elbow travel. Grip load shifts between hands as the body moves sideways or one arm pulls harder. Stamina follows muscular effort and positive work. More heavily damped bars absorb load without unstable bouncing. The release cue estimates clearance to the next bar rather than triggering a launch boost.

This is a simplified athlete model tuned for two-button play. It does not simulate individual muscles or tendons. Wind, low-gravity zones, weekly assisted one-arm play, automatic catches, and upgrades remain game mechanics.

The physics uses replay versions **4** (endless/daily) and **5** (weekly). Public boards and local bests start fresh for this model; profiles, cosmetics, earned Chalk, and purchased upgrades remain. Old replays are rejected, and older friend challenges can be rematched with the new rules.

## Ghosts, replays and the Daily Ladder

The physics is fully deterministic. It uses only arithmetic that gives the same result in every browser, so a whole run is just its ladder seed plus the moments the keys changed. That's usually under 200 characters.

- **Daily Ladder:** everyone gets the same ladder each (UTC) day. Your best run on it comes back as a ghost to race.
- **Watch replay / Race this run** after any fall.
- **Share challenge:** copies a link with the run built in. Whoever opens it can watch your run or race your ghost on the exact same ladder. Links only work for other people once the game is hosted online (e.g. GitHub Pages), not from a local file.

## Friend challenges

Open **🤝 Challenge friends** to create a 24-hour group challenge, or challenge friends from a finished run. Send a tappable invite through your messaging app or let a friend scan the QR code, race the leader's ghost with equal no-upgrade rules, compare verified results, and start a rematch. Browser and Android use the same challenge server. Weekly challenge rules stay fixed even when the public event resets.

Opening an invite goes straight to the challenge with a **Join & play** button. See [friend challenge setup and testing](server/FRIEND_CHALLENGES.md).

## Zones

The ladder changes as you climb, and a banner announces each new zone:

| Height | Zone | What changes |
| --- | --- | --- |
| 0–15m | **The Gym** | Nothing: learn the basics |
| 15–40m | **The Rooftop** | Wind gusts push you sideways (see the WIND arrow), and you climb past the city's rooftops |
| 40–80m | **The Clouds** | **Wobbly bars** hang from chains, and swing and bounce when you grab them. **Icy bars** hold less weight and drain stamina, so you can't rest on them |
| 80m+ | **Space** | **Low gravity:** hops go much higher and floatier, and the bars are spread further apart |

Like everything else, the zones come from the ladder's seed, so ghosts, replays and server-verified scores all stay exact. Bar spacing is tuned for releases driven by pulling momentum. Higher up, the challenge comes from shorter, offset bars, stamina and each zone's hazards.

## Upgrades

Every run earns **🪙 Chalk**: 10 per metre climbed and 2 per bar reached. Spend it in **🛒 Upgrades** on five upgrades, each with 5 levels (80 → 150 → 280 → 500 → 900 Chalk):

| Upgrade | Effect per level |
| --- | --- |
| 💪 Explosive Pull | +8% pulling strength (keeps hops strong when you're tired) |
| 🦘 Pull Speed | +8% muscle shortening speed; previously purchased Spring Hop levels carry over |
| 🫁 Endurance | -8% stamina drain |
| 🧤 Chalk Grip | +10% grip strength |
| 🔋 Recovery | +15% stamina recovery while hanging |

The ladder stays climbable on skill alone, but from the Clouds up the gaps widen, and that's where upgrades pay off.

**Fair play:** each replay records the upgrade levels it was played with, so the server re-simulates runs with them, and it checks that the player's *verified* runs have earned enough Chalk to own them. Leaderboard entries show ⚡ with the total upgrade levels used. The **Daily Ladder is always played without upgrades**, so it stays a pure skill contest. Your Chalk and upgrades follow your profile to other devices.

## Locker

**👕 Locker** in the menu lets you dress your climber: 24 items across hats, jerseys, headbands, back items (Hero Cape, Jetpack, Angel Wings) and full suits (Banana, Salmon). Each one is unlocked by an achievement, and a live preview shows the result. Your look is saved to your profile, and your ghost wears it when other players race you from the leaderboard.

## Leaderboards and achievements

- **Leaderboards** (🏆 in the menu): today's Daily Ladder and all-time. Scores are checked by the server, which re-runs every replay through the game's physics. Press ▶ to watch any entry, or 👻 to race its ghost.
- **One profile on every device.** You get an anonymous profile with a silly name you can change. Its **sync code** carries your scores and achievements between the browser and the Android app.
- **28 achievements** (🏅 in the menu), from *Liftoff* to *Space Program*, with a pop-up when you unlock one. They're saved on the device and synced to your profile when online.
- **Works offline.** Without a server the game plays normally. Runs finished offline upload the next time the server can be reached.

Leaderboards need the small server in [`server/`](server/README.md): no dependencies, one command to start, and it can host the game itself.

## Systems

- **Verlet ragdoll** with 15 point masses, rigid torso bracing, arm and leg segments, force-limited muscles and hip/knee motors with balanced reactions. Nothing is scripted or animated: every climb comes out of forces and constraints.
- **Grip load** comes from the body's centre-of-mass acceleration. Hanging on one hand, swinging hard or catching at speed all load the grip. If the load exceeds your grip strength, you slip.
- **Stamina.** Pulling drains it (two-arm pulls drain it about 2.5× as fast as one). Hanging recovers it for a while, then starts to tire you. Low stamina weakens pulls and grip, lowers the fastest catch you can make, removes core stabilisation (more sway) and adds tremor. At zero stamina your grip gives out.
- **Procedural ladder.** Bars get further apart, shorter and more offset with height, while staying within reach.
- **Springy bars, particles, screen shake, WebAudio sound effects, and a ragdoll that tumbles off the bars when you fall.**
- **Blood (optional).** Hitting the floor sprays cartoon blood that splats on the mat and pools under the body, more for harder landings. Turn it off with **B** or the 🩸 button on the main menu; the choice is remembered.
- **Action replay.** After a fall, the last 3 seconds play back in slow motion (slowest at the slip and the landing) with a zoomed camera, deeper slowed-down sound effects and a sports-commentator line, before the game-over card. Press Enter / Space or tap to skip.
- The best height is saved in `localStorage`.
