shader_type spatial;
uniform sampler2D surface_texture : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec4 glass_color : source_color = vec4(0.12,0.62,0.74,1.0);
uniform float building_seed = 0.0;
varying vec3 position_world;
varying vec3 normal_world;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))+building_seed)*43758.5453); }
void vertex() {
	position_world=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;
	normal_world=normalize(MODEL_NORMAL_MATRIX*NORMAL);
}
void fragment() {
	vec2 face=abs(normal_world.x)>0.5 ? position_world.zy : position_world.xy;
	vec2 grid=face/vec2(2.3,3.0);
	vec2 cell=fract(grid);
	float window=smoothstep(0.13,0.17,cell.x)*(1.0-smoothstep(0.78,0.82,cell.x));
	window*=smoothstep(0.19,0.23,cell.y)*(1.0-smoothstep(0.67,0.71,cell.y));
	window*=1.0-step(0.5,abs(normal_world.y));
	float lit=step(0.26,hash(floor(grid)));
	vec3 masonry=texture(surface_texture,face*0.14).rgb*vec3(0.17,0.22,0.27);
	ALBEDO=mix(masonry,vec3(0.035,0.075,0.10),window);
	EMISSION=glass_color.rgb*window*lit*(0.65+0.45*hash(floor(grid)+7.0));
	ROUGHNESS=mix(0.78,0.2,window);
	METALLIC=mix(0.15,0.25,window);
}
