extends Node3D
## Flight corridors follow the clear road canyon, above all crossings and gantries.
@export var flight_path := PackedVector3Array()
var elapsed := 0.0
func _process(delta: float) -> void:
	elapsed += delta
	update_traffic(elapsed)

func update_traffic(time: float) -> void:
	if flight_path.is_empty(): return
	for car in get_children():
		var lane: int = car.get_meta("lane",0)
		var phase: float = fposmod(car.get_meta("phase",0.0)/TAU+time*(0.016+lane*0.003),1.0)*flight_path.size()
		var index := int(phase)
		var a := flight_path[index]
		var b := flight_path[(index+1)%flight_path.size()]
		var forward := (b-a).normalized()
		car.position = a.lerp(b,phase-floorf(phase))+Vector3.UP*(19+lane*5)+forward.cross(Vector3.UP)*(lane-1)*3
		car.rotation.y = atan2(-forward.x,-forward.z)
