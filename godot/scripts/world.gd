extends Node3D
## Source for editable maps. Regenerate explicitly using tools/bake_maps.gd.
var sun: DirectionalLight3D
var course
var materials := {}
var rng := RandomNumberGenerator.new()
var night := false

func mat(hex: String, roughness := 0.8, texture := "") -> StandardMaterial3D:
	var key := hex + str(roughness) + texture
	if materials.has(key): return materials[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(hex)
	m.roughness = roughness
	if texture == "asphalt" and ResourceLoader.exists("res://textures/asphalt.png"):
		m.albedo_texture = load("res://textures/asphalt.png")
	elif not texture.is_empty():
		var noise := FastNoiseLite.new()
		noise.seed = 37
		noise.frequency = 0.06 if texture == "rock" else 0.18
		var image := NoiseTexture2D.new()
		image.width = 256
		image.height = 256
		image.seamless = true
		image.noise = noise
		var gradient := Gradient.new()
		gradient.set_color(0, Color(0.35,0.32,0.28))
		gradient.set_color(1, Color(0.9,0.87,0.8))
		image.color_ramp = gradient
		m.albedo_texture = image
		var normal := NoiseTexture2D.new()
		normal.width = 256
		normal.height = 256
		normal.seamless = true
		normal.noise = noise
		normal.as_normal_map = true
		normal.bump_strength = 2.0
		m.normal_enabled = true
		m.normal_texture = normal
		m.normal_scale = 0.5
		m.uv1_triplanar = true
		m.uv1_scale = Vector3.ONE * 0.2
	if texture in ["rock","plaster"]:
		var file := "res://textures/sandstone.png" if texture == "rock" else "res://textures/plaster.png"
		if ResourceLoader.exists(file): m.albedo_texture = load(file)
	materials[key] = m
	return m

func glowing(hex: String) -> StandardMaterial3D:
	var m := mat(hex, 0.4).duplicate() as StandardMaterial3D
	m.emission_enabled = true
	m.emission = Color(hex)
	m.emission_energy_multiplier = 1.3
	return m

func mesh_object(mesh: Mesh, pos: Vector3, material: Material, title: String) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	node.name = title
	node.mesh = mesh
	node.position = pos
	node.material_override = material
	if title not in ["Terrain","Ocean","TrackSurface"]: node.visibility_range_end = 230
	add_child(node,true)
	return node

func box(size: Vector3, pos: Vector3, material: Material, solid := false, title := "Prop") -> MeshInstance3D:
	var shape := BoxMesh.new()
	shape.size = size
	var node := mesh_object(shape, pos, material, title)
	if solid:
		var body := StaticBody3D.new()
		var collision := CollisionShape3D.new()
		var bounds := BoxShape3D.new()
		bounds.size = size
		collision.shape = bounds
		body.add_child(collision)
		node.add_child(body)
	return node

func cylinder(pos: Vector3, radius: float, height: float, material: Material, top := -1.0, title := "Column") -> MeshInstance3D:
	var shape := CylinderMesh.new()
	shape.top_radius = radius if top < 0 else top
	shape.bottom_radius = radius
	shape.height = height
	shape.radial_segments = 12
	return mesh_object(shape, pos, material, title)

func sign_text(text: String, pos: Vector3, size := 70) -> Label3D:
	var label := Label3D.new()
	label.name = "Sign"
	label.text = text
	label.font_size = size
	label.pixel_size = 0.025
	label.position = pos
	label.modulate = Color("f2e4c6")
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	add_child(label)
	return label

func build(track) -> void:
	course = track
	night = course.track_id == 2
	rng.seed = 912 + course.track_id
	setup_environment()
	var ground_color: String = ["c8b691","bc8054","576577"][course.track_id]
	box(Vector3(360,1,420), Vector3(45,-0.62,-5), mat(ground_color,0.95,"sand"),true,"Terrain")
	if course.track_id != 1:
		var water := ShaderMaterial.new()
		water.shader = load("res://shaders/water.gdshader")
		water.set_shader_parameter("water_color", Color("132b42") if night else Color("286a7d"))
		box(Vector3(1600,0.15,1600),Vector3(0,-1.4,0),water,false,"Ocean")
	build_road()
	build_paddock()
	for i in range(0, course.COUNT, 4):
		var p: Vector3 = course.point(i)
		var right: Vector3 = course.side(i)
		for sign in [-1, 1]:
			var pos: Vector3 = p + right * (18 + rng.randf_range(0,8)) * sign
			if pos.distance_to(course.hub_position()) < 24: continue
			if pos.distance_to(course.point(course.nearest(pos))) < 16: continue
			if course.track_id == 0:
				if i % 8 == 0: palm(pos)
				elif sign < 0: building(pos, i)
				else: rock(pos, Vector3(6,3,5), "a89679")
			elif course.track_id == 1:
				rock(pos, Vector3(rng.randf_range(8,16),rng.randf_range(8,22),rng.randf_range(8,15)), "b07449")
				if i % 12 == 0: cactus(pos + right * 5)
			else:
				if sign < 0: container_stack(pos, i)
				else: building(pos, i)
	for i in range(0, course.COUNT, 8):
		lamp(course.point(i) + course.side(i) * 10)
	if course.track_id == 0:
		lighthouse(course.point(42) + course.side(42) * 30)
		for i in 10: rock(Vector3(175 + i*8, -0.2, -160+i*30), Vector3(20,8,18), "97967f")
	elif course.track_id == 1:
		for i in [36,91,128]: canyon_arch(i)
		for i in 14: rock(Vector3(-195+i*30,0,-190),Vector3(22,28+rng.randf()*35,25),"825d49")
	else:
		for i in [22,72,120]: crane(course.point(i)+course.side(i)*32)
		for i in range(90,110,3):
			var beam := box(Vector3(19,0.18,0.18),course.point(i)+Vector3.UP*7,glowing("52cbd9"),false,"LightTunnel")
			beam.rotation.y = atan2(-course.forward(i).x,-course.forward(i).z)
		add_rain()
	add_reflections()

func add_reflections() -> void:
	# One broad capture plus a local pit capture; never more than two per mesh.
	for i in 2:
		var probe := ReflectionProbe.new()
		probe.name = "WorldReflection" if i==0 else "PaddockReflection"
		probe.position = Vector3(10,35,0) if i==0 else course.point(0)+Vector3.UP*3
		probe.size = Vector3(360,110,410) if i==0 else Vector3(95,35,100)
		probe.max_distance = 300 if i==0 else 100
		probe.intensity = 0.55 if i==0 else 0.8
		probe.ambient_mode = ReflectionProbe.AMBIENT_DISABLED
		probe.box_projection = i==1
		probe.enable_shadows = false
		probe.cull_mask = 1
		probe.update_mode = ReflectionProbe.UPDATE_ONCE
		add_child(probe)

func setup_environment() -> void:
	var node := WorldEnvironment.new()
	node.name = "Atmosphere"
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("081324") if night else Color("32699a")
	sky_mat.sky_horizon_color = Color("283947") if night else Color("bdcbd4")
	sky_mat.sky_curve = 0.65
	sky_mat.sky_energy_multiplier = 0.65
	sky_mat.ground_horizon_color = sky_mat.sky_horizon_color
	sky_mat.ground_bottom_color = Color("152431") if night else Color("65717b")
	sky.sky_material = sky_mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR if night else Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_color = Color("8da9ca") if night else Color("b6cbdf")
	env.ambient_light_energy = 0.5 if night else 0.45
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.fog_enabled = true
	env.fog_light_color = Color("1a3049") if night else Color("b6c5d1")
	env.fog_density = 0.0008 if night else 0.00045
	node.environment = env
	add_child(node)
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-27,-48,0)
	sun.light_color = Color("94bde6") if night else Color("fff0d9")
	sun.light_energy = 0.45 if night else 0.72
	sun.light_angular_distance = 1.2
	sun.shadow_blur = 1.5
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 100
	add_child(sun)

func build_road() -> void:
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in course.COUNT:
		var a: Vector3 = course.point(i)
		var b: Vector3 = course.point(i+1)
		var corners := [a-course.side(i)*7.5,b-course.side(i+1)*7.5,b+course.side(i+1)*7.5,a+course.side(i)*7.5]
		var uvs := [Vector2(0,i*0.7),Vector2(0,(i+1)*0.7),Vector2(3,(i+1)*0.7),Vector2(3,i*0.7)]
		for v in [0,2,1,0,3,2]:
			surface.set_uv(uvs[v])
			surface.add_vertex(corners[v]+Vector3.UP*0.02)
		var midpoint := (a+b)*0.5
		var heading := atan2(-(b-a).x,-(b-a).z)
		for side in [-1,1]:
			if i > 5 and i < 154:
				var edge_a: Vector3 = a + course.side(i)*10*side
				var edge_b: Vector3 = b + course.side(i+1)*10*side
				var rail := box(Vector3(0.16,0.42,edge_a.distance_to(edge_b)+0.12),(edge_a+edge_b)*0.5+Vector3.UP*0.78,mat("68777e",0.55),true,"Guardrail")
				rail.rotation.y = atan2(-(edge_b-edge_a).x,-(edge_b-edge_a).z)
				box(Vector3(0.18,0.9,0.18),midpoint+course.side(i)*10*side+Vector3.UP*0.4,mat("343d43"))
		if i%3 == 0:
			var line := box(Vector3(0.16,0.012,2.4),midpoint+Vector3.UP*0.033,mat("ddc993"),false,"LaneMark")
			line.rotation.y = heading
	surface.generate_normals()
	surface.generate_tangents()
	var asphalt := ShaderMaterial.new()
	asphalt.shader = load("res://shaders/asphalt.gdshader")
	asphalt.set_shader_parameter("albedo_texture",load("res://textures/asphalt.png"))
	asphalt.set_shader_parameter("wetness",0.8 if night else 0.0)
	mesh_object(surface.commit(),Vector3.ZERO,asphalt,"TrackSurface")
	for side in [-1,1]: build_curb(side)

func curb_section(index: int, side: int) -> Array[Vector3]:
	var p: Vector3 = course.point(index)
	var outward: Vector3 = course.side(index) * side
	return [p+outward*7.5+Vector3.UP*0.025,p+outward*8.25+Vector3.UP*0.10,p+outward*8.25+Vector3.UP*0.025]

func build_curb(side: int) -> void:
	var strip := SurfaceTool.new()
	strip.begin(Mesh.PRIMITIVE_TRIANGLES)
	var distance := 0.0
	for i in course.COUNT:
		var a := curb_section(i,side)
		var b := curb_section(i+1,side)
		# World-distance paint bands; joined geometry follows both road-edge endpoints.
		var color := Color("d9d6cc") if int(distance/4)%2==0 else Color("a4483b")
		for face in 2:
			for vertex in [a[face],b[face],b[face+1],a[face],b[face+1],a[face+1]]:
				strip.set_color(color)
				strip.add_vertex(vertex)
		distance += course.point(i).distance_to(course.point(i+1))
	strip.generate_normals()
	var paint := mat("ffffff",0.85).duplicate() as StandardMaterial3D
	paint.vertex_color_use_as_albedo = true
	paint.cull_mode = BaseMaterial3D.CULL_DISABLED
	mesh_object(strip.commit(),Vector3.ZERO,paint,"ContinuousCurbLeft" if side<0 else "ContinuousCurbRight")

func build_paddock() -> void:
	var hub: Vector3 = course.hub_position()
	box(Vector3(32,0.1,30),hub,mat("75797a",0.9,"concrete"),false,"Paddock")
	sign_text("PIT CLUB\n[E] RACE",hub+Vector3.UP*4,55)
	var gate: Vector3 = course.point(0)
	var heading := atan2(-course.forward(0).x,-course.forward(0).z)
	for side in [-1,1]: box(Vector3(0.5,7,0.5),gate+course.side(0)*8.8*side+Vector3.UP*3.5,mat("233342"),true,"GantryLeg")
	var beam := box(Vector3(18,1.5,0.65),gate+Vector3.UP*7,mat("1b2832"),false,"StartGantry")
	beam.rotation.y = heading
	var sign := sign_text("POCKET CIRCUIT",gate+Vector3.UP*7,50)
	sign.billboard = BaseMaterial3D.BILLBOARD_DISABLED
	sign.rotation.y = heading
	sign.position += course.forward(0)*-0.36
	for x in 15:
		for z in 2:
			var square := box(Vector3(1,0.015,1),gate+course.side(0)*(x-7)+course.forward(0)*z+Vector3.UP*0.04,mat("eee5d5" if (x+z)%2==0 else "252c31"),false,"FinishPaint")
			square.rotation.y = heading

func rock(pos: Vector3, size: Vector3, color: String) -> void:
	var mesh := SphereMesh.new()
	mesh.radial_segments = 9
	mesh.rings = 5
	var node := mesh_object(mesh,pos+Vector3.UP*size.y*0.25,mat(color,0.95,"rock"),"RockFormation")
	node.scale = size
	node.rotation.y = rng.randf()*TAU

func palm(pos: Vector3) -> void:
	var trunk := cylinder(pos+Vector3.UP*4,0.35,8,mat("746249",1,"wood"),0.18,"PalmTrunk")
	trunk.rotation.z = 0.12
	for i in 7:
		var leaf := box(Vector3(0.7,0.08,5),pos+Vector3.UP*8,mat("506c41"),false,"PalmFrond")
		leaf.rotation = Vector3(0.22,i*TAU/7,0)
		leaf.position += leaf.basis.z*1.8

func building(pos: Vector3, index: int) -> void:
	var height := rng.randf_range(7,17) if night else rng.randf_range(4,8)
	var wall := mat(["b4a796","9dafa7","a59e90","b3a58a"][index%4],0.9,"plaster")
	box(Vector3(10,height,8),pos+Vector3.UP*height/2,wall,true,"DockBuilding" if night else "BeachHouse")
	box(Vector3(10.6,0.35,8.6),pos+Vector3.UP*height,mat("43545a"),false,"Roof")
	if not night:
		var roof := PrismMesh.new()
		roof.size = Vector3(11,2,9)
		mesh_object(roof,pos+Vector3.UP*(height+0.9),mat("965e45",0.9,"rock"),"PitchedRoof")
	for floor_id in int(height/2.5):
		for x in [-3,0,3]:
			for z in [-4.06,4.06]:
				box(Vector3(1.7,1.4,0.1),pos+Vector3(x,1.8+floor_id*2.5,z),mat("384b5b",0.25),false,"WindowFrame")
				box(Vector3(1.3,1,0.12),pos+Vector3(x,1.8+floor_id*2.5,z),glowing("d8ac6b") if night else mat("83969c",0.18),false,"Glass")
	for z in [-4.4,4.4]:
		var awning := box(Vector3(9,0.12,1.6),pos+Vector3(0,3,z),mat("637e80"),false,"Awning")
		awning.rotation.x = -0.15
	if night: box(Vector3(10.1,0.12,0.12),pos+Vector3(0,height-0.8,-4.1),glowing("e67cbd"),false,"NeonTrim")

func lighthouse(pos: Vector3) -> void:
	for i in 5: cylinder(pos+Vector3.UP*(2+i*3),3.2-i*0.2,3,mat("dfd6c4" if i%2==0 else "b6634a",0.9,"plaster"),2.9-i*0.2,"Lighthouse")
	cylinder(pos+Vector3.UP*16,2.6,2,mat("324452",0.3),-1,"LanternRoom")
	cylinder(pos+Vector3.UP*17.5,3.1,1,mat("43525a"),0,"Roof")
	cylinder(pos+Vector3.UP*16,2.62,0.8,glowing("edcb88"),-1,"Beacon")

func cactus(pos: Vector3) -> void:
	cylinder(pos+Vector3.UP*2,0.4,4,mat("596d44"),0.3,"Cactus")
	box(Vector3(2,0.5,0.5),pos+Vector3(0,2,0),mat("596d44"))
	cylinder(pos+Vector3(1,2.5,0),0.23,1.4,mat("596d44"),0.19)

func canyon_arch(index: int) -> void:
	var p: Vector3 = course.point(index)
	for side in [-1,1]: rock(p+course.side(index)*14*side,Vector3(10,16,12),"ac734e")
	var arch := box(Vector3(36,4,8),p+Vector3.UP*13,mat("a67955",1,"rock"),false,"RockArch")
	arch.rotation.y = atan2(-course.forward(index).x,-course.forward(index).z)

func container_stack(pos: Vector3, index: int) -> void:
	var color: String = ["764e43","4c7178","ad9158","50596d"][index%4]
	for level in 2:
		box(Vector3(6,2.7,12),pos+Vector3(0,1.4+level*2.8,0),mat(color,0.7,"steel"),true,"ShippingContainer")
		for z in range(-5,6):
			for side in [-1,1]: box(Vector3(0.1,2.5,0.09),pos+Vector3(side*3.03,1.4+level*2.8,z),mat(color),false,"Corrugation")

func crane(pos: Vector3) -> void:
	for x in [-5,5]: box(Vector3(0.8,24,0.8),pos+Vector3(x,12,0),mat("b79861"),false,"CraneTower")
	box(Vector3(34,0.8,1),pos+Vector3(7,24,0),mat("b79861"),false,"CraneBoom")
	box(Vector3(0.08,15,0.08),pos+Vector3(22,16.5,0),mat("283342"),false,"Cable")

func lamp(pos: Vector3) -> void:
	cylinder(pos+Vector3.UP*3,0.1,6,mat("46505a"),0.07,"LampPost")
	box(Vector3(1.1,0.2,0.5),pos+Vector3.UP*6,glowing("f4cc91"),false,"LampHead")
	if night:
		var light := OmniLight3D.new()
		light.name = "StreetLight"
		light.position = pos+Vector3.UP*5.5
		light.light_color = Color("f5c597")
		light.light_energy = 1.4
		light.omni_range = 15
		light.distance_fade_enabled = true
		light.distance_fade_begin = 35
		light.distance_fade_length = 20
		add_child(light)

func add_rain() -> void:
	var rain := CPUParticles3D.new()
	rain.name = "Rain"
	rain.amount = 600
	rain.lifetime = 1.0
	rain.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	rain.emission_box_extents = Vector3(26,12,26)
	rain.direction = Vector3(0.1,-1,0)
	rain.initial_velocity_min = 24
	rain.initial_velocity_max = 28
	rain.gravity = Vector3.ZERO
	var streak := BoxMesh.new()
	streak.size = Vector3(0.012,0.6,0.012)
	rain.mesh = streak
	rain.color = Color(0.6,0.72,0.85,0.35)
	add_child(rain)

func set_quality(level: int) -> void:
	if sun == null: sun = get_node_or_null("Sun")
	if sun:
		sun.shadow_enabled = level > 0
		sun.directional_shadow_max_distance = [40.0,70.0,110.0,160.0][level]
	var rain := get_node_or_null("Rain") as CPUParticles3D
	if rain: rain.amount = [100,250,450,600][level]
	for probe_name in ["WorldReflection","PaddockReflection"]:
		var probe := get_node_or_null(probe_name) as ReflectionProbe
		if probe: probe.visible = level > 0
