shader_type spatial;
render_mode cull_disabled;
uniform vec4 water_color : source_color = vec4(0.1,0.3,0.4,1.0);
varying vec3 world_pos;
void vertex() { world_pos = (MODEL_MATRIX * vec4(VERTEX,1.0)).xyz; }
void fragment() {
	float ripple = sin(world_pos.x * 0.75 + TIME * 0.7) * sin(world_pos.z * 0.52 - TIME * 0.4);
	ALBEDO = water_color.rgb * (0.8 + ripple * 0.12);
	ROUGHNESS = 0.25;
	METALLIC = 0.35;
	NORMAL_MAP = vec3(0.5 + ripple * 0.035,0.5 + cos(world_pos.z + TIME)*0.025,1.0);
}
