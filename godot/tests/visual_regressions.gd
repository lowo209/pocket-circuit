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
	kart.speed = 20
	kart.apply_track_boost()
	assert(kart.boost_time>1 and kart.boost_energy==1,"Pads grant boost without spending stored energy")
	kart.boost_time = 0.4
	kart.apply_track_boost()
	assert(is_equal_approx(kart.boost_time,0.4),"A pad cannot retrigger during cooldown")
	kart.reset_at(Vector3.ZERO,Vector3.FORWARD)
	assert(kart.pad_cooldown==0)
	kart.free()
	for track_id in 3:
		var course = load("res://scripts/course.gd").new(track_id)
		var packed: PackedScene = load(["res://maps/sunset_bay.tscn","res://maps/dust_valley.tscn","res://maps/neon_harbor.tscn"][track_id])
		var map := packed.instantiate()
		root.add_child(map)
		await physics_frame
		await physics_frame
		var road := map.get_node("TrackSurface") as MeshInstance3D
		var normals: PackedVector3Array = road.mesh.surface_get_arrays(0)[Mesh.ARRAY_NORMAL]
		for normal in normals: assert(normal.y>0.99,"Road faces must point upward for bridge collision")
		var footprints: Array = map.get_meta("scenery_footprints",[])
		assert(footprints.size()>40,"Each map needs layered roadside scenery")
		for a in footprints.size():
			for b in range(a+1,footprints.size()):
				assert(Vector2(footprints[a].x,footprints[a].y).distance_to(Vector2(footprints[b].x,footprints[b].y))>=footprints[a].z+footprints[b].z+1.9,"Independent scenery footprints may not overlap")
		for i in course.COUNT:
			var p: Vector3 = course.point(i)
			var query := PhysicsRayQueryParameters3D.create(p+Vector3.UP*0.5,p-Vector3.UP*0.5,1)
			var hit := root.get_world_3d().direct_space_state.intersect_ray(query)
			assert(not hit.is_empty(),"Every road sample must have physical support")
		if track_id==0:
			assert(map.has_node("OceanCauseway"))
			assert(map.find_children("OceanBridgePier*","MeshInstance3D",false).size()>10)
		elif track_id==1:
			assert(map.has_node("PyramidTemple"))
			assert(map.has_node("Sandstorm"))
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
		if track_id==2:
			var traffic := map.get_node("SkyTraffic")
			assert(traffic.get_child_count()==18)
			traffic.update_traffic(0)
			var before: Vector3 = traffic.get_child(0).position
			traffic.update_traffic(1)
			assert(before.distance_to(traffic.get_child(0).position)>5,"Air taxis must move")
			for car in traffic.get_children(): assert(car.position.y>=19,"Flight lanes must clear gantries and bridges")
			assert(course.TITLES[2]=="NEON City")
			assert(map.get_node("RoadSplashes") is CPUParticles3D)
			assert(map.get_node("Rain") is CPUParticles3D)
			assert(map.find_children("BoostPad*","MeshInstance3D",false).size()==12)
			assert(map.find_children("City*Tower*","MeshInstance3D",false).size()>20)
			map.set_quality(0)
			assert(map.get_node("Rain").amount==250)
			assert(not map.get_node("WorldReflection").visible)
		map.free()
	var profile = load("res://scripts/profile.gd").new()
	profile.lens_rain = false
	assert(profile.save("user://city_settings_test.json"))
	var restored = load("res://scripts/profile.gd").new()
	restored.load_save("user://city_settings_test.json")
	assert(not restored.lens_rain,"Camera rain preference must persist")
	DirAccess.remove_absolute("user://city_settings_test.json")
	print("VISUAL REGRESSIONS: PASS (curbs, wheels, road support, nonoverlapping scenery, weather, moving air taxis)")
	quit()
