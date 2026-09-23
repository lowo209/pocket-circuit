# Changelog

## 0.2.1-dev — 2026-09-23

- Joined curb strips to the actual road edges; connected guardrails to their own endpoints.
- Fixed tire rotation: independent axle and steering pivots, rolling based on distance travelled and wheel radius, correct reversing, visible rim spokes.
- Replaced floating HUD text with position/lap/time cards, speed and boost readout, controls strip and fitted minimap.
- Added static environment reflection probes, clearcoat paint, patchy wet asphalt, less repetitive water and revised sky/shadow balance. Low quality disables the probes.
- Added regression checks for curb seams and wheel direction/axis; preserved Godot's 4.7 migration and texture import settings from the installed project.

## 0.2.0-dev — 2026-09-23

- Rebuilt the three original web track layouts as smooth roads with painted curbs, guardrails and new scenery.
- Added editable Sunset Bay, Dust Valley and Neon Harbor map scenes, track selection and a live minimap.
- Added original road/wall/rock textures, procedural surface detail, water animation, sunset/night atmospheres and scalable rain.
- Replaced box car bodies with shaped kart bodies, helmeted drivers and detailed wheel hubs.
- Added per-track full race validation; prepared the project for the user's `Documents/pocket-racer` Godot folder.

## 0.1.0-dev — 2026-09-23

- Started the Godot/GDScript standalone rebuild in its own project directory.
- Added a drivable harbor, one circuit, six racers, drift/boost, ordered laps and results.
- Added bounded between-race adaptive AI with a fixed-medium option.
- Added local saves, graphics/audio settings and a Windows export/packaging workflow.
- Original procedural placeholder art; single-player only. No official release yet.
