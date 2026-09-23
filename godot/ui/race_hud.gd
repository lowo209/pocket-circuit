extends Control
## Readable race information in independent cards; no text floats over scenery.
const INK := Color("eaf0ef")
const MUTED := Color("9fadb6")
const ACCENT := Color("9de3cc")
var rank: Label
var title: Label
var lap: Label
var timer: Label
var speed: Label
var boost: ProgressBar
var boost_text: Label
var hint: Label

func panel_at(pos: Vector2, dimensions: Vector2) -> Panel:
	var panel := Panel.new()
	panel.position = pos
	panel.size = dimensions
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.035,0.053,0.071,0.9)
	style.border_color = Color(0.45,0.57,0.61,0.27)
	style.set_border_width_all(1)
	style.set_corner_radius_all(12)
	panel.add_theme_stylebox_override("panel",style)
	add_child(panel)
	return panel

func text_at(parent: Control, value: String, pos: Vector2, font_size: int, color := INK) -> Label:
	var label := Label.new()
	label.text = value
	label.position = pos
	label.add_theme_font_size_override("font_size",font_size)
	label.add_theme_color_override("font_color",color)
	parent.add_child(label)
	return label

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var place_panel := panel_at(Vector2(24,24),Vector2(180,94))
	text_at(place_panel,"POSITION",Vector2(18,10),12,MUTED)
	rank = text_at(place_panel,"01",Vector2(18,24),44,ACCENT)
	text_at(place_panel,"/ 06",Vector2(90,49),20,MUTED)
	var race_panel := panel_at(Vector2(218,24),Vector2(348,94))
	title = text_at(race_panel,"SUNSET BAY",Vector2(18,11),15,INK)
	lap = text_at(race_panel,"LAP 1 / 3",Vector2(18,50),19,ACCENT)
	timer = text_at(race_panel,"00:00.00",Vector2(175,44),27)
	var speed_panel := panel_at(Vector2(996,540),Vector2(260,156))
	speed = text_at(speed_panel,"000",Vector2(18,6),54)
	text_at(speed_panel,"KM/H",Vector2(177,39),14,MUTED)
	boost_text = text_at(speed_panel,"BOOST READY",Vector2(19,83),13,ACCENT)
	boost = ProgressBar.new()
	boost.position = Vector2(20,114)
	boost.size = Vector2(220,9)
	boost.show_percentage = false
	boost.max_value = 1.0
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color("293942")
	bg.set_corner_radius_all(4)
	boost.add_theme_stylebox_override("background",bg)
	var fill := bg.duplicate() as StyleBoxFlat
	fill.bg_color = ACCENT
	boost.add_theme_stylebox_override("fill",fill)
	speed_panel.add_child(boost)
	var hint_panel := panel_at(Vector2(24,651),Vector2(530,45))
	hint = text_at(hint_panel,"SHIFT  Drift     SPACE  Boost     R  Recover     ESC  Pause",Vector2(16,13),13,MUTED)

func update_info(mode: String, track_title: String, race, cars: Array, course) -> void:
	visible = mode in ["hub","race"]
	if not visible: return
	var kart = cars[0]
	title.text = track_title.to_upper()
	speed.text = "%03d" % int(absf(kart.speed)*3.6)
	boost.value = kart.boost_energy
	boost_text.text = "BOOST ACTIVE" if kart.boost_time > 0 else ("BOOST READY  /  SPACE" if kart.boost_energy >= 1 else "RECHARGING  %d%%" % int(kart.boost_energy*100))
	if mode == "race":
		rank.text = "%02d" % race.place(0,cars,course)
		lap.text = "LAP %d / 3" % mini(race.drivers[0].lap+1,3)
		timer.text = "%02d:%05.2f" % [int(race.elapsed)/60,fmod(race.elapsed,60)]
		hint.text = "SHIFT  Drift     SPACE  Boost     R  Recover     ESC  Pause"
	else:
		rank.text = "—"
		lap.text = "FREE DRIVE"
		timer.text = "PADDOCK"
		hint.text = "E  Race at PIT CLUB     WASD  Drive     ESC  Menu"
