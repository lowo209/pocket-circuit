extends Node3D
## Procedural graybox harbor; replace individual props with authored assets later.
var sun: DirectionalLight3D
var road_material: StandardMaterial3D
var course

func mat(hex: String, roughness: float = 0.85) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(hex)
	material.roughness = roughness
	return material

func box(size: Vector3, pos: Vector3, material: Material, solid := false) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var shape := BoxMesh.new()
	shape.size = size
	mesh.mesh = shape
	mesh.material_override = material
	mesh.position = pos
	add_child(mesh)
	if solid:
		var body := StaticBody3D.new()
		var collision := CollisionShape3D.new()
		var bounds := BoxShape3D.new()
		bounds.size = size
		collision.shape = bounds
		body.add_child(collision)
		mesh.add_child(body)
	return mesh

func sign_text(text: String, pos: Vector3, size: int = 80) -> void:
	var label := Label3D.new()
	label.text = text
	label.font_size = size
	label.pixel_size = 0.014
	label.position = pos
	label.modulate = Color("ffe3ad")
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	add_child(label)

func build(track) -> void:
	course = track
	var env_node := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("496578")
	sky_mat.sky_horizon_color = Color("edc49d")
	sky_mat.ground_horizon_color = Color("edc49d")
	sky_mat.ground_bottom_color = Color("4d5153")
	sky.sky_material = sky_mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("b0cad9")
	env.ambient_light_energy = 0.65
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env_node.environment = env
	add_child(env_node)
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-28, -32, 0)
	sun.light_color = Color("ffd5a2")
	sun.light_energy = 1.5
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 110
	add_child(sun)
	var ground := mat("727b70")
	box(Vector3(210, 1, 172), Vector3(0, -0.55, 0), ground, true)
	box(Vector3(900, 0.1, 900), Vector3(0, -2, 0), mat("497c85", 0.25))
	road_material = mat("353f44")
	var curb_red := mat("a14e3f")
	var curb_white := mat("d9cbbb")
	var stripe := mat("d3b98a")
	for i in course.COUNT:
		var a: Vector3 = course.point(i)
		var b: Vector3 = course.point(i + 1)
		var distance := a.distance_to(b)
		var road := box(Vector3(course.WIDTH, 0.12, distance + 0.3), (a + b) * 0.5, road_material)
		road.rotation.y = atan2(-(b - a).x, -(b - a).z)
		for side in [-1, 1]:
			var curb := box(Vector3(0.65, 0.18, distance + 0.1), (a + b) * 0.5 + course.side(i) * (course.WIDTH / 2 + 0.15) * side, curb_red if i % 4 < 2 else curb_white)
			curb.rotation.y = road.rotation.y
		if i % 3 == 0:
			var mark := box(Vector3(0.12, 0.015, 1.5), (a + b) * 0.5 + Vector3.UP * 0.075, stripe)
			mark.rotation.y = road.rotation.y
	# Pit plaza and a visible race entrance.
	box(Vector3(32, 0.12, 24), Vector3(83, 0.01, -15), road_material)
	var gate: Vector3 = course.point(0)
	for side in [-1, 1]:
		box(Vector3(0.5, 6, 0.5), gate + course.side(0) * 7.2 * side + Vector3.UP * 3, mat("283c49"), true)
	var beam := box(Vector3(15, 1.1, 0.7), gate + Vector3.UP * 6, mat("203440"))
	beam.rotation.y = atan2(-course.forward(0).x, -course.forward(0).z)
	sign_text("POCKET CIRCUIT", gate + Vector3.UP * 6, 60)
	for x in 14:
		for z in 2:
			var square := box(Vector3(1, 0.025, 1), gate + course.side(0) * (x - 6.5) + course.forward(0) * z + Vector3.UP * 0.09, curb_white if (x + z) % 2 == 0 else road_material)
			square.rotation.y = beam.rotation.y
	sign_text("HARBOR CLUB\n[E] START RACE", Vector3(83, 3, -15), 65)
	var rng := RandomNumberGenerator.new()
	rng.seed = 314159
	var walls := [mat("596773"), mat("bd9470"), mat("7e817b"), mat("405a62")]
	var windows := mat("dfbe7c")
	for i in 24:
		var x := rng.randf_range(-42, 42)
		var z := rng.randf_range(-26, 26)
		if absf(x) < 13 and absf(z) < 12:
			continue
		var height := rng.randf_range(4, 14)
		var width := rng.randf_range(4, 9)
		box(Vector3(width, height, 6), Vector3(x, height / 2, z), walls[i % 4], true)
		box(Vector3(width + 0.3, 0.3, 6.3), Vector3(x, height, z), walls[(i + 1) % 4])
		for floor_id in int(height / 2.5):
			box(Vector3(width * 0.7, 0.65, 0.03), Vector3(x, 1.6 + floor_id * 2.5, z + 3.02), windows)
	for i in 14:
		var x := -95.0 + i * 13
		var height := rng.randf_range(8, 28)
		box(Vector3(9, height, 10), Vector3(x, height / 2, -76), walls[i % 4])
	# Dock cranes are silhouettes: a few inexpensive meshes each.
	for x in [-83.0, -57.0, -25.0]:
		box(Vector3(0.8, 19, 0.8), Vector3(x, 9.5, 69), mat("bfa071"))
		box(Vector3(23, 0.8, 0.8), Vector3(x + 7, 19, 69), mat("bfa071"))
		box(Vector3(0.08, 11, 0.08), Vector3(x + 17, 13.5, 69), mat("3e4d56"))
	for i in 18:
		var index := i * 8
		var position: Vector3 = course.point(index) + course.side(index) * 9
		box(Vector3(0.18, 4, 0.18), position + Vector3.UP * 2, mat("36464e"))
		box(Vector3(0.9, 0.2, 0.5), position + Vector3.UP * 4, windows)

func set_quality(level: int) -> void:
	sun.shadow_enabled = level > 0
	sun.directional_shadow_max_distance = [40.0, 70.0, 110.0, 160.0][level]
