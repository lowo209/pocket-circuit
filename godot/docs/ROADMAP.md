# Development plan

## v0.1 — playable foundation (development preview)

Hub → countdown → three-lap solo race → result → hub. Driving, bots, local progression, settings and a portable Windows export. Primitive geometry proves the loop before art production.

## v0.2 — handling and visual polish

Tune steering, collisions, drifts and AI with real play sessions. Add gamepad bindings, clearer race HUD/minimap, authored car body, trackside barriers, road textures/normal maps, original sound effects and a better harbor layout. Profile before deciding minimum hardware.

## v0.3 — multiplayer

Start with host/join over LAN and a host-authoritative race simulation using Godot ENet. Add remote input handling, snapshot interpolation and client prediction as needed; test latency, packet loss, disconnects and results. LAN still depends on firewall permissions and networks allowing device-to-device connections.

Internet friend rooms need hosting or a relay/NAT traversal solution. A room code alone does not solve connectivity. Choose that service separately once player count, hosting budget and school/home network constraints are known. Do not reuse the web prototype's Vercel/Redis transport without evaluating the native game's needs.

## Later

Small connected districts, new tracks, garage upgrades with explicit balancing, shops, NPCs, animation, achievements, original/licensed music, item combat and richer effects. Multiplayer progression and host trust need their own design before valuable online rewards are introduced.

## Art and performance

Target grounded materials and atmospheric composition. Use authored low-polygon meshes, normal maps, baked light where available, reflection probes, distant silhouettes, limited dynamic lights, LOD and occlusion when the actual level benefits. Compatibility is the initial baseline; renderer changes need profiling and could require restart. Avoid presenting unsupported effects as working settings.

Current presets change real shadow distance, shadow enablement and MSAA. Render scale, texture tiers, ambient occlusion and volumetrics are deferred until there are appropriate assets and a measured rendering pipeline. Ultra currently improves this prototype's shadows and edges; it does not enable a separate realistic art set.

## GitHub workflow

Keep the web prototype at the repository root and the new standalone game in `godot/` during the transition. Develop on `codex/godot-v0.1`, leaving main intact until reviewed. Update docs and changelog alongside code. Do not check generated `.godot/` caches or Windows binaries into Git.

Development ZIPs stay local or are explicitly marked prereleases. Stable public releases need a clean Windows launch check, save/settings tests, version and icon checks, current screenshots, instructions and a tagged GitHub Release containing the ZIP. Update the repository landing page fully when the standalone version becomes the primary stable release.
