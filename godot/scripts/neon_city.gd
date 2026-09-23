extends RefCounted
## Original city scenery: dense skylines, elevated crossings and illuminated storefronts.
static func build(w, course) -> void:
	var tones := ["61dce0","dd78cd","a3c5ed","e1bd79"]
	for i in range(0,course.COUNT,5):
		for side in [-1,1]:
			var p: Vector3 = course.point(i)+course.side(i)*(25+float(i%3)*2)*side
			if p.distance_to(course.hub_position()) < 25: continue
			if p.distance_to(course.point(course.nearest(p))) < 20: continue
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
			var facing: Vector3 = (course.point(i)-p).normalized()
			var sign_pos: Vector3 = p+facing*7.8+Vector3.UP*7
			var heading := atan2(facing.x,facing.z)
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
	# Distant skyline fills the horizon without full window geometry.
	for i in 36:
		var angle := TAU*float(i)/36
		var p := Vector3(cos(angle)*210,0,sin(angle)*190)
		var h := 35.0+float((i*17)%48)
		var facade := ShaderMaterial.new()
		facade.shader = load("res://shaders/city_facade.gdshader")
		facade.set_shader_parameter("surface_texture",load("res://textures/plaster.png"))
		facade.set_shader_parameter("glass_color",Color("668da6"))
		facade.set_shader_parameter("building_seed",float(i+100))
		var tower = w.box(Vector3(15,h,15),p+Vector3.UP*h/2,facade,false,"DistantSkyline")
		tower.visibility_range_end = 430
	for index in [16,52,91,128]:
		var p: Vector3 = course.point(index)
		var heading := atan2(-course.forward(index).x,-course.forward(index).z)
		var crossing = w.box(Vector3(48,1.1,7),p+Vector3.UP*11,w.mat("263944",0.55),false,"ElevatedCityCrossing")
		crossing.rotation.y = heading
		for z in [-3.5,3.5]:
			var lightstrip = w.box(Vector3(48,0.12,0.16),p+Vector3.UP*11.7+course.forward(index)*z,w.glowing("62d7e2"),false,"CrossingLight")
			lightstrip.rotation.y = heading
		for side in [-1,1]:
			w.box(Vector3(1.4,11,1.4),p+course.side(index)*16*side+Vector3.UP*5.5,w.mat("273943",0.75,"concrete"),true,"CrossingSupport")
	for i in range(0,course.COUNT,2):
		for side in [-1,1]:
			var a: Vector3 = course.point(i)+course.side(i)*8.8*side
			var b: Vector3 = course.point(i+1)+course.side(i+1)*8.8*side
			var strip = w.box(Vector3(0.1,0.06,a.distance_to(b)),(a+b)*0.5+Vector3.UP*0.14,w.glowing("54becb" if side>0 else "b67ac7"),false,"RoadEdgeNeon")
			strip.rotation.y = atan2(-(b-a).x,-(b-a).z)
	for index in course.CITY_BOOST_PADS:
		var pad = w.box(Vector3(8,0.012,3.2),course.point(index)+Vector3.UP*0.05,w.mat("173a46",0.3),false,"BoostPad")
		pad.rotation.y = atan2(-course.forward(index).x,-course.forward(index).z)
		for j in [-1,0,1]:
			var stripe = w.box(Vector3(7,0.014,0.22),course.point(index)+course.forward(index)*j+Vector3.UP*0.062,w.glowing("72e2d6"),false,"BoostPadStripe")
			stripe.rotation.y = pad.rotation.y
