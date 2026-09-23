extends CharacterBody3D
## Arcade handling shared by player and bots; input is supplied externally.
var throttle := 0.0
var steering := 0.0
var drift := false
var boost_pressed := false
var speed := 0.0
var boost_time := 0.0
var boost_energy := 1.0
var drift_charge := 0.0
var enabled := true
var driver_name := "YOU"
var body_visual: Node3D
var wheels: Array[Node3D] = []
var steering_pivots: Array[Node3D] = []
const WHEEL_RADIUS := 0.38
var smoke: CPUParticles3D
var max_speed := 27.0

func material(color: Color, metal: float = 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.metallic = metal
	m.roughness = 0.35 if metal > 0 else 0.85
	return m

func box(parent: Node3D, size: Vector3, pos: Vector3, mat: Material) -> MeshInstance3D:
	var mesh := MeshInstance3D.new()
	var shape := BoxMesh.new()
	shape.size = size
	mesh.mesh = shape
	mesh.material_override = mat
	mesh.position = pos
	parent.add_child(mesh)
	return mesh

func setup(color: Color) -> void:
	collision_layer = 2
	collision_mask = 1 | 2
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(1.6, 0.8, 2.7)
	collision.shape = shape
	collision.position.y = 0.4
	add_child(collision)
	body_visual = Node3D.new()
	add_child(body_visual)
	var paint := material(color, 0.35)
	paint.roughness = 0.24
	paint.clearcoat_enabled = true
	paint.clearcoat = 0.55
	paint.clearcoat_roughness = 0.18
	var dark := material(Color("162735"))
	build_body(paint)
	box(body_visual, Vector3(1.4,0.15,2.9),Vector3(0,0.32,0),dark)
	box(body_visual, Vector3(0.7,0.48,0.65),Vector3(0,0.78,0.3),dark)
	box(body_visual, Vector3(0.2,0.025,1.1),Vector3(0,0.81,-0.8),material(Color("e7d5ad")))
	# Helmet and shoulders make the vehicle read as a driven kart.
	var helmet := MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.31
	sphere.height = 0.62
	sphere.radial_segments = 20
	sphere.rings = 10
	helmet.mesh = sphere
	helmet.position = Vector3(0,1.33,0.22)
	helmet.material_override = material(Color("e2dccb"),0.25)
	body_visual.add_child(helmet)
	box(body_visual,Vector3(0.49,0.16,0.12),Vector3(0,1.37,-0.04),material(Color("182b3a"),0.55))
	box(body_visual,Vector3(0.63,0.36,0.42),Vector3(0,0.99,0.25),paint)
	for x in [-0.53,0.53]:
		box(body_visual,Vector3(0.1,0.4,0.12),Vector3(x,0.91,1.18),dark)
	box(body_visual, Vector3(1.85, 0.13, 0.42), Vector3(0, 1.05, 1.2), paint)
	for x in [-0.6, 0.6]:
		box(body_visual, Vector3(0.36, 0.14, 0.06), Vector3(x, 0.69, -1.43), material(Color("ffe9ba")))
		box(body_visual, Vector3(0.36, 0.1, 0.06), Vector3(x, 0.7, 1.43), material(Color("ed573e")))
	for x in [-0.93, 0.93]:
		for z in [-0.87, 0.9]:
			var steering_pivot := Node3D.new()
			steering_pivot.position = Vector3(x,WHEEL_RADIUS,z)
			body_visual.add_child(steering_pivot)
			if z < 0: steering_pivots.append(steering_pivot)
			var rolling_pivot := Node3D.new()
			steering_pivot.add_child(rolling_pivot)
			var wheel := MeshInstance3D.new()
			var cylinder := CylinderMesh.new()
			cylinder.top_radius = 0.38
			cylinder.bottom_radius = 0.38
			cylinder.height = 0.28
			cylinder.radial_segments = 24
			wheel.mesh = cylinder
			wheel.material_override = material(Color("171b20"))
			wheel.rotation.z = PI / 2
			rolling_pivot.add_child(wheel)
			var rim := MeshInstance3D.new()
			var rim_shape := CylinderMesh.new()
			rim_shape.top_radius = 0.24
			rim_shape.bottom_radius = 0.24
			rim_shape.height = 0.3
			rim_shape.radial_segments = 16
			rim.mesh = rim_shape
			rim.material_override = material(Color("343d47"),0.8)
			wheel.add_child(rim)
			for spoke_id in 5:
				var spoke := box(wheel,Vector3(0.065,0.315,0.4),Vector3.ZERO,material(Color("b4bdc5"),0.85))
				spoke.rotation.y = spoke_id*PI/5
			wheels.append(rolling_pivot)
	smoke = CPUParticles3D.new()
	smoke.position = Vector3(0, 0.3, 1.4)
	smoke.amount = 28
	smoke.lifetime = 0.5
	smoke.direction = Vector3(0, 0.2, 1)
	smoke.spread = 35
	smoke.initial_velocity_min = 1.0
	smoke.initial_velocity_max = 3.0
	smoke.gravity = Vector3(0, 1, 0)
	smoke.scale_amount_min = 0.1
	smoke.scale_amount_max = 0.35
	var particle_mesh := SphereMesh.new()
	particle_mesh.radius = 0.2
	particle_mesh.height = 0.4
	smoke.mesh = particle_mesh
	smoke.emitting = false
	add_child(smoke)
	set_reflection_layers(body_visual)

func set_reflection_layers(node: Node) -> void:
	if node is MeshInstance3D: node.layers = 2
	for child in node.get_children(): set_reflection_layers(child)

func build_body(paint: Material) -> void:
	# Cross sections form a sloping nose and sculpted side pods without a heavy model.
	var sections := [Vector3(0.65,0.5,-1.45),Vector3(0.85,0.77,-0.75),Vector3(0.8,0.66,0.55),Vector3(0.72,0.68,1.35)]
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in sections.size()-1:
		var a: Vector3 = sections[i]
		var b: Vector3 = sections[i+1]
		var ring_a := [Vector3(-a.x,0.38,a.z),Vector3(-a.x*0.85,a.y,a.z),Vector3(a.x*0.85,a.y,a.z),Vector3(a.x,0.38,a.z)]
		var ring_b := [Vector3(-b.x,0.38,b.z),Vector3(-b.x*0.85,b.y,b.z),Vector3(b.x*0.85,b.y,b.z),Vector3(b.x,0.38,b.z)]
		for j in 4:
			for v in [ring_a[j],ring_b[j],ring_b[(j+1)%4],ring_a[j],ring_b[(j+1)%4],ring_a[(j+1)%4]]:
				surface.add_vertex(v)
	surface.generate_normals()
	var body := MeshInstance3D.new()
	body.mesh = surface.commit()
	var double_sided := paint.duplicate() as StandardMaterial3D
	double_sided.cull_mode = BaseMaterial3D.CULL_DISABLED
	body.material_override = double_sided
	body_visual.add_child(body)

func simulate(delta: float, on_road: bool) -> void:
	if not enabled:
		throttle = 0
		steering = 0
		drift = false
		boost_pressed = false
	if boost_pressed and boost_energy >= 1 and enabled:
		boost_time = 1.6
		boost_energy = 0
	boost_energy = minf(1.0, boost_energy + delta * 0.075)
	boost_time = maxf(0, boost_time - delta)
	var cap := max_speed + (11.0 if boost_time > 0 else 0.0)
	if not on_road:
		cap *= 0.48
	var target := throttle * (cap if throttle >= 0 else 8.0)
	speed = move_toward(speed, target, delta * (15.0 if throttle != 0 else 7.0))
	var drifting := drift and absf(speed) > 10 and absf(steering) > 0.1
	if drifting:
		drift_charge = minf(1.6, drift_charge + delta)
	elif drift_charge > 0:
		if drift_charge > 0.65 and enabled:
			boost_time = maxf(boost_time, drift_charge * 0.7)
		drift_charge = 0
	rotation.y -= steering * delta * (1.5 if drifting else 1.12) * clampf(speed / 10, -0.7, 1)
	var forward := -global_transform.basis.z
	velocity = forward * speed
	velocity.y = -2
	var previous_position := global_position
	move_and_slide()
	if get_slide_collision_count() > 0:
		for i in get_slide_collision_count():
			if absf(get_slide_collision(i).get_normal().y) < 0.4:
				speed *= 0.97
	body_visual.rotation.z = lerpf(body_visual.rotation.z, -steering * speed * 0.0025, delta * 8)
	body_visual.rotation.y = lerp_angle(body_visual.rotation.y, -steering * 0.2 if drifting else 0.0, delta * 8)
	update_wheels((global_position - previous_position).dot(forward))
	smoke.emitting = enabled and (drifting or boost_time > 0)
	smoke.color = Color("efa74c") if boost_time > 0 else Color(0.65, 0.7, 0.72, 0.5)

func update_wheels(travel: float) -> void:
	for pivot in steering_pivots: pivot.rotation.y = -steering * 0.4
	# v = omega*r. Forward is -Z; negative rotation around X rolls forward.
	for wheel in wheels: wheel.rotation.x = fmod(wheel.rotation.x - travel/WHEEL_RADIUS,TAU)

func reset_at(pos: Vector3, heading: Vector3) -> void:
	position = pos + Vector3.UP * 0.05
	rotation.y = atan2(-heading.x, -heading.z)
	speed = 0
	velocity = Vector3.ZERO
	drift_charge = 0
	boost_time = 0
