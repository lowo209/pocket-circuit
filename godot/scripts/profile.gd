extends RefCounted
## Local, versioned persistence. A failed write never replaces the previous save.
const SAVE_PATH := "user://profile_v1.json"
var coins := 0
var races := 0
var best_lap := 0.0
var skill := 0.5
var adaptive := true
var quality := 1
var volume := 0.65
var fullscreen := false
var fps_limit := 60
var vsync := true
var lens_rain := true
var error := ""

func load_save(path: String = SAVE_PATH) -> void:
	if not FileAccess.file_exists(path):
		return
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not data is Dictionary or data.get("version") != 1:
		error = "Save could not be read. Your original file has been kept."
		return
	coins = clampi(int(data.get("coins", 0)), 0, 10000000)
	races = clampi(int(data.get("races", 0)), 0, 10000000)
	best_lap = clampf(float(data.get("best_lap", 0)), 0, 10000)
	skill = clampf(float(data.get("skill", 0.5)), 0, 1)
	adaptive = bool(data.get("adaptive", true))
	quality = clampi(int(data.get("quality", 1)), 0, 3)
	volume = clampf(float(data.get("volume", 0.65)), 0, 1)
	fullscreen = bool(data.get("fullscreen", false))
	fps_limit = int(data.get("fps_limit", 60))
	if fps_limit not in [30, 60, 120, 0]:
		fps_limit = 60
	vsync = bool(data.get("vsync", true))
	lens_rain = bool(data.get("lens_rain", true))

func save(path: String = SAVE_PATH) -> bool:
	# Preserve an unreadable save until the player has recovered it manually.
	if not error.is_empty():
		return false
	var data := {"version": 1, "coins": coins, "races": races, "best_lap": best_lap,
		"skill": skill, "adaptive": adaptive, "quality": quality, "volume": volume,
		"fullscreen": fullscreen, "fps_limit": fps_limit, "vsync": vsync, "lens_rain": lens_rain}
	var file := FileAccess.open(path + ".tmp", FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(data, "\t"))
	file.flush()
	file.close()
	return DirAccess.rename_absolute(path + ".tmp", path) == OK

func record_race(place: int, lap_times: Array[float], course_length: float) -> int:
	races += 1
	var reward := 40 + maxi(0, 6 - place) * 12
	coins += reward
	for lap in lap_times:
		if lap > 0 and (best_lap == 0 or lap < best_lap):
			best_lap = lap
	if adaptive and not lap_times.is_empty():
		var average := 0.0
		for lap in lap_times:
			average += lap
		average /= lap_times.size()
		var target := clampf((course_length / maxf(average, 1.0) - 10.0) / 13.0, 0, 1)
		# Small changes between races; never rubber-band during a race.
		skill = move_toward(skill, target, 0.08)
	return reward
