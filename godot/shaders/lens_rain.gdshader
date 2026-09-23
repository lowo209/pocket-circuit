shader_type canvas_item;
render_mode unshaded;
uniform sampler2D scene_texture : hint_screen_texture, repeat_disable, filter_linear;
uniform float drop_count = 20.0;
float hash(float p) { return fract(sin(p*127.1)*43758.5453); }
void fragment() {
	vec2 aspect=vec2(SCREEN_PIXEL_SIZE.y/SCREEN_PIXEL_SIZE.x,1.0);
	vec2 distortion=vec2(0.0);
	float mask=0.0;
	float highlight=0.0;
	for(int i=0;i<24;i++) {
		float n=float(i);
		float enabled=step(n+0.5,drop_count);
		float age=fract(TIME*(0.028+hash(n+5.0)*0.025)+hash(n+2.0));
		vec2 center=vec2(0.03+hash(n+1.0)*0.94,age*1.2-0.1);
		float radius=0.007+hash(n+30.0)*0.009;
		vec2 d=(SCREEN_UV-center)*aspect/vec2(radius,radius*1.55);
		float r=length(d);
		float body=(1.0-smoothstep(0.76,1.0,r))*enabled;
		distortion+=d*radius*0.18*body/aspect;
		mask=max(mask,body*0.85);
		highlight+=pow(max(0.0,1.0-abs(r-0.77)*14.0),2.0)*body*0.06;
	}
	vec3 scene=texture(scene_texture,SCREEN_UV+distortion).rgb;
	COLOR=vec4(scene+highlight,mask);
}
