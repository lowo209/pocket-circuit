extends Control
## Lightweight 2D overlay; uses exactly the same centerline as checkpoints and AI.
var course
var karts: Array = []

func _process(_delta: float) -> void:
	queue_redraw()

func _draw() -> void:
	if course == null: return
	draw_style_box(background(),Rect2(Vector2.ZERO,Vector2(188,170)))
	var route := PackedVector2Array()
	var bounds := Rect2(Vector2(course.points[0].x,course.points[0].z),Vector2.ZERO)
	for p in course.points: bounds = bounds.expand(Vector2(p.x,p.z))
	var scale_factor := 132.0/maxf(bounds.size.x,bounds.size.y)
	var offset := Vector2(94,85)-bounds.get_center()*scale_factor
	for p in course.points: route.append(Vector2(p.x,p.z)*scale_factor+offset)
	route.append(route[0])
	draw_polyline(route,Color("61747d"),4,true)
	for i in karts.size():
		var p: Vector3 = karts[i].position
		draw_circle(Vector2(p.x,p.z)*scale_factor+offset,4 if i==0 else 2.5,Color("9de3cc") if i==0 else Color("d1d9dc"))

func background() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.035,0.053,0.071,0.9)
	style.border_color = Color(0.45,0.57,0.61,0.27)
	style.set_border_width_all(1)
	style.set_corner_radius_all(12)
	return style
