extends RefCounted
## Track-following opponents use the same kart controller and physics as the player.
var skill := 0.5
var personality := 0

func drive(kart, course, opponents: Array, time: float) -> void:
	var index: int = course.nearest(kart.position)
	var lookahead := 2 + int(absf(kart.speed) / 12)
	var lane := sin(time * 0.3 + personality * 2.0) * 1.2
	# Move to another lane when following a nearby car.
	for other in opponents:
		if other == kart:
			continue
		var relative: Vector3 = other.position - kart.position
		if relative.length() < 9 and relative.dot(-kart.global_transform.basis.z) > 0:
			lane += 2.0 if personality % 2 == 0 else -2.0
	var target: Vector3 = course.point(index + lookahead) + course.side(index + lookahead) * clampf(lane, -3, 3)
	var desired: Vector3 = (target - kart.position).normalized()
	var forward: Vector3 = -kart.global_transform.basis.z
	var angle := forward.signed_angle_to(desired, Vector3.UP)
	kart.steering = clampf(-angle * 2.0, -1, 1)
	var curve: float = absf(course.forward(index).signed_angle_to(course.forward(index + 9), Vector3.UP))
	var pace := lerpf(15.0, 25.0, skill) - curve * lerpf(8.0, 4.0, skill)
	pace += sin(time * 0.7 + personality) * (1.0 - skill)
	kart.throttle = clampf(pace / kart.max_speed, 0.3, 1)
	kart.drift = skill > 0.65 and absf(angle) > 0.25 and absf(angle) < 0.65
	kart.boost_pressed = curve < 0.15 and skill > 0.4 and absf(angle) < 0.12
