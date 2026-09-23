# Pocket Circuit — Godot v0.1 development preview

A new standalone Windows game built with Godot 4 and GDScript. The repository's original web game remains a reference. Development of the rebuild happens here.

**This is a playable graybox milestone, not a finished public release.** Its original procedural cars and harbor buildings are placeholders for the more realistic art direction. It is currently single-player.

## Play

Extract the entire `PocketCircuit_v0.1-dev.zip` into one folder and run `PocketCircuit.exe`. Keep `PocketCircuit.pck` beside it. Godot is not required on the player's PC. Do not run directly from inside the ZIP.

Enter Harbor lets you drive around the small test area. Drive near the Harbor Club sign and press E to start, or choose Quick Race from the menu. Complete three laps through the checkpoints, see your result, and return to the harbor. A race has a five-minute time limit; unfinished races award no coins.

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

- Main menu, drivable hub and one Harbor Sprint circuit.
- One car design, six liveries and five AI opponents.
- Arcade driving, drift boosts, rechargeable boost, car collisions and recovery.
- Countdown, ordered gates, three laps, position display and results.
- Coins, race count, best lap, settings and AI skill saved locally.
- Low/Medium/High/Ultra presets, fullscreen, VSync, FPS cap and engine volume.
- Simple tire/boost particles, chase camera and a generated engine sound.
- Windows x86-64 export preset and packaging script.

## Adaptive AI

Bots steer and accelerate through the same kart controller as the player. They follow a shared track centerline, slow for corners and choose an overtaking lane. Higher skill enables more pace, drift and straight-line boosts.

Completed player lap times estimate average speed. After each completed race, skill moves by at most 0.08 toward that estimate and is saved. Bots use that value at the start of the next race. There are no hidden mid-race speed multipliers or teleports to catch the player. Stuck bots can recover behind their next checkpoint, just as the player can. Turning Adaptive AI off uses fixed medium difficulty. This is a transparent rule-based difficulty system, not machine learning; tuning against real players is still needed.

## Open the source

Import `project.godot` in Godot 4.7.2, the installed version used to validate this milestone. Press F6 on `scenes/main.tscn`, or F5 to run the project. The Compatibility renderer targets modest hardware; actual minimum requirements have not been measured yet.

Code is separated into small systems:

- `scripts/main.gd`: game states, UI, player input, camera and sound.
- `scripts/kart.gd`: reusable arcade controller and temporary car model.
- `scripts/course.gd`: track centerline and helpers.
- `scripts/race.gd`: race clock, checkpoints and results.
- `scripts/ai.gd`: opponent decisions.
- `scripts/profile.gd`: local saves and between-race adaptation.
- `scripts/world.gd`: temporary harbor construction and lighting.

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

See [the roadmap](docs/ROADMAP.md). There are no shops, upgrade purchases, NPCs, licensed music, item weapons, gamepad controls, internet rooms or realistic finished models in v0.1. Coins are saved for future progression and cannot yet be spent.
