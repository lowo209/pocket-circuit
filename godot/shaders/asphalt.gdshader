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
	float patch=smoothstep(0.22,0.7,noise(world_pos.xz*0.14));
	float water=wetness*patch;
	ALBEDO=texture(albedo_texture,UV).rgb*mix(0.75,0.38,water);
	ROUGHNESS=mix(0.86,0.09,water);
	SPECULAR=0.4;
	METALLIC=0.0;
	float grain=noise(world_pos.xz*2.0)-0.5;
	vec2 grid=world_pos.xz*0.8;
	vec2 cell=floor(grid);
	float seed=hash(cell);
	vec2 center=vec2(0.25)+vec2(seed,hash(cell+23.4))*0.5;
	vec2 offset=fract(grid)-center;
	float age=fract(TIME*1.15+seed*8.0);
	float radius=length(offset);
	float ring=sin((radius-age*0.42)*100.0)*exp(-abs(radius-age*0.42)*65.0)*(1.0-age);
	float fade=1.0-smoothstep(18.0,40.0,length(VERTEX));
	vec2 ripple=normalize(offset+vec2(0.0001))*ring*water*0.045*fade;
	NORMAL_MAP=vec3(vec2(0.5)+grain*0.01*(1.0-water)+ripple,1.0);
	ALBEDO+=vec3(0.045)*abs(ring)*water*fade;
}
