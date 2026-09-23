shader_type spatial;
render_mode cull_disabled;
uniform vec4 water_color : source_color = vec4(0.1,0.3,0.4,1.0);
varying vec3 world_pos;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
	vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
	return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
void vertex() { world_pos = (MODEL_MATRIX * vec4(VERTEX,1.0)).xyz; }
void fragment() {
	vec2 p=world_pos.xz;
	float a=noise(p*0.4+vec2(TIME*0.07,0.0))-0.5;
	float b=noise(p*0.7+vec2(9.2,-TIME*0.09))-0.5;
	float filter_strength=1.0/(1.0+length(fwidth(p))*0.5);
	ALBEDO = water_color.rgb * 0.6;
	ROUGHNESS = 0.19;
	METALLIC = 0.0;
	SPECULAR = 0.5;
	NORMAL_MAP = vec3(0.5+a*0.12*filter_strength,0.5+b*0.12*filter_strength,1.0);
}
