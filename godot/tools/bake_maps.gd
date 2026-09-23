extends SceneTree
func _initialize() -> void:
	call_deferred("bake")

func set_owners(node: Node, root_node: Node) -> void:
	for child in node.get_children():
		child.owner = root_node
		set_owners(child,root_node)

func bake() -> void:
	DirAccess.make_dir_recursive_absolute("res://maps")
	for i in 3:
		var course = load("res://scripts/course.gd").new(i)
		var world = load("res://scripts/world.gd").new()
		world.name = ["SunsetBay","DustValley","NeonHarbor"][i]
		root.add_child(world)
		world.build(course)
		set_owners(world,world)
		var packed := PackedScene.new()
		var result := packed.pack(world)
		if result != OK: quit(1); return
		result = ResourceSaver.save(packed,"res://maps/" + ["sunset_bay","dust_valley","neon_harbor"][i] + ".tscn")
		if result != OK: quit(1); return
		world.free()
	print("MAP BAKE: PASS")
	quit()
