shader_type spatial;
uniform sampler2D stone_texture : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
varying vec3 p;
varying vec3 n;
void vertex() { p=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz; n=normalize(MODEL_NORMAL_MATRIX*NORMAL); }
void fragment() {
	vec2 face=abs(n.x)>0.5?p.zy:p.xy;
	if(abs(n.y)>0.5) face=p.xz;
	vec2 courses=face/vec2(2.4,0.9);
	courses.x+=mod(floor(courses.y),2.0)*0.5;
	vec2 cell=fract(courses);
	float seam=smoothstep(0.0,0.025,min(cell.x,1.0-cell.x))*smoothstep(0.0,0.045,min(cell.y,1.0-cell.y));
	vec3 grain=texture(stone_texture,face*0.13).rgb;
	ALBEDO=grain*vec3(0.86,0.83,0.76)*mix(0.55,1.0,seam);
	ROUGHNESS=0.93;
}
