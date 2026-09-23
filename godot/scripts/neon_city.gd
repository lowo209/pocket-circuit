extends RefCounted
## Original city scenery: dense skylines, elevated crossings and illuminated storefronts.
static func build(w, course, detail) -> void:
	var tones := ["61dce0","dd78cd","a3c5ed","e1bd79"]
	for i in range(0,course.COUNT,5):
		for side in [-1,1]:
			var p: Vector3 = course.point(i)+course.side(i)*(25+float(i%3)*2)*side
			if not detail.reserve(p,12): continue
			var height := 25.0 + float((i*13+side*7)%29)
			var tint: String = tones[posmod(i/5+side,4)]
			var facade := ShaderMaterial.new()
			facade.shader = load("res://shaders/city_facade.gdshader")
			facade.set_shader_parameter("surface_texture",load("res://textures/plaster.png"))
			facade.set_shader_parameter("glass_color",Color(tint))
			facade.set_shader_parameter("building_seed",float(i+side))
			if i%10==0:
				w.cylinder(p+Vector3.UP*height/2,7.3,height,facade,6.5,"CityRoundTower")
				for floor_id in range(6,int(height),6):
					w.cylinder(p+Vector3.UP*floor_id,7.65,0.24,w.mat("334853",0.42),7.65,"TowerBelt")
			else:
				w.box(Vector3(13,height,13),p+Vector3.UP*height/2,facade,true,"CityTower")
				w.box(Vector3(10,8,10),p+Vector3.UP*(height+4),facade,false,"TowerSetback")
				for x in [-6.6,6.6]:
					w.box(Vector3(0.16,height,0.18),p+Vector3(x,height/2,-6.6),w.glowing(tint),false,"TowerLightSpine")
			w.box(Vector3(15,0.4,15),p+Vector3.UP*3.6,w.mat("253b48",0.4),false,"ShopCanopy")
			w.box(Vector3(16,0.24,16),p,w.mat("46565c",0.85,"concrete"),false,"CityFoundation")
			for corner in [-1,1]:
				w.box(Vector3(1.4,1.3,2),p+Vector3(corner*4,height+0.65,0),w.mat("58666b",0.65),false,"RooftopVent")
				w.cylinder(p+Vector3(corner*5,0.7,8.7),0.32,1.4,w.mat("354650"),0.32,"StreetBollard")
			w.box(Vector3(3.4,0.6,0.8),p+Vector3(0,0.45,8.8),w.mat("35444c"),false,"CityBench")
			var facing: Vector3 = (course.point(i)-p).normalized()
			var sign_pos: Vector3 = p+facing*(8.0 if i%10==0 else 10.0)+Vector3.UP*7
			var heading := atan2(facing.x,facing.z)
			var bracket = w.box(Vector3(0.2,0.25,4.0),p+facing*8+Vector3.UP*7,w.mat("35444b",0.65),false,"BillboardBracket")
			bracket.rotation.y = heading
			var board = w.box(Vector3(8,3,0.22),sign_pos,w.mat("142431",0.3),false,"CityBillboard")
			board.rotation.y = heading
			var trim = w.box(Vector3(8.3,0.15,0.27),sign_pos+Vector3.UP*1.6,w.glowing(tint),false,"BillboardTrim")
			trim.rotation.y = heading
			var text = w.sign_text(["NEON\nCITY","VOLT\nMOTORS","NIGHT\nMARKET","CIRCUIT\nCLUB"][posmod(i/5,4)],sign_pos+facing*0.17,46)
			text.billboard = BaseMaterial3D.BILLBOARD_DISABLED
			text.rotation.y = heading
			text.modulate = Color(tint)
			if i%10==0:
				var light := OmniLight3D.new()
				light.name = "NeonStreetWash"
				light.position = course.point(i)+course.side(i)*side*8+Vector3.UP*3
				light.light_color = Color(tint)
				light.light_energy = 1.8
				light.omni_range = 17
				light.distance_fade_enabled = true
				light.distance_fade_begin = 32
				light.distance_fade_length = 15
				w.add_child(light,true)
	# Staggered mid-ground blocks close gaps; placement shares foreground footprints.
	for i in 400:
		var x := -285.0+float(i%20)*30
		var z := -285.0+float(i/20)*30
		var p := Vector3(x,0,z)
		if not detail.reserve(p,12): continue
		var h := 30.0+float((i*17)%65)
		var facade := ShaderMaterial.new()
		facade.shader = load("res://shaders/city_facade.gdshader")
		facade.set_shader_parameter("surface_texture",load("res://textures/plaster.png"))
		facade.set_shader_parameter("glass_color",Color("668da6"))
		facade.set_shader_parameter("building_seed",float(i+100))
		var tower = w.box(Vector3(16,h,16),p+Vector3.UP*(h/2-0.06),facade,false,"CityDistrictTower")
		tower.visibility_range_end = 700
		var roof = w.box(Vector3(12,5,12),p+Vector3.UP*(h+2.44),facade,false,"DistrictRoofSetback")
		roof.visibility_range_end = 700
		if i%3==0:
			var trim = w.box(Vector3(16.1,0.14,16.1),p+Vector3.UP*(h-1),w.glowing(tones[i%4]),false,"DistrictRoofNeon")
			trim.visibility_range_end = 700
	for index in [16,52,91,128]:
		var p: Vector3 = course.point(index)
		var heading := atan2(-course.forward(index).x,-course.forward(index).z)
		var crossing = w.box(Vector3(48,1.1,7),p+Vector3.UP*11,w.mat("263944",0.55),false,"ElevatedCityCrossing")
		crossing.rotation.y = heading
		for z in [-3.5,3.5]:
			var lightstrip = w.box(Vector3(48,0.12,0.16),p+Vector3.UP*11.7+course.forward(index)*z,w.glowing("62d7e2"),false,"CrossingLight")
			lightstrip.rotation.y = heading
		for side in [-1,1]:
			var base: Vector3 = p+course.side(index)*20*side
			if detail.road_distance(base)>12:
				w.box(Vector3(1.4,11.2,1.4),base+Vector3.UP*5.5,w.mat("273943",0.75,"concrete"),true,"CrossingSupport")
	for i in range(0,course.COUNT,2):
		for side in [-1,1]:
			var a: Vector3 = course.point(i)+course.side(i)*8.8*side
			var b: Vector3 = course.point(i+1)+course.side(i+1)*8.8*side
			var strip = w.box(Vector3(0.1,0.06,a.distance_to(b)),(a+b)*0.5+Vector3.UP*0.14,w.glowing("54becb" if side>0 else "b67ac7"),false,"RoadEdgeNeon")
			strip.rotation.y = atan2(-(b-a).x,-(b-a).z)
	# Joined pedestrian verges fill the blank space between track and storefronts.
	for side in [-1,1]:
		var walk := SurfaceTool.new()
		walk.begin(Mesh.PRIMITIVE_TRIANGLES)
		for i in course.COUNT:
			var vertices := [course.point(i)+course.side(i)*8.4*side,course.point(i+1)+course.side(i+1)*8.4*side,course.point(i+1)+course.side(i+1)*14*side,course.point(i)+course.side(i)*14*side]
			for v in [0,1,2,0,2,3]:
				walk.add_vertex(vertices[v]-Vector3.UP*0.04)
		walk.generate_normals()
		var paving = w.mat("3f5059",0.8,"concrete").duplicate()
		paving.cull_mode = BaseMaterial3D.CULL_DISABLED
		w.mesh_object(walk.commit(),Vector3.ZERO,paving,"CitySidewalk")
	for i in range(0,course.COUNT,7):
		for side in [-1,1]:
			var pos: Vector3 = course.point(i)+course.side(i)*15*side
			if not detail.reserve(pos,1.7): continue
			var heading := atan2(-course.forward(i).x,-course.forward(i).z)
			var kiosk = w.box(Vector3(1.6,2.5,1.2),pos+Vector3.UP*1.13,w.mat("1d2c38",0.5),true,"StreetTerminal")
			kiosk.rotation.y = heading
			var panel = w.box(Vector3(0.04,1.25,0.85),pos-course.side(i)*side*0.82+Vector3.UP*1.5,w.glowing("65c9ba" if i%2==0 else "c675c2"),false,"TerminalScreen")
			panel.rotation.y = heading
			w.cylinder(pos+course.forward(i)*2.2+Vector3.UP*0.4,0.3,1,w.mat("344953"),0.3,"LitterBin")
	for index in course.CITY_BOOST_PADS:
		var pad = w.box(Vector3(8,0.012,3.2),course.point(index)+Vector3.UP*0.05,w.mat("173a46",0.3),false,"BoostPad")
		pad.rotation.y = atan2(-course.forward(index).x,-course.forward(index).z)
		for j in [-1,0,1]:
			var stripe = w.box(Vector3(7,0.014,0.22),course.point(index)+course.forward(index)*j+Vector3.UP*0.062,w.glowing("72e2d6"),false,"BoostPadStripe")
			stripe.rotation.y = pad.rotation.y
	var traffic := Node3D.new()
	traffic.name = "SkyTraffic"
	traffic.set_script(load("res://scripts/sky_traffic.gd"))
	traffic.flight_path = course.points
	w.add_child(traffic)
	for i in 18:
		var car := Node3D.new()
		car.name = "AirTaxi"+str(i)
		traffic.add_child(car)
		car.set_meta("phase",float(i)*TAU/18)
		car.set_meta("lane",i%3)
		var hull = w.box(Vector3(1.8,0.55,4.3),Vector3.ZERO,w.mat(tones[i%4],0.28),false,"TaxiBody")
		hull.reparent(car,false)
		var cabin = w.box(Vector3(1.4,0.48,1.8),Vector3(0,0.42,-0.2),w.mat("132a3b",0.18),false,"TaxiCabin")
		cabin.reparent(car,false)
		for side in [-1,1]:
			var thruster = w.box(Vector3(0.35,0.15,1.2),Vector3(side*1.05,-0.25,1.1),w.glowing("72daef"),false,"TaxiThruster")
			thruster.reparent(car,false)
		var tail = w.box(Vector3(1.5,0.12,0.08),Vector3(0,0.05,2.2),w.glowing("ef618c"),false,"TaxiTailLight")
		tail.reparent(car,false)
		for visual in car.get_children(): visual.layers = 2
	traffic.update_traffic(0)
