extends Control
## Lightweight 2D overlay; uses exactly the same centerline as checkpoints and AI.
var course
var karts: Array = []

func _process(_delta: float) -> void:
	queue_redraw()

func _draw() -> void:
	if course == null: return
	draw_style_box(background(),Rect2(Vector2.ZERO,Vector2(210,190)))
	var route := PackedVector2Array()
	for p in course.points: route.append(Vector2(p.x,p.z)*0.48+Vector2(100,95))
	route.append(route[0])
	draw_polyline(route,Color("667f8b"),5,true)
	for i in karts.size():
		var p: Vector3 = karts[i].position
		draw_circle(Vector2(p.x,p.z)*0.48+Vector2(100,95),4 if i==0 else 2.5,Color("ffd58e") if i==0 else Color("b4c6ce"))

func background() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.03,0.06,0.09,0.78)
	style.set_corner_radius_all(8)
	return style
