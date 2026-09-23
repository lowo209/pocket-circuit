extends RefCounted
## One shared centerline drives road visuals, AI, checkpoints and recovery.
const WIDTH := 13.0
const COUNT := 160
var points := PackedVector3Array()
var length := 0.0

func _init() -> void:
	for i in COUNT:
		var t := TAU * float(i) / COUNT
		points.append(Vector3(66 * cos(t), 0, 46 * sin(t) + 9 * sin(2 * t)))
	for i in COUNT:
		length += points[i].distance_to(points[(i + 1) % COUNT])

func point(index: int) -> Vector3:
	return points[posmod(index, COUNT)]

func forward(index: int) -> Vector3:
	return (point(index + 1) - point(index)).normalized()

func side(index: int) -> Vector3:
	return forward(index).cross(Vector3.UP).normalized()

func nearest(pos: Vector3) -> int:
	var best := 0
	var distance := INF
	for i in COUNT:
		var candidate := pos.distance_squared_to(points[i])
		if candidate < distance:
			distance = candidate
			best = i
	return best
