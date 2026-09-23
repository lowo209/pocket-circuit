# Pocket Circuit — Godot v0.2.1 development preview

A new standalone Windows game built with Godot 4 and GDScript. The repository's original web game remains a reference. Development of the rebuild happens here.

**This is a playable visual-remake milestone, not a finished public release.** Three locations from the web game now have new geometry, original surface textures, lighting and atmosphere. It is currently single-player; the full realistic remake remains in development.

## Play

Extract the entire `PocketCircuit_v0.2.1-dev.zip` into one folder and run `PocketCircuit.exe`. Keep `PocketCircuit.pck` beside it. Godot is not required on the player's PC. Do not run directly from inside the ZIP.

v0.2.1 fixes curb/guardrail alignment and wheel rotation, redesigns the race HUD, and adds static environment reflection probes with retuned lighting and surface roughness. These are approximate static reflections, not ray tracing or fully dynamic mirrors. Low quality disables the probes.

Choose Sunset Bay, Dust Valley or Neon Harbor from the menu. Explore Paddock lets you drive around the selected location. Drive near the PIT CLUB sign and press E to start, or choose Quick Race. Complete three laps through the checkpoints, see your result, and return to the paddock. A race has a five-minute time limit; unfinished races award no coins.

| Input | Action |
| --- | --- |
| W / up | Accelerate |
| S / down | Brake, then reverse |
| A/D / left/right | Steer |
| Shift + steering | Drift; release after charging for a boost |
| Space | Use rechargeable boost |
| E | Start race near the club sign |
| R | Recover to the track behind the next checkpoint |
| Esc | Pause / resume |

## Included

- Main menu, drivable paddocks and three circuits based on the original web layouts.
- Sculpted kart bodies, helmeted drivers, wheel hubs, six liveries and five AI opponents.
- Arcade driving, drift boosts, rechargeable boost, car collisions and recovery.
- Countdown, ordered gates, three laps, position display and results.
- Coins, race count, best lap, settings and AI skill saved locally.
- Low/Medium/High/Ultra presets, fullscreen, VSync, FPS cap and engine volume.
- Tire/boost particles, chase camera, live minimap and a generated engine sound.
- Textured asphalt, sandstone and plaster; original coast/canyon/harbor scenery, water shader and night rain.
- Saved map scenes with editable objects, collisions, materials and lights.
- Windows x86-64 export preset and packaging script.

## Adaptive AI

Bots steer and accelerate through the same kart controller as the player. They follow a shared track centerline, slow for corners and choose an overtaking lane. Higher skill enables more pace, drift and straight-line boosts.

Completed player lap times estimate average speed. After each completed race, skill moves by at most 0.08 toward that estimate and is saved. Bots use that value at the start of the next race. There are no hidden mid-race speed multipliers or teleports to catch the player. Stuck bots can recover behind their next checkpoint, just as the player can. Turning Adaptive AI off uses fixed medium difficulty. This is a transparent rule-based difficulty system, not machine learning; tuning against real players is still needed.

## Open the source

Import `project.godot` in Godot 4.7.2, the installed version used to validate this milestone. Press F6 on `scenes/main.tscn`, or F5 to run the project. The Compatibility renderer targets modest hardware; actual minimum requirements have not been measured yet.

The installed project is at `C:\Users\Loren\Documents\pocket-racer\project.godot`, matching the folder created in your screenshot. Open the existing Pocket Racer entry in Godot's Project Manager (its title updates to Pocket Circuit after scanning). You do not need to create another empty project. The Git checkout remains under `Documents/ChatGPT/Pocket Racer/pocket-circuit`; before future Git commits, bring edits made in the installed project back into its `godot/` directory.

Open `maps/sunset_bay.tscn`, `maps/dust_valley.tscn` or `maps/neon_harbor.tscn` for level editing. See [art assets and editing guidance](docs/ART_ASSETS.md). The original empty project configuration is backed up separately before installation.

Code is separated into small systems:

- `scripts/main.gd`: game states, UI, player input, camera and sound.
- `scripts/kart.gd`: reusable arcade controller and temporary car model.
- `scripts/course.gd`: track centerline and helpers.
- `scripts/race.gd`: race clock, checkpoints and results.
- `scripts/ai.gd`: opponent decisions.
- `scripts/profile.gd`: local saves and between-race adaptation.
- `scripts/world.gd`: map-generation source; the game loads the saved scenes under `maps/`.

The car takes throttle/steering inputs from either a person or an AI. The race system works independently of menu controls. These boundaries will help when adding host-authoritative multiplayer, but **no network play is implemented yet**.

Saves are stored in Godot's `user://profile_v1.json`, normally `%APPDATA%\Godot\app_userdata\Pocket Circuit\profile_v1.json`. Portable/self-contained Godot editor installations can use a different editor-run location. Exported games keep saves outside the extracted game folder. Writes use a temporary file then rename; an unreadable versioned save is preserved and blocks overwriting.

## Build and validate

Install the Windows export templates matching your editor. In PowerShell:

```powershell
.\tools\build.ps1 -Godot "C:\path\to\godot.exe"
```

The script imports assets, checks logs for script errors, runs simulation and real-physics race tests, exports, smoke-tests the exported executable and packages it with instructions. Outputs go into ignored `builds/`. Builds are development previews, not automatically published GitHub Releases.

The smoke test uses isolated temporary save names. It verifies a full AI race, checkpoint ordering, save round trips and bounded adaptation. The live test drives the player through the normal physics loop using AI, checks the finish flow and reward persistence. Neither test proves that human handling is fun or that the build works on every PC.

Before a stable public release, test the ZIP on a second Windows PC without Godot, test human steering and audio, measure low-end performance and verify extracted-folder saves. A clean Windows VM has not been used for this milestone.

## Next milestones

See [the roadmap](docs/ROADMAP.md). There are no shops, upgrade purchases, NPC interactions, licensed music, item weapons, gamepad controls or internet rooms in v0.2. Coins are saved for future progression and cannot yet be spent. This is not feature parity with the web version yet.
