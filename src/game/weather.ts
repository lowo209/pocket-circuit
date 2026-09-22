import * as THREE from 'three';
import { getTrack } from '../shared';
import type { TrackId } from '../shared';
import { sampleTrack, trackLength } from './simulation';

type Quality = 'high' | 'balanced';

const RAIN_COUNT = 1800;
const SPLASH_COUNT = 1000;
const AIR_COUNT = 240;

function seeded(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const outputColor = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/** Weather is visual only. All animation uses the shared race clock, never gameplay RNG. */
export class WeatherSystem {
  private readonly root = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly uniforms = {
    uTime: { value: 0 },
    uAnchor: { value: new THREE.Vector3() },
    uSpeed: { value: 0 },
    uMotion: { value: 1 },
  };
  private cloudTexture?: THREE.CanvasTexture;
  private precipitation?: THREE.BufferGeometry;
  private splashes?: THREE.InstancedBufferGeometry;
  private clouds?: THREE.InstancedBufferGeometry;
  private quality: Quality;
  private reducedMotion = false;
  private readonly motionQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : undefined;
  private readonly onMotionChange = () => {
    this.reducedMotion = this.motionQuery?.matches ?? false;
    this.uniforms.uMotion.value = this.reducedMotion ? 0.25 : 1;
    this.setQuality(this.quality);
  };

  constructor(
    scene: THREE.Scene,
    private readonly trackId: TrackId,
    quality: Quality,
  ) {
    this.quality = quality;
    this.root.name = `weather-${trackId}`;
    scene.add(this.root);
    if (trackId === 'midnight') {
      this.createRain();
      this.createSplashes();
    } else {
      this.createClouds();
      this.createAir();
    }
    this.motionQuery?.addEventListener('change', this.onMotionChange);
    this.onMotionChange();
  }

  update(_dt: number, time: number, anchor: THREE.Vector3, speed: number): void {
    this.uniforms.uTime.value = Number.isFinite(time) ? Math.max(0, time) : 0;
    this.uniforms.uAnchor.value.copy(anchor);
    this.uniforms.uSpeed.value = Math.min(Math.abs(speed) / 90, 1);
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    const factor = this.reducedMotion ? 0.25 : quality === 'high' ? 1 : 0.52;
    if (this.precipitation) {
      const count = this.trackId === 'midnight' ? RAIN_COUNT * 2 : AIR_COUNT;
      const visible = Math.floor(count * factor);
      this.precipitation.setDrawRange(
        0,
        this.trackId === 'midnight' ? visible - (visible % 2) : visible,
      );
    }
    if (this.splashes) this.splashes.instanceCount = Math.floor(SPLASH_COUNT * factor);
    if (this.clouds) this.clouds.instanceCount = quality === 'high' ? 15 : 10;
  }

  dispose(): void {
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.cloudTexture?.dispose();
    this.root.clear();
  }

  private material(parameters: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      forceSinglePass: true,
      ...parameters,
      uniforms: { ...this.uniforms, ...parameters.uniforms },
    });
    this.materials.push(material);
    return material;
  }

  private createRain(): void {
    const random = seeded(934);
    const positions = new Float32Array(RAIN_COUNT * 6);
    const seeds = new Float32Array(RAIN_COUNT * 4);
    const ends = new Float32Array(RAIN_COUNT * 2);
    for (let i = 0; i < RAIN_COUNT; i++) {
      const x = random() * 104;
      const y = random() * 32;
      const z = random() * 104;
      const phase = random();
      const strength = random();
      for (let end = 0; end < 2; end++) {
        const vertex = i * 2 + end;
        positions.set([x, y, z], vertex * 3);
        seeds.set([phase, strength], vertex * 2);
        ends[vertex] = end;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.geometries.push(geometry);
    this.precipitation = geometry;
    const material = this.material({
      uniforms: { uRainColor: { value: new THREE.Color('#bdd8ff') } },
      vertexShader: `
        uniform float uTime;
        uniform vec3 uAnchor;
        attribute vec2 aSeed;
        attribute float aEnd;
        varying float vAlpha;
        void main() {
          float fallSpeed = 20.0 + aSeed.y * 9.0;
          float gust = 1.6 + sin(uTime * 0.19) * 0.6;
          vec3 p = position;
          p.x = mod(p.x + uTime * gust - uAnchor.x + 52.0, 104.0) - 52.0 + uAnchor.x;
          p.z = mod(p.z + uTime * 0.8 - uAnchor.z + 52.0, 104.0) - 52.0 + uAnchor.z;
          p.y = mod(p.y - uTime * fallSpeed, 32.0) + 0.15;
          float streak = 0.8 + aSeed.y * 0.75;
          p += vec3(-0.075 * gust, 1.0, -0.04) * streak * aEnd;
          float distanceFade = 1.0 - smoothstep(32.0, 52.0, length(p.xz - uAnchor.xz));
          float floorFade = smoothstep(0.15, 1.1, p.y);
          vAlpha = (0.17 + aSeed.y * 0.22) * distanceFade * floorFade * mix(1.0, 0.24, aEnd);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uRainColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uRainColor, vAlpha);
          ${outputColor}
        }
      `,
    });
    const rain = new THREE.LineSegments(geometry, material);
    rain.name = 'wind-driven-rain';
    rain.frustumCulled = false;
    rain.renderOrder = 6;
    this.root.add(rain);
  }

  private createSplashes(): void {
    const random = seeded(27531);
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.attributes = plane.attributes;
    const offsets = new Float32Array(SPLASH_COUNT * 3);
    const seeds = new Float32Array(SPLASH_COUNT * 2);
    const width = getTrack(this.trackId).width;
    const length = trackLength(this.trackId);
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const point = sampleTrack(this.trackId, random() * length);
      const lateral = (random() - 0.5) * (width - 1.4);
      offsets.set(
        [
          point.x + Math.cos(point.heading) * lateral,
          0.077,
          point.z - Math.sin(point.heading) * lateral,
        ],
        i * 3,
      );
      seeds.set([random(), random()], i * 2);
    }
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2));
    geometry.instanceCount = SPLASH_COUNT;
    this.geometries.push(geometry);
    this.splashes = geometry;
    const material = this.material({
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        uniform vec3 uAnchor;
        attribute vec3 aOffset;
        attribute vec2 aSeed;
        varying vec2 vUv;
        varying float vAge;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vAge = fract(uTime * (0.92 + aSeed.y * 0.5) + aSeed.x);
          float size = (0.18 + vAge * 0.88) * (0.75 + aSeed.y * 0.55);
          vec3 p = aOffset + vec3(position.x * size, 0.0, position.y * size);
          vAlpha = (1.0 - vAge) * (1.0 - smoothstep(28.0, 62.0, length(aOffset.xz - uAnchor.xz)));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vAge;
        varying float vAlpha;
        void main() {
          float radius = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.61, 0.76, radius) * (1.0 - smoothstep(0.83, 0.99, radius));
          float center = (1.0 - smoothstep(0.0, 0.24, radius)) * (1.0 - smoothstep(0.0, 0.2, vAge));
          float alpha = (ring * 0.34 + center * 0.4) * vAlpha;
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(vec3(0.48, 0.72, 1.0), alpha);
          ${outputColor}
        }
      `,
    });
    const splashes = new THREE.Mesh(geometry, material);
    splashes.name = 'rain-road-ripples';
    splashes.frustumCulled = false;
    splashes.renderOrder = 4;
    this.root.add(splashes);
  }

  private createAir(): void {
    const canyon = this.trackId === 'canyon';
    const random = seeded(canyon ? 243 : 729);
    const positions = new Float32Array(AIR_COUNT * 3);
    const seeds = new Float32Array(AIR_COUNT * 2);
    for (let i = 0; i < AIR_COUNT; i++) {
      positions.set([random() * 100, random(), random() * 100], i * 3);
      seeds.set([random(), random()], i * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 2));
    this.geometries.push(geometry);
    this.precipitation = geometry;
    const material = this.material({
      uniforms: {
        uDust: { value: canyon ? 1 : 0 },
        uColor: { value: new THREE.Color(canyon ? '#ebba86' : '#fff4cb') },
      },
      vertexShader: `
        uniform float uTime;
        uniform vec3 uAnchor;
        uniform float uSpeed;
        uniform float uMotion;
        uniform float uDust;
        attribute vec2 aSeed;
        varying float vAlpha;
        varying float vDust;
        void main() {
          float t = uTime * mix(0.25, 1.0, uMotion);
          float gust = 0.5 + 0.5 * sin(t * 0.38 + aSeed.x * 2.0);
          vec3 p = position;
          p.x = mod(p.x + t * mix(0.8, 3.6, uDust) - uAnchor.x + 50.0, 100.0) - 50.0 + uAnchor.x;
          p.z = mod(p.z + sin(t * 0.17 + aSeed.x * 6.28) * 3.0 - uAnchor.z + 50.0, 100.0) - 50.0 + uAnchor.z;
          p.y = mix(0.55 + position.y * 10.0, 0.18 + position.y * 3.6, uDust);
          p.y += sin(t * 0.7 + aSeed.y * 6.28) * mix(0.4, 0.15, uDust);
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float size = mix(0.045 + aSeed.y * 0.04, 0.5 + aSeed.y * 1.1, uDust);
          gl_PointSize = clamp(size * 450.0 / max(1.0, -mvPosition.z), 1.0, mix(4.0, 60.0, uDust));
          float edge = 1.0 - smoothstep(30.0, 48.0, length(p.xz - uAnchor.xz));
          float pulse = 0.45 + 0.55 * sin(t * 0.9 + aSeed.x * 6.28) * sin(t * 0.9 + aSeed.x * 6.28);
          vAlpha = edge * mix(0.24 * pulse, (0.09 + gust * 0.1) * (0.85 + uSpeed * 0.15), uDust);
          vDust = uDust;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        varying float vDust;
        void main() {
          vec2 delta = gl_PointCoord - 0.5;
          float radius = length(delta * vec2(1.0, mix(1.0, 1.35, vDust))) * 2.0;
          float soft = exp(-radius * radius * 4.5) * (1.0 - smoothstep(0.65, 1.0, radius));
          float alpha = vAlpha * soft;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(uColor, alpha);
          ${outputColor}
        }
      `,
    });
    const air = new THREE.Points(geometry, material);
    air.name = canyon ? 'canyon-dust-gusts' : 'coastal-air-motes';
    air.frustumCulled = false;
    air.renderOrder = 5;
    this.root.add(air);
  }

  private createClouds(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return;
    const random = seeded(6301);
    // Overlapping feathered lobes give the cloud a silhouette without a rectangular billboard edge.
    for (let i = 0; i < 19; i++) {
      const x = 52 + random() * 152;
      const y = 47 + random() * 36;
      const radius = 19 + random() * 32;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(255,255,255,0.7)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.48)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    this.cloudTexture = new THREE.CanvasTexture(canvas);
    const plane = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = plane.index;
    geometry.attributes = plane.attributes;
    const offsets = new Float32Array(15 * 3);
    const sizes = new Float32Array(15 * 3);
    for (let i = 0; i < 15; i++) {
      const angle = (i / 15) * Math.PI * 2;
      const distance = 250 + random() * 290;
      offsets.set(
        [80 + Math.cos(angle) * distance, 72 + random() * 80, Math.sin(angle) * distance],
        i * 3,
      );
      sizes.set([80 + random() * 95, 29 + random() * 30, random()], i * 3);
    }
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 3));
    geometry.instanceCount = 15;
    this.geometries.push(geometry);
    this.clouds = geometry;
    const canyon = this.trackId === 'canyon';
    const material = this.material({
      uniforms: {
        uMap: { value: this.cloudTexture },
        uTop: { value: new THREE.Color(canyon ? '#ffe2ca' : '#fff6e4') },
        uBase: { value: new THREE.Color(canyon ? '#b98586' : '#b9d2d7') },
      },
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float uTime;
        uniform float uMotion;
        attribute vec3 aOffset;
        attribute vec3 aSize;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          vUv = uv;
          vec3 center = aOffset;
          center.x = mod(center.x + uTime * 0.65 * uMotion + 600.0, 1200.0) - 600.0;
          center.z += sin(uTime * 0.007 + aSize.z * 6.28) * 10.0;
          vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
          mvPosition.xy += position.xy * aSize.xy;
          gl_Position = projectionMatrix * mvPosition;
          vOpacity = 0.57 + aSize.z * 0.19;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform vec3 uTop;
        uniform vec3 uBase;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          float alpha = texture2D(uMap, vUv).a * vOpacity;
          if (alpha < 0.005) discard;
          vec3 color = mix(uBase, uTop, smoothstep(0.15, 0.75, vUv.y));
          gl_FragColor = vec4(color, alpha);
          ${outputColor}
        }
      `,
    });
    const clouds = new THREE.Mesh(geometry, material);
    clouds.name = 'soft-drifting-clouds';
    clouds.frustumCulled = false;
    clouds.renderOrder = -5;
    this.root.add(clouds);
  }
}
