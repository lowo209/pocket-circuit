shader_type spatial;
render_mode cull_disabled;
uniform sampler2D albedo_texture : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float wetness : hint_range(0.0,1.0) = 0.0;
varying vec3 world_pos;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
	vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
	return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
void vertex() { world_pos=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz; }
void fragment() {
	float patch=smoothstep(0.3,0.75,noise(world_pos.xz*0.14));
	float water=wetness*patch;
	ALBEDO=texture(albedo_texture,UV).rgb*mix(0.75,0.38,water);
	ROUGHNESS=mix(0.92,0.16,water);
	SPECULAR=0.4;
	METALLIC=0.0;
	float grain=noise(world_pos.xz*2.0)-0.5;
	NORMAL_MAP=vec3(0.5+grain*0.012*(1.0-water),0.5+grain*0.008*(1.0-water),1.0);
}
