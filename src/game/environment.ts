import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { TrackId } from '../shared';
import { getTrack } from '../shared';
import { trackSamples } from './simulation';
import { WeatherSystem } from './weather';

export type GraphicsQuality = 'high' | 'balanced';

/** One inexpensive HDR panorama serves the sky and the prefiltered paint/metal reflections. */
function makeSky(track: TrackId): THREE.DataTexture {
  const width = 512,
    height = 256;
  const pixels = new Float32Array(width * height * 4);
  const night = track === 'midnight',
    desert = track === 'canyon';
  const zenith = new THREE.Color(night ? '#091226' : desert ? '#708d9b' : '#428db4');
  const horizon = new THREE.Color(night ? '#3d4169' : desert ? '#f7c499' : '#ffdbad');
  const ground = new THREE.Color(night ? '#10182b' : desert ? '#875b48' : '#73aca9');
  const sun = new THREE.Vector3(-0.46, night ? 0.6 : 0.31, -0.74).normalize();
  const color = new THREE.Color();
  for (let y = 0; y < height; y++) {
    const elevation = (y / (height - 1) - 0.5) * Math.PI;
    const sy = Math.sin(elevation),
      radius = Math.cos(elevation);
    for (let x = 0; x < width; x++) {
      const azimuth = (x / width - 0.5) * Math.PI * 2;
      const sx = Math.cos(azimuth) * radius,
        sz = Math.sin(azimuth) * radius;
      if (sy >= 0) color.copy(horizon).lerp(zenith, Math.pow(sy, 0.5));
      else color.copy(horizon).lerp(ground, Math.min(1, -sy * 4));
      const dot = Math.max(0, sx * sun.x + sy * sun.y + sz * sun.z);
      const halo = Math.pow(dot, night ? 120 : 38) * (night ? 0.12 : 0.32);
      const disc = Math.pow(dot, night ? 2800 : 1400) * (night ? 2 : 7);
      color.r += disc + halo;
      color.g += disc * (night ? 0.92 : 0.71) + halo * 0.56;
      color.b += disc * (night ? 0.78 : 0.35) + halo * 0.23;
      if (night && sy > 0.2) {
        const noise = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        if (noise - Math.floor(noise) > 0.9985) color.addScalar(0.4);
      }
      // Distant luminous skyline gives night paint readable cyan/purple highlights.
      if (night && sy > -0.06 && sy < 0.12) {
        const bar = Math.pow(Math.max(0, Math.sin(azimuth * 11 + 0.5)), 32);
        const light = bar * Math.exp(-Math.abs(sy) * 22) * 0.65;
        color.r += light * 0.45;
        color.g += light * 0.6;
        color.b += light;
      }
      const i = (y * width + x) * 4;
      pixels[i] = color.r;
      pixels[i + 1] = color.g;
      pixels[i + 2] = color.b;
      pixels[i + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function surfaceNoise(): THREE.DataTexture {
  const size = 128,
    data = new Uint8Array(size * size * 4);
  let seed = 8329;
  for (let i = 0; i < size * size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 150 + (seed % 70);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function roadReflectionGeometry(trackId: TrackId): THREE.BufferGeometry {
  const points = trackSamples(trackId),
    width = getTrack(trackId).width;
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= points.length; i++) {
    const point = points[i % points.length];
    for (const sign of [-1, 1]) {
      vertices.push(
        point.x + Math.cos(point.heading) * width * 0.495 * sign,
        -point.z + Math.sin(point.heading) * width * 0.495 * sign,
        0,
      );
    }
    if (i < points.length) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const reflectionShader = {
  name: 'PocketSurfaceReflection',
  uniforms: {
    color: { value: new THREE.Color('#397884') },
    tDiffuse: { value: null },
    textureMatrix: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uWater: { value: 0 },
    uTexel: { value: 1 / 768 },
  },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec4 vProjected;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vProjected = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uWater;
    uniform float uTexel;
    varying vec4 vProjected;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){
      #include <logdepthbuf_fragment>
      vec2 p=vWorld.xz;
      float waves=sin(p.x*.22+uTime*.8)+sin(p.y*.34-uTime*.65);
      vec2 uv=vProjected.xy/vProjected.w;
      uv += vec2(waves,sin(p.x*.19+p.y*.27+uTime)) * mix(.00035,.0035,uWater);
      vec2 blur=vec2(uTexel*1.5,0.0);
      vec3 reflected=texture2D(tDiffuse,uv).rgb*.4;
      reflected+=(texture2D(tDiffuse,uv+blur).rgb+texture2D(tDiffuse,uv-blur).rgb)*.15;
      reflected+=(texture2D(tDiffuse,uv+blur.yx).rgb+texture2D(tDiffuse,uv-blur.yx).rgb)*.15;
      float fresnel=pow(1.0-clamp(normalize(cameraPosition-vWorld).y,0.0,1.0),2.0);
      float puddle=smoothstep(.32,.69,noise(p*.19)+noise(p*.7)*.12);
      float grain=hash(p*47.0)*.018;
      vec3 sea=mix(color,reflected,.30+fresnel*.45)+vec3(.04,.065,.06)*pow(max(0.0,waves*.5),12.0);
      vec3 wet=reflected*.8+vec3(grain);
      float opacity=mix(.10,.58,puddle)*(.6+fresnel*.4);
      gl_FragColor=vec4(mix(wet,sea,uWater),mix(opacity,1.0,uWater));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

/** Owns only its sky, textures, reflective surface and weather; never world scenery. */
export class RaceEnvironment {
  private sky: THREE.DataTexture;
  private pmrem: THREE.WebGLRenderTarget;
  private reflector: Reflector | null = null;
  private weather: WeatherSystem;
  private textures: THREE.Texture[] = [];
  private quality: GraphicsQuality = 'high';
  private surface: THREE.Group = new THREE.Group();
  private originalMaterials: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }[] =
    [];
  private roadMaterials: THREE.Material[] = [];
  private disposed = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    world: THREE.Group,
    private trackId: TrackId,
  ) {
    this.surface.name = 'environment-surfaces';
    scene.add(this.surface);
    this.sky = makeSky(trackId);
    const generator = new THREE.PMREMGenerator(renderer);
    this.pmrem = generator.fromEquirectangular(this.sky);
    generator.dispose();
    scene.background = this.sky;
    scene.environment = this.pmrem.texture;
    scene.environmentIntensity = trackId === 'midnight' ? 1.3 : 0.65;
    scene.backgroundIntensity = trackId === 'midnight' ? 0.85 : 1;
    scene.fog = new THREE.Fog(
      trackId === 'midnight' ? '#2b3554' : trackId === 'canyon' ? '#dbc0a7' : '#d7d6ba',
      trackId === 'midnight' ? 125 : 240,
      trackId === 'midnight' ? 460 : 760,
    );
    this.upgradeRoad(world);
    if (trackId !== 'canyon') this.addReflection();
    this.weather = new WeatherSystem(scene, trackId, this.quality);
  }

  private upgradeRoad(world: THREE.Group) {
    const noise = surfaceNoise();
    this.textures.push(noise);
    world.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
      const pos = object.geometry.getAttribute('position');
      if (!pos || pos.count < 500 || Math.abs(pos.getY(0) - 0.035) > 0.001) return;
      // UVs in real road meters keep asphalt texture consistent through every turn.
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = pos.getX(i) * 0.28;
        uv[i * 2 + 1] = pos.getZ(i) * 0.28;
      }
      object.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const night = this.trackId === 'midnight';
      const material = new THREE.MeshPhysicalMaterial({
        color: night ? '#25354c' : this.trackId === 'canyon' ? '#745346' : '#525d61',
        roughness: night ? 0.3 : 0.84,
        metalness: night ? 0.15 : 0.04,
        clearcoat: night ? 0.85 : 0.08,
        clearcoatRoughness: night ? 0.2 : 0.75,
        bumpMap: noise,
        bumpScale: 0.035,
        roughnessMap: noise,
        envMapIntensity: night ? 1.2 : 0.45,
        side: THREE.DoubleSide,
      });
      this.originalMaterials.push({ mesh: object, material: object.material });
      this.roadMaterials.push(material);
      object.material = material;
      object.name = 'asphalt';
    });
  }

  private addReflection() {
    const water = this.trackId === 'coast';
    const geometry = water
      ? new THREE.PlaneGeometry(2300, 2300)
      : roadReflectionGeometry(this.trackId);
    const reflector = new Reflector(geometry, {
      textureWidth: 768,
      textureHeight: 768,
      clipBias: 0.003,
      multisample: 0,
      shader: reflectionShader,
      color: water ? '#267d87' : '#495870',
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = water ? -0.69 : 0.044;
    reflector.name = water ? 'reflective-ocean' : 'wet-road-reflections';
    (reflector.material as THREE.ShaderMaterial).uniforms.uWater.value = water ? 1 : 0;
    (reflector.material as THREE.ShaderMaterial).transparent = !water;
    (reflector.material as THREE.ShaderMaterial).depthWrite = water;
    (reflector.material as THREE.ShaderMaterial).side = THREE.DoubleSide;
    reflector.renderOrder = water ? 0 : 1;
    this.reflector = reflector;
    this.surface.add(reflector);
  }

  setQuality(quality: GraphicsQuality) {
    this.quality = quality;
    const size = quality === 'high' ? 768 : 384;
    this.reflector?.getRenderTarget().setSize(size, size);
    if (this.reflector)
      (this.reflector.material as THREE.ShaderMaterial).uniforms.uTexel.value = 1 / size;
    this.weather.setQuality(quality);
  }

  update({
    dt,
    time,
    anchor,
    speed,
  }: {
    dt: number;
    time: number;
    anchor: THREE.Vector3;
    speed: number;
  }) {
    if (this.disposed) return;
    if (this.reflector)
      (this.reflector.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    this.weather.update(dt, time, anchor, speed);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.weather.dispose();
    this.reflector?.geometry.dispose();
    this.reflector?.dispose();
    this.scene.remove(this.surface);
    this.surface.clear();
    for (const { mesh, material } of this.originalMaterials) mesh.material = material;
    this.roadMaterials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    if (this.scene.environment === this.pmrem.texture) this.scene.environment = null;
    if (this.scene.background === this.sky) this.scene.background = null;
    this.pmrem.dispose();
    this.sky.dispose();
  }
}
