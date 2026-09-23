# Changelog

## 0.4.0-dev — 2026-09-23

- Overhauled all maps with layered scenery and extended terrain instead of exposed rectangular world edges. Shared conservative footprint placement keeps independently placed buildings and props apart and away from the race corridor.
- Sunset Bay: sculpted coastline, supported over-water causeway, sea stacks, offshore islands, sailboats, village gardens and inland headlands. The road now has an upward-facing collision mesh, including every offshore sample.
- Dust Valley: three layers of distant dune ridges, roadside rock formations, warm dust haze, drifting sand and a drive-through stepped stone pyramid with portal roofs, masonry courses and interior lights. Sand particles stop inside the passage.
- NEON City: deeper city blocks, roof details, foundations, sidewalks, terminals and bins; 18 animated air taxis follow the clear street canyon above crossings. Existing wet-road reflections and rain remain.
- Added physical road-support, independent scenery-footprint and traffic-motion regressions; expanded rendered preview captures to landmarks across every map.

## 0.3.0-dev — 2026-09-23

- Replaced Neon Harbor scenery with NEON City: illuminated tower blocks, original storefront signs, elevated crossings, skyline and cyan/magenta road lighting. The legacy scene filename remains stable for existing editor references.
- Added animated puddle ripples, denser rain, road splashes and screen-refracting lens droplets below the HUD; camera droplets have a saved on/off setting.
- Brought the chase camera closer and lower, with a gentler boost field-of-view change.
- Added three visible boost pads shared by the player and AI, with retrigger cooldowns and no stored-energy cost.
- Refined wet asphalt roughness and facade materials; retained the Compatibility renderer and quality scaling. Reflections are still static approximations, not dynamic mirrors.

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
