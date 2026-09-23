# v0.2 art assets

## NEON City update (v0.3)

The former harbor is now NEON City; its saved scene keeps the legacy `neon_harbor.tscn` filename to preserve editor references. `scripts/neon_city.gd` authors original city geometry, signs, lights and boost-pad visuals. The supplied racing screenshot is an atmosphere reference, not a source of extracted game assets. Facade windows, wet-road ripple normals and refracting camera droplets are code-native shaders; the existing albedo images are reused, not replaced with scanned texture sets. Road splashes and rainfall scale with quality. Disable camera droplets independently in Settings.

Original textures generated with the built-in image-generation tool; no external game assets were used. The image-generation skill supplied the tileable, diffuse-lit material workflow. Geometry, noise materials, water shader, car model, minimap and scene baking were implemented directly in GDScript/Godot.

## Texture prompts

`textures/asphalt.png`: Square seamless tileable albedo texture, worn fine-grain dark gray asphalt, small aggregate, subtle hairline cracks and faded wear. Orthographic top-down scan, uniform neutral diffuse light; no shadows, perspective, markings, objects, text or borders.

`textures/plaster.png`: Square seamless tileable albedo texture of a weathered seaside wall, pale beige plaster with subtle worn patches exposing rough limestone, salt weathering, fine cracks and surface grain. Orthographic surface scan, uniform diffuse light; no windows, doors, text, objects or cast shadows.

`textures/sandstone.png`: Square seamless tileable albedo texture of layered ochre sandstone, sediment bands, eroded grain, shallow fissures and warm rust-brown variation. Orthographic material scan, uniform diffuse illumination; no perspective, directional shadows, sky, objects, text or borders.

These are generated albedo images, not scanned PBR sets. Procedural normal maps and roughness values provide inexpensive additional detail. Repetition and art direction still need further refinement; assets are not a claim of photorealistic final quality.

## Editable maps

Open `maps/sunset_bay.tscn`, `maps/dust_valley.tscn` or `maps/neon_harbor.tscn` to edit props, materials and lighting directly. `scenes/main.tscn` also includes Sunset Bay for immediate editor visibility. The runtime loads these saved scenes; it does not rebuild them on each play.

`tools/bake_maps.gd` is an explicit authoring tool. Running it **overwrites those three map scenes**, so commit or save your hand edits first. The normal build script does not run the generator. The road and checkpoints share `scripts/course.gd`; if you change the route, regenerate roads and retest all races.

The Compatibility renderer remains intentional for modest computers. Most light is one directional light plus ambient sky; night lamps have no shadows and fade at distance. Props stop drawing at distance. Rain counts, shadows and anti-aliasing scale with quality. v0.2.1 adds two static reflection probes per map (disabled on Low), excludes the moving karts from captures, and uses variable wet-road roughness plus clearcoat paint. No dynamic mirror/ray-traced reflections, lightmaps, LOD meshes, or finished collisions for every decorative object are implemented yet.
