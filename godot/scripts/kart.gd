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
	var dark := material(Color("162735"))
	box(body_visual, Vector3(1.7, 0.45, 2.8), Vector3(0, 0.6, 0), paint)
	box(body_visual, Vector3(1.25, 0.5, 1.15), Vector3(0, 1.02, 0.2), dark)
	box(body_visual, Vector3(0.2, 0.02, 2.8), Vector3(0, 0.835, 0), material(Color("e7d5ad")))
	box(body_visual, Vector3(1.85, 0.13, 0.42), Vector3(0, 1.05, 1.2), paint)
	for x in [-0.6, 0.6]:
		box(body_visual, Vector3(0.36, 0.14, 0.06), Vector3(x, 0.69, -1.43), material(Color("ffe9ba")))
		box(body_visual, Vector3(0.36, 0.1, 0.06), Vector3(x, 0.7, 1.43), material(Color("ed573e")))
	for x in [-0.93, 0.93]:
		for z in [-0.87, 0.9]:
			var wheel := MeshInstance3D.new()
			var cylinder := CylinderMesh.new()
			cylinder.top_radius = 0.38
			cylinder.bottom_radius = 0.38
			cylinder.height = 0.28
			cylinder.radial_segments = 12
			wheel.mesh = cylinder
			wheel.material_override = dark
			wheel.rotation.z = PI / 2
			wheel.position = Vector3(x, 0.38, z)
			body_visual.add_child(wheel)
			wheels.append(wheel)
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
	move_and_slide()
	if get_slide_collision_count() > 0:
		for i in get_slide_collision_count():
			if absf(get_slide_collision(i).get_normal().y) < 0.4:
				speed *= 0.97
	body_visual.rotation.z = lerpf(body_visual.rotation.z, -steering * speed * 0.0025, delta * 8)
	body_visual.rotation.y = lerp_angle(body_visual.rotation.y, -steering * 0.2 if drifting else 0.0, delta * 8)
	for wheel in wheels:
		wheel.rotate_y(speed * delta * 2)
	smoke.emitting = enabled and (drifting or boost_time > 0)
	smoke.color = Color("efa74c") if boost_time > 0 else Color(0.65, 0.7, 0.72, 0.5)

func reset_at(pos: Vector3, heading: Vector3) -> void:
	position = pos + Vector3.UP * 0.05
	rotation.y = atan2(-heading.x, -heading.z)
	speed = 0
	velocity = Vector3.ZERO
	drift_charge = 0
	boost_time = 0
