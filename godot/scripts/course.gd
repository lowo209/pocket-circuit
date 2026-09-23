extends RefCounted
## One shared centerline drives road visuals, AI, checkpoints and recovery.
const WIDTH := 15.0
const COUNT := 160
const TITLES := ["Sunset Bay", "Dust Valley", "Neon Harbor"]
const ROUTES := [
	[Vector2(0,0),Vector2(0,90),Vector2(35,155),Vector2(105,178),Vector2(163,146),Vector2(152,93),Vector2(202,54),Vector2(233,-10),Vector2(200,-86),Vector2(144,-130),Vector2(87,-111),Vector2(30,-158),Vector2(-44,-137),Vector2(-65,-94),Vector2(-35,-60),Vector2(0,-45)],
	[Vector2(0,0),Vector2(0,100),Vector2(40,150),Vector2(95,140),Vector2(108,90),Vector2(70,42),Vector2(92,5),Vector2(160,20),Vector2(198,75),Vector2(242,64),Vector2(270,5),Vector2(235,-52),Vector2(150,-56),Vector2(140,-96),Vector2(171,-119),Vector2(190,-145),Vector2(173,-172),Vector2(150,-188),Vector2(65,-174),Vector2(36,-119),Vector2(-20,-132),Vector2(-60,-114),Vector2(-76,-78),Vector2(-55,-45),Vector2(-20,-36)],
	[Vector2(0,0),Vector2(0,75),Vector2(25,115),Vector2(75,115),Vector2(100,150),Vector2(155,150),Vector2(176,105),Vector2(154,78),Vector2(153,55),Vector2(185,28),Vector2(242,28),Vector2(265,-12),Vector2(239,-62),Vector2(175,-62),Vector2(149,-99),Vector2(179,-139),Vector2(157,-178),Vector2(90,-178),Vector2(63,-137),Vector2(17,-137),Vector2(-20,-139),Vector2(-57,-119),Vector2(-70,-82),Vector2(-48,-49),Vector2(-19,-35)]
]
var track_id := 0
var points := PackedVector3Array()
var length := 0.0

func _init(selected := 0) -> void:
	track_id = clampi(selected, 0, 2)
	var route: Array = ROUTES[track_id]
	var curve := Curve3D.new()
	curve.bake_interval = 0.5
	for i in route.size() + 1:
		var current: Vector2 = route[i % route.size()]
		var previous: Vector2 = route[posmod(i - 1, route.size())]
		var next: Vector2 = route[(i + 1) % route.size()]
		var tangent := (next - previous) / 6.0
		curve.add_point(Vector3(current.x - 85, 0, current.y) * 0.72, Vector3(-tangent.x, 0, -tangent.y) * 0.72, Vector3(tangent.x, 0, tangent.y) * 0.72)
	for i in COUNT:
		points.append(curve.sample_baked(curve.get_baked_length() * float(i) / COUNT, true))
	for i in COUNT:
		length += points[i].distance_to(points[(i + 1) % COUNT])

func hub_position() -> Vector3:
	return point(0) + side(0) * 20 - forward(0) * 6

func point(index: int) -> Vector3:
	return points[posmod(index, COUNT)]

func forward(index: int) -> Vector3:
	return (point(index + 1) - point(index)).normalized()

func side(index: int) -> Vector3:
	# Centered tangent gives both adjoining strips exactly the same edge vertex.
	return (point(index + 1) - point(index - 1)).normalized().cross(Vector3.UP).normalized()

func nearest(pos: Vector3) -> int:
	var best := 0
	var distance := INF
	for i in COUNT:
		var candidate := pos.distance_squared_to(points[i])
		if candidate < distance:
			distance = candidate
			best = i
	return best
