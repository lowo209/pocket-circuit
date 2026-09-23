shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never;
void vertex() {
	MODELVIEW_MATRIX=VIEW_MATRIX*mat4(INV_VIEW_MATRIX[0],INV_VIEW_MATRIX[1],INV_VIEW_MATRIX[2],MODEL_MATRIX[3]);
}
void fragment() {
	float r=length((UV-0.5)*2.0);
	ALBEDO=vec3(0.65,0.48,0.29);
	ALPHA=(1.0-smoothstep(0.0,1.0,r))*0.055;
}
