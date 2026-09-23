extends SceneTree
func _initialize() -> void:
	call_deferred("run_checks")

func run_checks() -> void:
	var kart = load("res://scripts/kart.gd").new()
	root.add_child(kart)
	kart.setup(Color.WHITE)
	kart.update_wheels(0.38)
	for roll in kart.wheels:
		assert(absf(roll.rotation.x+1.0)<0.0001,"Forward travel must roll around negative X")
		var axle: Vector3 = roll.basis * roll.get_child(0).basis.y
		assert(absf(axle.normalized().dot(Vector3.RIGHT))>0.999,"Axle must not wobble while rolling")
	kart.update_wheels(-0.38)
	for roll in kart.wheels: assert(absf(roll.rotation.x)<0.0001,"Reverse travel must reverse wheel roll")
	kart.steering = 1
	kart.update_wheels(0)
	for front in kart.steering_pivots: assert(front.rotation.y<0,"Right input must steer front wheels right")
	for roll in kart.wheels:
		if roll.get_parent() not in kart.steering_pivots: assert(is_zero_approx(roll.get_parent().rotation.y))
	kart.free()
	for track_id in 3:
		var course = load("res://scripts/course.gd").new(track_id)
		var packed: PackedScene = load(["res://maps/sunset_bay.tscn","res://maps/dust_valley.tscn","res://maps/neon_harbor.tscn"][track_id])
		var map := packed.instantiate()
		for side in [-1,1]:
			var curb := map.get_node("ContinuousCurbLeft" if side<0 else "ContinuousCurbRight") as MeshInstance3D
			var vertices: PackedVector3Array = curb.mesh.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
			assert(vertices.size()==course.COUNT*12)
			for i in course.COUNT:
				var next: int = (i+1)%course.COUNT
				assert(vertices[i*12+1].distance_to(vertices[next*12])<0.0001,"Curb seam must be closed")
				assert(vertices[i*12+2].distance_to(vertices[next*12+5])<0.0001,"Outer curb seam must be closed")
				var edge: Vector3 = course.point(i)+course.side(i)*7.5*side+Vector3.UP*0.025
				assert(vertices[i*12].distance_to(edge)<0.0001,"Curb must follow road edge")
		assert(map.get_node("WorldReflection") is ReflectionProbe)
		map.free()
	print("VISUAL REGRESSIONS: PASS (three closed curb loops, wheel axle/roll/reverse/steering, probes)")
	quit()
