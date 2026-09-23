extends RefCounted
## Deterministic scenery placement with conservative footprint and road clearance.
var world
var course
var footprints: Array[Vector3] = []

func _init(w, c) -> void:
	world = w
	course = c

func road_distance(p: Vector3) -> float:
	var best := INF
	for i in course.COUNT:
		var a: Vector3 = course.point(i)
		var b: Vector3 = course.point(i+1)
		var t := clampf((p-a).dot(b-a)/(b-a).length_squared(),0,1)
		best = minf(best,p.distance_to(a+(b-a)*t))
	return best

func reserve(p: Vector3, radius: float) -> bool:
	if road_distance(p)<radius+11.5: return false
	if p.distance_to(course.hub_position())<radius+24: return false
	for entry in footprints:
		if Vector2(p.x,p.z).distance_to(Vector2(entry.x,entry.y))<radius+entry.z+2: return false
	footprints.append(Vector3(p.x,p.z,radius))
	return true

static func shoreline(z: float) -> float:
	return 60.0+7.0*sin(z*0.026)+3.0*sin(z*0.067)

func terrain() -> void:
	if course.track_id != 0:
		world.box(Vector3(2000,1,2000),Vector3(0,-0.62,0),world.mat("c1a477" if course.track_id==1 else "27333c",0.95,"sand" if course.track_id==1 else "concrete"),true,"Terrain")
		return
	var mesh := SurfaceTool.new()
	mesh.begin(Mesh.PRIMITIVE_TRIANGLES)
	# A real coastline, with submerged terrain under the offshore road section.
	for z in range(-900,900,15):
		for x in range(-900,900,15):
			var vertices: Array[Vector3] = []
			for corner in [Vector2(x,z),Vector2(x+15,z),Vector2(x+15,z+15),Vector2(x,z+15)]:
				var h := -0.12-5.0*smoothstep(shoreline(corner.y)-12,shoreline(corner.y)+14,corner.x)
				vertices.append(Vector3(corner.x,h,corner.y))
			for id in [0,1,2,0,2,3]:
				mesh.set_uv(Vector2(vertices[id].x,vertices[id].z)*0.12)
				mesh.add_vertex(vertices[id])
	mesh.generate_normals()
	var land = world.mesh_object(mesh.commit(),Vector3.ZERO,world.mat("d5c3a0",0.95,"sand"),"Terrain")
	land.create_trimesh_collision()
	var water := ShaderMaterial.new()
	water.shader = load("res://shaders/water.gdshader")
	water.set_shader_parameter("water_color",Color("398792"))
	world.box(Vector3(4000,0.1,4000),Vector3(0,-2.1,0),water,false,"Ocean")

func beach() -> void:
	# Continuous structural deck follows the same offset vertices as the race road.
	var deck := SurfaceTool.new()
	deck.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in course.COUNT:
		var p: Vector3 = course.point(i)
		if maxf(p.x,course.point(i+1).x)<40: continue
		var a: Vector3 = p-course.side(i)*11.3
		var b: Vector3 = p+course.side(i)*11.3
		var c: Vector3 = course.point(i+1)+course.side(i+1)*11.3
		var d: Vector3 = course.point(i+1)-course.side(i+1)*11.3
		for quad in [[a,b,c,d],[a,d,d-Vector3.UP,a-Vector3.UP],[b,b-Vector3.UP,c-Vector3.UP,c]]:
			for j in [0,2,1,0,3,2]:
				deck.set_uv(Vector2(quad[j].x,quad[j].z)*0.2)
				deck.add_vertex(quad[j]-Vector3.UP*0.06)
		if i%3==0:
			for side in [-1,1]:
				world.cylinder(p+course.side(i)*6.5*side-Vector3.UP*3,0.65,5.9,world.mat("918e82",0.9,"concrete"),0.65,"OceanBridgePier")
	deck.generate_normals()
	var concrete = world.mat("a39d8d",0.85,"concrete").duplicate()
	concrete.cull_mode = BaseMaterial3D.CULL_DISABLED
	world.mesh_object(deck.commit(),Vector3.ZERO,concrete,"OceanCauseway")
	for i in range(0,160,3):
		for side in [-1,1]:
			var p: Vector3 = course.point(i)+course.side(i)*side*(19+(i%4)*2)
			if p.x>shoreline(p.z)-22: continue
			if reserve(p,8):
				world.building(p-Vector3.UP*0.12,i)
				for x in [-4,4]:
					world.box(Vector3(1.4,0.7,1.4),p+Vector3(x,0.25,6),world.mat("8d795e",0.9),false,"TerracePlanter")
	# A second layer of village gardens breaks the sightline between near buildings.
	for z in range(-190,191,16):
		for x in range(-200,61,16):
			var p := Vector3(x+world.rng.randf_range(-3,3),-0.12,z)
			if p.x>shoreline(p.z)-18: continue
			if reserve(Vector3(p.x,0,p.z),4):
				world.palm(p)
				for j in 3: world.rock(p+Vector3(j-1,0,j%2),Vector3(1.5,0.9,1.7),"718061")
	for i in 24:
		var z := -210.0+i*19
		var p := Vector3(shoreline(z)-20,-0.4,z)
		if reserve(Vector3(p.x,0,p.z),4):
			world.rock(p,Vector3(7,4,6),"9d9c86")
	world.lighthouse(Vector3(42,-0.12,-157))
	for p in [Vector3(147,-3,65),Vector3(178,-3,13),Vector3(170,-3,-64)]:
		hill(p,Vector3(12,15,10),"909784","SeaStack")
	hill(Vector3(255,-5,-100),Vector3(65,30,55),"728570","OffshoreIsland")
	hill(Vector3(270,-5,115),Vector3(70,24,60),"78876b","OffshoreIsland")
	# Grounded headlands frame the sea without closing the ocean horizon.
	for i in 28:
		var angle := float(i)/27*PI+PI*0.5
		var p := Vector3(cos(angle)*310-30,-3,sin(angle)*310)
		hill(p,Vector3(75,35+float(i%4)*7,65),"75836a","CoastalHeadland")
	for i in 5:
		var boat := Node3D.new()
		boat.name = "Sailboat"
		world.add_child(boat,true)
		boat.position = Vector3(165+i*33,-1.95,-125+i*51+world.rng.randf_range(-12,12))
		var hull = world.box(Vector3(3,0.8,8),boat.position,world.mat("e6dfcb",0.7),false,"BoatHull")
		hull.rotation.y = 0.4
		world.cylinder(boat.position+Vector3.UP*5,0.08,10,world.mat("736a57"),0.08,"BoatMast")
		var sail := PrismMesh.new()
		sail.size = Vector3(0.08,7,5)
		world.mesh_object(sail,boat.position+Vector3(0,5,1.4),world.mat("e9e2ce"),"BoatSail")

func hill(p: Vector3, size: Vector3, color: String, title: String) -> void:
	# Height-field mounds meet the surrounding ground; no exposed spherical undersides.
	var mesh := SurfaceTool.new()
	mesh.begin(Mesh.PRIMITIVE_TRIANGLES)
	for z in 16:
		for x in 16:
			var vertices: Array[Vector3] = []
			for offset in [Vector2(x,z),Vector2(x+1,z),Vector2(x+1,z+1),Vector2(x,z+1)]:
				var q: Vector2 = offset/8.0-Vector2.ONE
				var shape := pow(maxf(0,1.0-q.length_squared()),1.6)
				var ripple := 0.85+0.15*sin(q.x*4+q.y*3+p.x*0.03)
				vertices.append(Vector3(q.x*size.x,shape*ripple*size.y,q.y*size.z))
			for i in [0,1,2,0,2,3]:
				mesh.set_uv(Vector2(vertices[i].x,vertices[i].z)*0.08)
				mesh.add_vertex(vertices[i])
	mesh.generate_normals()
	p.y = minf(p.y,-0.16)
	var node = world.mesh_object(mesh.commit(),p,world.mat(color,0.98,"rock" if course.track_id==1 else "sand"),title)
	node.visibility_range_end = 850

func desert() -> void:
	pyramid()
	for ring in 3:
		for i in 36:
			var angle := TAU*float(i)/36+float(ring)*0.08
			var radius := 230.0+ring*105
			var p := Vector3(cos(angle)*radius,-1,sin(angle)*radius)
			hill(p,Vector3(55+ring*20,22+(i%5)*7+ring*7,48+ring*15),"bfa175" if ring<2 else "ac987a","DuneRidge")
	for i in range(0,160,2):
		for side in [-1,1]:
			var p: Vector3 = course.point(i)+course.side(i)*side*(23+float(i%4)*3)
			if p.distance_to(course.point(7))<60: continue
			if reserve(p,8):
				hill(p,Vector3(8,8+float(i%5)*2,8),"af8d63","CanyonButtress")
				world.rock(p-Vector3.UP*0.3,Vector3(8,5,7),"be9a6b")
	for z in range(-185,181,19):
		for x in range(-175,191,19):
			var p := Vector3(x,0,z)
			if p.distance_to(course.point(7))<60: continue
			if reserve(p,3):
				world.rock(p-Vector3.UP*0.3,Vector3(3,1.6,3),"c1a476")
				if (x+z)%3==0: world.cactus(p-Vector3.UP*0.12)
	add_sandstorm()

func pyramid() -> void:
	var center: Vector3 = course.point(7)
	var heading := atan2(-course.forward(7).x,-course.forward(7).z)
	var structure := Node3D.new()
	structure.name = "PyramidTemple"
	world.add_child(structure)
	structure.position = center-Vector3.UP*0.12
	structure.rotation.y = heading
	structure.set_meta("tunnel_half_width",18.0)
	var stone := ShaderMaterial.new()
	stone.shader = load("res://shaders/pyramid_stone.gdshader")
	stone.set_shader_parameter("stone_texture",load("res://textures/sandstone.png"))
	for level in 22:
		var y := level*1.8
		var half := 37.0*(1.0-float(level)/22)
		if level<5:
			for side in [-1,1]:
				var block = world.box(Vector3(half-18,1.8,half*2),Vector3(side*(half+18)*0.5,y+0.9,0),stone,true,"PyramidSideCourse")
				block.reparent(structure,false)
		else:
			var block = world.box(Vector3(half*2,1.8,half*2),Vector3(0,y+0.9,0),stone,false,"PyramidUpperCourse")
			block.reparent(structure,false)
	# Aligned portal frames, relief bands and warm fixtures inside the real passage.
	for z in [-37.0,37.0]:
		var porch = world.box(Vector3(35.8,1.2,11),Vector3(0,9,z*32.5/37.0),stone,false,"TemplePortalRoof")
		porch.reparent(structure,false)
		for side in [-1,1]:
			var pillar = world.box(Vector3(1.8,8.8,2.2),Vector3(side*17,4.4,z),stone,true,"TemplePortalPillar")
			pillar.reparent(structure,false)
		var lintel = world.box(Vector3(35.8,1.2,2.2),Vector3(0,9,z),stone,false,"TemplePortalLintel")
		lintel.reparent(structure,false)
	var tip := CylinderMesh.new()
	tip.radial_segments = 4
	tip.top_radius = 0
	tip.bottom_radius = 2.37
	tip.height = 1.8
	var cap = world.mesh_object(tip,Vector3(0,40.5,0),stone,"PyramidCapstone")
	cap.rotation.y = PI/4
	cap.reparent(structure,false)
	for z in [-25,-12,0,12,25]:
		for side in [-1,1]:
			var light := OmniLight3D.new()
			light.name = "TempleAmberLight"
			structure.add_child(light,true)
			light.position = Vector3(side*16.5,4,z)
			light.light_color = Color("ffc47b")
			light.light_energy = 2.2
			light.omni_range = 11
			var sconce = world.box(Vector3(0.2,1,0.5),light.position,world.glowing("e7a04c"),false,"TempleSconce")
			sconce.reparent(structure,false)
			var relief = world.box(Vector3(0.16,2.5,2.6),Vector3(side*17.9,4.5,z),world.mat("7d6650",0.95),false,"TempleRelief")
			relief.reparent(structure,false)
	# Collision-free shared route, including guardrail width, through the temple.
	for i in course.COUNT:
		var local: Vector3 = structure.transform.affine_inverse()*course.point(i)
		if absf(local.z)<38 and absf(local.x)<37:
			assert(absf(local.x)+10.2<16.1,"Pyramid must clear the entire road and guardrails")

func add_sandstorm() -> void:
	var particles := CPUParticles3D.new()
	particles.name = "Sandstorm"
	particles.amount = 600
	particles.lifetime = 2.0
	particles.preprocess = 2.0
	particles.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	particles.emission_box_extents = Vector3(28,8,28)
	particles.direction = Vector3(1,0.04,0.3)
	particles.spread = 12
	particles.initial_velocity_min = 10
	particles.initial_velocity_max = 16
	particles.gravity = Vector3.ZERO
	var mesh := QuadMesh.new()
	mesh.size = Vector2(1.8,0.7)
	var material := ShaderMaterial.new()
	material.shader = load("res://shaders/sand_dust.gdshader")
	mesh.material = material
	particles.mesh = mesh
	world.add_child(particles)
