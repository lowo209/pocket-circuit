extends RefCounted
## Ordered gates prevent skipping laps. Simulation contains no UI or input polling.
const GATES := 20
const LAPS := 3
var active := false
var countdown := 3.0
var elapsed := 0.0
var drivers: Array[Dictionary] = []
var finish_order: Array[int] = []

func begin(count: int) -> void:
	active = true
	countdown = 3
	elapsed = 0
	drivers.clear()
	finish_order.clear()
	for i in count:
		drivers.append({"gate": 0, "lap": 0, "last_lap": 0.0, "laps": [], "finished": false})

func tick(delta: float) -> bool:
	if not active:
		return false
	if countdown > 0:
		countdown -= delta
		return false
	elapsed += delta
	return true

func check_gate(id: int, pos: Vector3, course, direction: Vector3) -> void:
	var driver := drivers[id]
	if driver.finished:
		return
	var next: int = driver.gate % GATES
	var index: int = next * course.COUNT / GATES
	if pos.distance_to(course.point(index)) > 9.0 or direction.dot(course.forward(index)) < 0.1:
		return
	driver.gate += 1
	if next == 0 and driver.gate > 1:
		driver.lap += 1
		driver.laps.append(elapsed - driver.last_lap)
		driver.last_lap = elapsed
		if driver.lap >= LAPS:
			driver.finished = true
			finish_order.append(id)

func place(id: int, karts: Array, course) -> int:
	if id in finish_order:
		return finish_order.find(id) + 1
	var result := finish_order.size() + 1
	var gate: int = drivers[id].gate
	var target: Vector3 = course.point((gate % GATES) * course.COUNT / GATES)
	for other in drivers.size():
		if other == id or drivers[other].finished:
			continue
		if drivers[other].gate > gate:
			result += 1
		elif drivers[other].gate == gate and karts[other].position.distance_to(target) < karts[id].position.distance_to(target):
			result += 1
	return result
