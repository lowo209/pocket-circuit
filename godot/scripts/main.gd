extends Node3D
const Course = preload("res://scripts/course.gd")
const Kart = preload("res://scripts/kart.gd")
const Race = preload("res://scripts/race.gd")
const Brain = preload("res://scripts/ai.gd")
const Profile = preload("res://scripts/profile.gd")
const Harbor = preload("res://scripts/world.gd")
var course := Course.new()
var race := Race.new()
var profile := Profile.new()
var world: Node3D
var karts: Array = []
var brains: Array = []
var camera: Camera3D
var ui: CanvasLayer
var lens_rain: ColorRect
var panel: PanelContainer
var content: VBoxContainer
var hud: Label
var center: Label
var minimap: Control
var race_hud: Control
var state := "menu"
var previous_state := "hub"
var menu_time := 0.0
var result_saved := false
var stuck_time: Array[float] = []
var engine_audio: AudioStreamPlayer
var engine_phase := 0.0
var engine_playback: AudioStreamGeneratorPlayback
var notice := ""
var autoplay_test := false
var selected_track := 0
const MAP_PATHS := ["res://maps/sunset_bay.tscn", "res://maps/dust_valley.tscn", "res://maps/neon_harbor.tscn"]
var TEST_SAVE := "user://pocket_circuit_validation_profile.json"

func _ready() -> void:
	setup_inputs()
	autoplay_test = "--autoplay-test" in OS.get_cmdline_user_args()
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--track="): selected_track = clampi(arg.trim_prefix("--track=").to_int(),0,2)
	course = Course.new(selected_track)
	TEST_SAVE = "user://pocket_circuit_validation_%d.json" % selected_track
	# Test runs never load or overwrite the player's save.
	if "--smoke-test" not in OS.get_cmdline_user_args() and not autoplay_test:
		profile.load_save()
	world = get_node_or_null("World")
	if world: world.free()
	load_world()
	var colors := [Color("dba353"), Color("588bac"), Color("a35247"), Color("8b9b69"), Color("a18cae"), Color("e0d6bd")]
	var names := ["YOU", "COCO", "ROCKET", "MOCHI", "BLITZ", "NOVA"]
	for i in 6:
		var kart := Kart.new()
		add_child(kart)
		kart.setup(colors[i])
		kart.driver_name = names[i]
		karts.append(kart)
		stuck_time.append(0.0)
		var ai := Brain.new()
		ai.personality = i
		brains.append(ai)
	camera = Camera3D.new()
	camera.far = 800
	camera.current = true
	add_child(camera)
	build_ui()
	setup_audio()
	apply_settings()
	park_karts()
	show_menu()
	if "--smoke-test" in OS.get_cmdline_user_args():
		call_deferred("smoke_test")
	if "--capture-preview" in OS.get_cmdline_user_args():
		call_deferred("capture_preview")
	if autoplay_test:
		Engine.time_scale = 6
		Engine.max_fps = 0
		call_deferred("start_race")

func load_world() -> void:
	if world and is_instance_valid(world): world.free()
	course = Course.new(selected_track)
	if ResourceLoader.exists(MAP_PATHS[selected_track]):
		world = load(MAP_PATHS[selected_track]).instantiate()
		add_child(world)
	else:
		world = Harbor.new()
		add_child(world)
		world.build(course)
	world.name = "World"

func select_track(index: int) -> void:
	selected_track = index
	load_world()
	park_karts()
	apply_settings()

func setup_inputs() -> void:
	var actions := {"accelerate": [KEY_W, KEY_UP], "brake": [KEY_S, KEY_DOWN],
		"left": [KEY_A, KEY_LEFT], "right": [KEY_D, KEY_RIGHT], "drift": [KEY_SHIFT],
		"boost": [KEY_SPACE], "interact": [KEY_E], "reset_kart": [KEY_R], "pause_game": [KEY_ESCAPE]}
	for action in actions:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for key in actions[action]:
			var event := InputEventKey.new()
			event.physical_keycode = key
			InputMap.action_add_event(action, event)

func build_ui() -> void:
	var weather := CanvasLayer.new()
	weather.layer = 0
	add_child(weather)
	lens_rain = ColorRect.new()
	lens_rain.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	lens_rain.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var lens_material := ShaderMaterial.new()
	lens_material.shader = load("res://shaders/lens_rain.gdshader")
	lens_rain.material = lens_material
	weather.add_child(lens_rain)
	ui = CanvasLayer.new()
	add_child(ui)
	var theme := Theme.new()
	theme.default_font_size = 20
	var button_style := StyleBoxFlat.new()
	button_style.bg_color = Color("273f4a")
	button_style.content_margin_left = 20
	button_style.content_margin_right = 20
	button_style.content_margin_top = 12
	button_style.content_margin_bottom = 12
	button_style.set_corner_radius_all(4)
	theme.set_stylebox("normal", "Button", button_style)
	var hover := button_style.duplicate()
	hover.bg_color = Color("355048")
	hover.border_color = Color("9de3cc")
	hover.set_border_width_all(1)
	theme.set_stylebox("hover", "Button", hover)
	theme.set_stylebox("focus", "Button", hover)
	var pressed := button_style.duplicate()
	pressed.bg_color = Color("775835")
	theme.set_stylebox("pressed", "Button", pressed)
	panel = PanelContainer.new()
	panel.position = Vector2(48, 40)
	panel.custom_minimum_size = Vector2(460, 0)
	panel.theme = theme
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.035, 0.065, 0.09, 0.96)
	style.content_margin_left = 28
	style.content_margin_right = 28
	style.content_margin_top = 24
	style.content_margin_bottom = 24
	style.border_width_top = 3
	style.border_color = Color("9de3cc")
	style.set_corner_radius_all(10)
	panel.add_theme_stylebox_override("panel", style)
	ui.add_child(panel)
	content = VBoxContainer.new()
	content.add_theme_constant_override("separation", 6)
	panel.add_child(content)
	hud = Label.new()
	hud.position = Vector2(30, 24)
	hud.add_theme_font_size_override("font_size", 20)
	hud.add_theme_color_override("font_shadow_color", Color.BLACK)
	hud.add_theme_constant_override("shadow_offset_x", 2)
	hud.add_theme_constant_override("shadow_offset_y", 2)
	ui.add_child(hud)
	center = Label.new()
	center.position = Vector2(535, 275)
	center.size = Vector2(300, 150)
	center.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	center.add_theme_font_size_override("font_size", 64)
	ui.add_child(center)
	minimap = load("res://ui/minimap.gd").new()
	minimap.position = Vector2(1068,24)
	minimap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(minimap)
	race_hud = load("res://ui/race_hud.gd").new()
	ui.add_child(race_hud)

func clear_panel(title: String, subtitle: String) -> void:
	hud.hide()
	center.hide()
	for child in content.get_children():
		content.remove_child(child)
		child.queue_free()
	panel.visible = true
	panel.size = Vector2.ZERO
	label(title, 36, Color("efd7b0"))
	label(subtitle, 16, Color("92acb7"))

func label(text: String, size := 19, color := Color("e1e8e9")) -> Label:
	var node := Label.new()
	node.text = text
	node.add_theme_font_size_override("font_size", size)
	node.add_theme_color_override("font_color", color)
	content.add_child(node)
	return node

func button(text: String, action: Callable) -> Button:
	var node := Button.new()
	node.text = text
	node.alignment = HORIZONTAL_ALIGNMENT_LEFT
	node.pressed.connect(action)
	content.add_child(node)
	return node

func show_menu() -> void:
	state = "menu"
	hud.visible = false
	center.text = ""
	clear_panel("POCKET CIRCUIT", "NEON CITY UPDATE  /  v0.3 DEVELOPMENT PREVIEW")
	label("Choose your next starting line.", 18)
	var tracks := OptionButton.new()
	for title in Course.TITLES: tracks.add_item(title)
	tracks.selected = selected_track
	tracks.item_selected.connect(select_track)
	content.add_child(tracks)
	label("%d coins    /    %d completed races" % [profile.coins, profile.races], 17)
	button("EXPLORE PADDOCK  →", enter_hub).grab_focus()
	button("QUICK RACE", start_race)
	button("SETTINGS", func(): show_settings("menu"))
	button("QUIT", func(): get_tree().quit())
	label("WASD / arrows • Drive    Shift • Drift\nSpace • Boost    R • Recover    Esc • Menu", 15)
	if not profile.error.is_empty():
		label(profile.error, 12, Color("f29b75"))

func park_karts() -> void:
	for i in karts.size():
		karts[i].reset_at(course.hub_position() + Vector3((i % 3)*4-4,0,(i/3)*5), course.forward(0))

func enter_hub() -> void:
	state = "hub"
	race.active = false
	panel.hide()
	hud.show()
	center.show()
	center.text = ""
	park_karts()
	camera.position = karts[0].position - course.forward(0)*6.2 + Vector3.UP*3.2

func start_race() -> void:
	state = "race"
	panel.hide()
	hud.show()
	center.show()
	result_saved = false
	notice = ""
	race.begin(karts.size())
	for i in karts.size():
		var row := i / 2
		var offset: Vector3 = course.side(0) * (-2 if i % 2 == 0 else 2)
		karts[i].reset_at(course.point(0) - course.forward(0) * (4 + row * 4) + offset, course.forward(0))
		karts[i].boost_energy = 1
		brains[i].skill = clampf((profile.skill if profile.adaptive else 0.5) + (i - 3) * 0.025, 0, 1)
		stuck_time[i] = 0
	camera.position = karts[0].position - course.forward(0) * 6.2 + Vector3.UP * 3.2

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause_game"):
		if state == "pause":
			resume_game()
		elif state in ["race", "hub"]:
			previous_state = state
			state = "pause"
			clear_panel("PIT STOP", "Race simulation is paused")
			button("RESUME", resume_game).grab_focus()
			button("SETTINGS", func(): show_settings("pause"))
			button("RETURN TO PADDOCK", enter_hub)
			button("MAIN MENU", show_menu)
	if state == "hub" and event.is_action_pressed("interact") and karts[0].position.distance_to(course.hub_position()) < 19:
		start_race()
	if state in ["hub", "race"] and event.is_action_pressed("reset_kart"):
		recover(0)

func resume_game() -> void:
	state = previous_state
	panel.hide()
	hud.show()
	center.show()

func recover(id: int) -> void:
	var index: int = course.nearest(karts[id].position)
	if state == "race":
		# Recover behind the next required checkpoint, never ahead of it.
		index = (int(race.drivers[id].gate) % race.GATES) * course.COUNT / race.GATES - 3
	karts[id].reset_at(course.point(index), course.forward(index))
	stuck_time[id] = 0

func _physics_process(delta: float) -> void:
	if state not in ["race", "hub"]:
		return
	var running := race.tick(delta) if state == "race" else true
	for i in karts.size():
		var kart = karts[i]
		kart.enabled = running and (state == "race" or i == 0)
		if i == 0 and not autoplay_test:
			kart.throttle = Input.get_axis("brake", "accelerate")
			kart.steering = Input.get_axis("left", "right")
			kart.drift = Input.is_action_pressed("drift")
			kart.boost_pressed = Input.is_action_just_pressed("boost")
		elif state == "race" and running:
			brains[i].drive(kart, course, karts, race.elapsed)
		if state == "race" and race.drivers[i].finished:
			kart.enabled = false
		var index: int = course.nearest(kart.position)
		var on_road: bool = kart.position.distance_to(course.point(index)) < course.WIDTH * 0.56 or state == "hub"
		if selected_track == 2 and kart.enabled:
			for pad in Course.CITY_BOOST_PADS:
				var offset: Vector3 = kart.position-course.point(pad)
				if absf(offset.dot(course.forward(pad)))<1.8 and absf(offset.dot(course.side(pad)))<4.0 and (-kart.basis.z).dot(course.forward(pad))>0.5:
					kart.apply_track_boost()
		kart.simulate(delta, on_road)
		if kart.position.y < -5 or absf(kart.position.x-15) > 222 or absf(kart.position.z+5) > 208:
			recover(i)
		if state == "race" and running:
			race.check_gate(i, kart.position, course, -kart.global_transform.basis.z)
			if i > 0:
				stuck_time[i] = stuck_time[i] + delta if absf(kart.speed) < 4 or not on_road else 0.0
				if stuck_time[i] > 3:
					recover(i)
	if state == "race" and race.drivers[0].finished:
		finish_race()
	elif state == "race" and race.elapsed > 300:
		finish_race(true)

func _process(delta: float) -> void:
	menu_time += delta
	lens_rain.visible = selected_track == 2 and state in ["hub","race"] and profile.lens_rain
	hud.hide()
	race_hud.update_info(state,Course.TITLES[selected_track],race,karts,course)
	minimap.visible = state in ["hub","race"]
	minimap.course = course
	minimap.karts = karts
	if state == "menu":
		camera.position = course.point(18) + Vector3(38*cos(menu_time*0.045),24,38*sin(menu_time*0.045))
		camera.look_at(course.point(18))
	elif state in ["hub", "race"]:
		var kart = karts[0]
		var rain := world.get_node_or_null("Rain") as CPUParticles3D
		if rain: rain.global_position = kart.global_position + Vector3.UP*12
		var forward: Vector3 = -kart.global_transform.basis.z
		var splashes := world.get_node_or_null("RoadSplashes") as CPUParticles3D
		if splashes:
			var road_index: int = course.nearest(kart.position)
			splashes.global_position = course.point(road_index)+Vector3.UP*0.06
			splashes.rotation.y = atan2(-course.forward(road_index).x,-course.forward(road_index).z)
		var target: Vector3 = kart.position - forward * (6.2 + absf(kart.speed) * 0.018) + Vector3.UP * 3.2
		camera.position = camera.position.lerp(target, 1 - exp(-delta * 6))
		camera.look_at(kart.position + forward * 3 + Vector3.UP)
		camera.fov = lerpf(camera.fov, 74.0 if kart.boost_time > 0 else 65.0, delta * 5)
		var speed := int(absf(kart.speed) * 3.6)
		if state == "hub":
			hud.text = "%s  /  FREE DRIVE\n%03d km/h\n\nDrive to the PIT CLUB sign and press E to race.\nWASD • Drive   Shift • Drift   Space • Boost\nR • Recover   Esc • Menu" % [Course.TITLES[selected_track].to_upper(),speed]
		else:
			center.text = str(ceili(race.countdown)) if race.countdown > 0 else ("GO" if race.elapsed < 0.9 else "")
			hud.text = "%s  /  %d of 6\nLAP %d / 3     %s\n%03d km/h    BOOST %d%%" % [Course.TITLES[selected_track].to_upper(),race.place(0, karts, course), mini(race.drivers[0].lap + 1, 3), format_time(race.elapsed), speed, int(kart.boost_energy * 100)]
	update_audio()

func format_time(seconds: float) -> String:
	return "%02d:%05.2f" % [int(seconds) / 60, fmod(seconds, 60)]

func finish_race(timed_out := false) -> void:
	if result_saved:
		return
	result_saved = true
	state = "results"
	race.active = false
	center.text = ""
	hud.hide()
	var place := race.place(0, karts, course)
	var reward := 0
	if not timed_out:
		var laps: Array[float] = []
		for value in race.drivers[0].laps:
			laps.append(float(value))
		reward = profile.record_race(place, laps, course.length)
		if not profile.save(TEST_SAVE if autoplay_test else Profile.SAVE_PATH):
			notice = "Could not save progress. Check the save folder."
	clear_panel("TIME UP" if timed_out else "FINISH  /  #%d" % place, Course.TITLES[selected_track].to_upper() + "   •   THREE LAPS")
	label("Race time  %s" % format_time(race.elapsed), 26)
	label("+%d coins    /    Balance %d" % [reward, profile.coins])
	for i in race.drivers[0].laps.size():
		label("Lap %d     %s" % [i + 1, format_time(race.drivers[0].laps[i])], 17)
	label("Next-race AI: %s" % ("adaptive %d%%" % int(profile.skill * 100) if profile.adaptive else "fixed medium"), 17)
	if not notice.is_empty():
		label(notice, 15, Color("f29b75"))
	button("RETURN TO PADDOCK", enter_hub).grab_focus()
	button("RACE AGAIN", start_race)
	button("MAIN MENU", show_menu)
	if autoplay_test:
		var restored := Profile.new()
		restored.load_save(TEST_SAVE)
		var success: bool = not timed_out and restored.races == 1 and race.drivers[0].laps.size() == 3
		print("LIVE PHYSICS TEST: ", "PASS" if success else "FAIL", " track=", selected_track, " elapsed=", race.elapsed, " laps=", race.drivers[0].laps)
		DirAccess.remove_absolute(TEST_SAVE)
		get_tree().quit(0 if success else 1)

func show_settings(return_state: String) -> void:
	state = "settings"
	clear_panel("SETTINGS", "Changes are applied immediately")
	var quality := OptionButton.new()
	for option in ["Low — shadows off", "Medium — short shadows + 2× AA", "High — longer shadows + 4× AA", "Ultra — far shadows + 8× AA"]:
		quality.add_item(option)
	quality.selected = profile.quality
	quality.item_selected.connect(func(index): profile.quality = index; apply_settings())
	content.add_child(quality)
	var adaptive := CheckButton.new()
	adaptive.text = "Adaptive AI (off = fixed medium)"
	adaptive.button_pressed = profile.adaptive
	adaptive.toggled.connect(func(value): profile.adaptive = value)
	content.add_child(adaptive)
	var droplets := CheckButton.new()
	droplets.text = "Rain droplets on camera"
	droplets.button_pressed = profile.lens_rain
	droplets.toggled.connect(func(value): profile.lens_rain = value)
	content.add_child(droplets)
	var full := CheckButton.new()
	full.text = "Fullscreen"
	full.button_pressed = profile.fullscreen
	full.toggled.connect(func(value): profile.fullscreen = value; apply_settings())
	content.add_child(full)
	var sync := CheckButton.new()
	sync.text = "VSync"
	sync.button_pressed = profile.vsync
	sync.toggled.connect(func(value): profile.vsync = value; apply_settings())
	content.add_child(sync)
	var fps := OptionButton.new()
	for option in ["30 FPS", "60 FPS", "120 FPS", "Unlimited FPS"]:
		fps.add_item(option)
	fps.selected = [30, 60, 120, 0].find(profile.fps_limit)
	fps.item_selected.connect(func(index): profile.fps_limit = [30, 60, 120, 0][index]; apply_settings())
	content.add_child(fps)
	label("Engine volume", 16)
	var volume := HSlider.new()
	volume.min_value = 0
	volume.max_value = 1
	volume.step = 0.05
	volume.value = profile.volume
	volume.value_changed.connect(func(value): profile.volume = value; apply_settings())
	content.add_child(volume)
	button("SAVE & BACK", func():
		if not profile.save():
			label("Save failed. Settings remain for this session.", 14)
			return
		if return_state == "menu":
			show_menu()
		else:
			resume_game()
	).grab_focus()
	button("BACK WITHOUT SAVING", func():
		if return_state == "menu": show_menu()
		else: resume_game()
	)

func apply_settings() -> void:
	world.set_quality(profile.quality)
	if lens_rain: lens_rain.material.set_shader_parameter("drop_count",[8.0,14.0,20.0,24.0][profile.quality])
	get_viewport().msaa_3d = [Viewport.MSAA_DISABLED, Viewport.MSAA_2X, Viewport.MSAA_4X, Viewport.MSAA_8X][profile.quality]
	Engine.max_fps = profile.fps_limit
	if DisplayServer.get_name() != "headless":
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if profile.fullscreen else DisplayServer.WINDOW_MODE_WINDOWED)
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if profile.vsync else DisplayServer.VSYNC_DISABLED)
	if engine_audio:
		engine_audio.volume_db = linear_to_db(maxf(0.001, profile.volume * 0.2))

func setup_audio() -> void:
	if DisplayServer.get_name() == "headless":
		return
	engine_audio = AudioStreamPlayer.new()
	var stream := AudioStreamGenerator.new()
	stream.mix_rate = 22050
	stream.buffer_length = 0.12
	engine_audio.stream = stream
	add_child(engine_audio)
	engine_audio.play()
	engine_playback = engine_audio.get_stream_playback()

func update_audio() -> void:
	if engine_playback == null:
		return
	var active := state in ["hub", "race"]
	var frequency: float = 45 + absf(karts[0].speed) * 3.7
	for i in engine_playback.get_frames_available():
		engine_phase = fmod(engine_phase + frequency / 22050.0, 1.0)
		var sample := (sin(engine_phase * TAU) * 0.65 + sin(engine_phase * TAU * 2) * 0.25) if active else 0.0
		engine_playback.push_frame(Vector2.ONE * sample)

func capture_preview() -> void:
	await get_tree().create_timer(2).timeout
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute("res://test-output")
	get_viewport().get_texture().get_image().save_png("res://test-output/menu_%d.png" % selected_track)
	start_race()
	await get_tree().create_timer(1).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("res://test-output/race_%d.png" % selected_track)
	race.countdown = 0
	race.elapsed = 2
	karts[0].reset_at(course.point(18),course.forward(18))
	camera.position = karts[0].position-course.forward(18)*6.2+Vector3.UP*3.2
	await get_tree().create_timer(0.5).timeout
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("res://test-output/curve_%d.png" % selected_track)
	show_settings("menu")
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("res://test-output/settings.png")
	get_tree().quit()

func smoke_test() -> void:
	enter_hub()
	assert(state == "hub")
	start_race()
	# Accelerated full simulation using the real AI, controller and checkpoints.
	for i in 22000:
		var delta := 1.0 / 60.0
		if race.tick(delta):
			for id in karts.size():
				if race.drivers[id].finished:
					continue
				brains[id].drive(karts[id], course, karts, race.elapsed)
				karts[id].enabled = true
				karts[id].simulate(delta, true)
				race.check_gate(id, karts[id].position, course, -karts[id].global_transform.basis.z)
		if race.finish_order.size() == 6:
			break
	print("SMOKE RACE: finished=", race.finish_order.size(), " time=", race.elapsed)
	for id in karts.size():
		print("DRIVER ", id, " gates=", race.drivers[id].gate, " position=", karts[id].position)
	var success := race.finish_order.size() == 6
	var test_path := "user://smoke_profile.json"
	var laps: Array[float] = [30.0, 29.0, 28.0]
	profile.record_race(1, laps, course.length)
	success = profile.save(test_path) and success
	var restored := Profile.new()
	restored.load_save(test_path)
	success = success and restored.races == 1 and restored.coins == 100 and absf(restored.skill - 0.5) <= 0.081
	DirAccess.remove_absolute(test_path)
	enter_hub()
	show_settings("menu")
	print("SMOKE RESULT: ", "PASS" if success else "FAIL")
	get_tree().quit(0 if success else 1)
