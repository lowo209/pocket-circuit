import * as THREE from 'three';
import { getSkin, getTrack } from '../shared';
import type { RaceState, TrackId, TrackSample } from '../shared';
import { sampleTrack, trackLength, trackSamples } from './simulation';

const TAU = Math.PI * 2;

type Shape = 'box' | 'cylinder' | 'cone' | 'rock' | 'leaf' | 'sphere';
type Instance = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  matrices: THREE.Matrix4[];
};

/** Static scenery is batched by geometry and color to keep draw calls low. */
class SceneryBatch {
  private groups = new Map<string, Instance>();
  private dummy = new THREE.Object3D();
  add(
    shape: Shape,
    color: string,
    position: number[],
    scale: number[],
    rotation: number[] = [0, 0, 0],
    emissive = false,
  ) {
    const key = `${shape}:${color}:${emissive}`;
    let batch = this.groups.get(key);
    if (!batch) {
      let geometry: THREE.BufferGeometry;
      if (shape === 'cylinder') geometry = new THREE.CylinderGeometry(0.65, 1, 1, 7);
      else if (shape === 'cone') geometry = new THREE.ConeGeometry(1, 1, 7);
      else if (shape === 'rock') geometry = new THREE.IcosahedronGeometry(1, 0);
      else if (shape === 'sphere') geometry = new THREE.SphereGeometry(1, 9, 6);
      else if (shape === 'leaf') geometry = leafGeometry();
      else geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        flatShading: true,
        ...(emissive ? { emissive: color, emissiveIntensity: 1.15 } : {}),
      });
      batch = { geometry, material, matrices: [] };
      this.groups.set(key, batch);
    }
    this.dummy.position.set(position[0], position[1], position[2]);
    this.dummy.scale.set(scale[0], scale[1], scale[2]);
    this.dummy.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
    this.dummy.updateMatrix();
    batch.matrices.push(this.dummy.matrix.clone());
  }
  finish(root: THREE.Group) {
    for (const batch of this.groups.values()) {
      const instanced = new THREE.InstancedMesh(
        batch.geometry,
        batch.material,
        batch.matrices.length,
      );
      batch.matrices.forEach((matrix, index) => instanced.setMatrixAt(index, matrix));
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.computeBoundingSphere();
      root.add(instanced);
    }
    this.groups.clear();
  }
}

function leafGeometry() {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    0, 0, 0, -0.28, 0.12, 0.42, 0.28, 0.12, 0.42, -0.28, 0.12, 0.42, -0.35, -0.03, 0.9, 0.35, -0.03,
    0.9, -0.28, 0.12, 0.42, 0.35, -0.03, 0.9, 0.28, 0.12, 0.42, -0.35, -0.03, 0.9, 0, -0.45, 1.65,
    0.35, -0.03, 0.9, 0, -0.025, 0, 0.28, 0.085, 0.42, -0.28, 0.085, 0.42, -0.28, 0.085, 0.42, 0.35,
    -0.055, 0.9, -0.35, -0.055, 0.9, -0.28, 0.085, 0.42, 0.28, 0.085, 0.42, 0.35, -0.055, 0.9,
    -0.35, -0.055, 0.9, 0.35, -0.055, 0.9, 0, -0.475, 1.65,
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function mulberry(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standard(color: string, roughness = 0.65) {
  return new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
}

function part(
  root: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  xyz: number[],
  scale: number[] = [1, 1, 1],
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(xyz[0], xyz[1], xyz[2]);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

export function makeKart(skinId: string): THREE.Group {
  const skin = getSkin(skinId);
  const root = new THREE.Group();
  const paint = standard(skin.color, 0.3);
  const accent = standard(skin.accent, 0.55);
  const black = standard('#202832');
  const tire = standard('#232c31');
  const silver = standard('#ccd8d9', 0.27);
  const cream = standard('#fff6df', 0.4);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const ball = new THREE.SphereGeometry(1, 12, 8);
  part(root, cube, black, [0, 0.5, 0], [2.35, 0.22, 3.25]);
  part(root, cube, paint, [0, 0.79, 0.12], [1.85, 0.58, 2.55]);
  part(root, cube, paint, [0, 0.95, 1.02], [1.58, 0.45, 1.3]);
  part(root, cube, accent, [0, 1.19, 1.03], [0.38, 0.035, 1.2]);
  part(root, cube, silver, [0, 0.57, 1.68], [2.52, 0.22, 0.24]);
  part(root, cube, black, [0, 0.58, -1.6], [2.25, 0.22, 0.24]);
  part(root, cube, paint, [-0.94, 1.05, -0.75], [0.27, 0.15, 1.7]);
  part(root, cube, paint, [0.94, 1.05, -0.75], [0.27, 0.15, 1.7]);
  part(root, cube, black, [0, 1.1, -0.46], [1.05, 0.38, 0.93]);
  part(root, cube, black, [0, 1.44, -0.85], [1.08, 0.85, 0.25]);
  part(root, cube, accent, [0, 1.52, -0.25], [0.88, 0.8, 0.55]);
  const head = part(root, ball, cream, [0, 2.18, -0.19], [0.61, 0.63, 0.58]);
  head.name = 'helmet';
  part(root, ball, paint, [0, 2.32, -0.24], [0.62, 0.51, 0.57]);
  part(root, ball, standard('#203b49', 0.12), [0, 2.16, 0.23], [0.49, 0.25, 0.2]);
  part(root, cube, cream, [-0.5, 1.58, 0.22], [0.25, 0.24, 0.7]).rotation.x = -0.24;
  part(root, cube, cream, [0.5, 1.58, 0.22], [0.25, 0.24, 0.7]).rotation.x = -0.24;
  const steering = part(root, new THREE.TorusGeometry(0.31, 0.045, 6, 12), black, [0, 1.49, 0.64]);
  steering.rotation.x = -Math.PI / 3;
  for (const x of [-1.13, 1.13])
    for (const z of [-1.03, 1.03]) {
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.52, z);
      const rubber = part(wheel, new THREE.CylinderGeometry(0.53, 0.53, 0.43, 12), tire, [0, 0, 0]);
      rubber.rotation.z = Math.PI / 2;
      const hub = part(wheel, new THREE.CylinderGeometry(0.25, 0.25, 0.455, 8), silver, [0, 0, 0]);
      hub.rotation.z = Math.PI / 2;
      const hubcap = part(
        wheel,
        new THREE.CylinderGeometry(0.11, 0.11, 0.465, 8),
        paint,
        [0, 0, 0],
      );
      hubcap.rotation.z = Math.PI / 2;
      wheel.name = `wheel-${x}-${z}`;
      root.add(wheel);
    }
  const spoiler = part(root, cube, paint, [0, 1.38, -1.48], [2.4, 0.13, 0.54]);
  spoiler.rotation.x = -0.12;
  part(root, cube, black, [-0.65, 1.08, -1.46], [0.13, 0.5, 0.14]);
  part(root, cube, black, [0.65, 1.08, -1.46], [0.13, 0.5, 0.14]);
  for (const x of [-0.54, 0.54]) {
    part(
      root,
      cube,
      new THREE.MeshStandardMaterial({
        color: '#fff8ce',
        emissive: '#fff1a6',
        emissiveIntensity: 0.3,
      }),
      [x, 0.91, 1.68],
      [0.39, 0.17, 0.05],
    );
    const exhaust = part(root, new THREE.CylinderGeometry(0.14, 0.14, 0.38, 8), silver, [
      x,
      0.58,
      -1.71,
    ]);
    exhaust.rotation.x = Math.PI / 2;
  }
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({
      color: '#10242b',
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.62, 2.15, 1);
  shadow.position.y = 0.027;
  root.add(shadow);
  root.userData.skin = skinId;
  return root;
}

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      geometries.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach((material: THREE.Material) => materials.add(material));
    }
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    const mat = material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    material.dispose();
  });
}

export class KartRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(52, 1, 0.2, 1400);
  private world = new THREE.Group();
  private racers = new Map<string, THREE.Group>();
  private pickups = new Map<number, THREE.Group>();
  private attract: THREE.Group;
  private observer: ResizeObserver;
  private trackId: TrackId;
  private time = 0;
  private cameraStarted = false;
  private mode: 'race' | 'attract' = 'attract';
  private raceId: string | null = null;
  private lookAt = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private sun: THREE.DirectionalLight;
  private hemisphere: THREE.HemisphereLight;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private disposed = false;

  constructor(
    private container: HTMLElement,
    trackId: TrackId,
  ) {
    this.trackId = trackId;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', '3D-Kartrennstrecke');
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;';
    container.appendChild(this.renderer.domElement);
    this.hemisphere = new THREE.HemisphereLight('#e1fbff', '#bf9a65', 2.6);
    this.sun = new THREE.DirectionalLight('#fff2cf', 3.1);
    this.sun.position.set(-50, 110, -35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1536, 1536);
    this.sun.shadow.camera.left = -80;
    this.sun.shadow.camera.right = 80;
    this.sun.shadow.camera.top = 80;
    this.sun.shadow.camera.bottom = -80;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.bias = -0.00015;
    this.scene.add(this.hemisphere, this.sun, this.sun.target, this.world);
    this.attract = makeKart('lime');
    this.attract.scale.setScalar(1.4);
    this.scene.add(this.attract);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.setTrack(trackId);
    this.resize();
  }

  private resize() {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  setSkin(skinId: string) {
    if (this.attract.userData.skin === skinId) return;
    const replacement = makeKart(skinId);
    replacement.position.copy(this.attract.position);
    replacement.rotation.copy(this.attract.rotation);
    replacement.scale.copy(this.attract.scale);
    replacement.visible = this.attract.visible;
    this.scene.remove(this.attract);
    disposeObject(this.attract);
    this.attract = replacement;
    this.scene.add(replacement);
  }

  setTrack(trackId: TrackId) {
    this.trackId = trackId;
    disposeObject(this.world);
    this.world.clear();
    this.pickups.clear();
    this.cameraStarted = false;
    const track = getTrack(trackId);
    const night = trackId === 'midnight';
    this.scene.background = new THREE.Color(track.sky);
    this.scene.fog = new THREE.Fog(track.sky, night ? 130 : 210, night ? 420 : 660);
    this.hemisphere.color.set(night ? '#9ab6ff' : '#e1fbff');
    this.hemisphere.groundColor.set(night ? '#3d285a' : '#bd9871');
    this.hemisphere.intensity = night ? 1.75 : 2.6;
    this.sun.color.set(night ? '#a2b9ff' : '#fff2cf');
    this.sun.intensity = night ? 1.9 : 3.1;
    this.renderer.toneMappingExposure = night ? 1.25 : 1.08;
    this.buildWorld();
  }

  private ribbon(samples: TrackSample[], offset: number, width: number, color: string, y: number) {
    const vertices: number[] = [];
    const indexes: number[] = [];
    for (let i = 0; i <= samples.length; i++) {
      const point = samples[i % samples.length];
      for (const side of [-1, 1]) {
        const distance = offset + (width * side) / 2;
        vertices.push(
          point.x + Math.cos(point.heading) * distance,
          y,
          point.z - Math.sin(point.heading) * distance,
        );
      }
      if (i < samples.length) {
        const a = i * 2;
        indexes.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indexes);
    geometry.computeVertexNormals();
    const material = standard(color);
    material.side = THREE.DoubleSide;
    const road = new THREE.Mesh(geometry, material);
    road.receiveShadow = true;
    this.world.add(road);
  }

  private buildWorld() {
    const track = getTrack(this.trackId);
    const points = trackSamples(this.trackId);
    const length = trackLength(this.trackId);
    const coast = this.trackId === 'coast';
    const night = this.trackId === 'midnight';
    const batch = new SceneryBatch();
    const random = mulberry(coast ? 739 : night ? 408 : 290);
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minZ = Math.min(...points.map((p) => p.z));
    const maxZ = Math.max(...points.map((p) => p.z));
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const radiusX = (maxX - minX) / 2 + 70;
    const radiusZ = (maxZ - minZ) / 2 + 60;
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(2300, 2300),
      standard(coast ? '#46b9bc' : night ? '#142440' : '#ba805b'),
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.7;
    ocean.receiveShadow = true;
    this.world.add(ocean);
    if (coast) {
      const sandEdge = new THREE.Mesh(new THREE.CircleGeometry(1, 64), standard('#f3ddb6'));
      sandEdge.rotation.x = -Math.PI / 2;
      sandEdge.scale.set(radiusX + 5, radiusZ + 7, 1);
      sandEdge.position.set(centerX, -0.42, centerZ);
      sandEdge.receiveShadow = true;
      this.world.add(sandEdge);
      const island = new THREE.Mesh(new THREE.CircleGeometry(1, 64), standard(track.ground));
      island.rotation.x = -Math.PI / 2;
      island.scale.set(radiusX, radiusZ, 1);
      island.position.set(centerX, -0.09, centerZ);
      island.receiveShadow = true;
      this.world.add(island);
      for (let i = 0; i < 100; i++) {
        const angle = random() * TAU;
        const radius = 1.08 + random() * 2;
        batch.add(
          'box',
          i % 3 === 0 ? '#85d2d1' : '#62c5c4',
          [
            centerX + Math.cos(angle) * radiusX * radius,
            -0.65,
            centerZ + Math.sin(angle) * radiusZ * radius,
          ],
          [3 + random() * 15, 0.015, 0.18 + random() * 0.4],
        );
      }
      for (let i = 0; i < 5; i++) {
        const angle = (i * TAU) / 5;
        const x = centerX + Math.cos(angle) * 530;
        const z = centerZ + Math.sin(angle) * 530;
        batch.add(
          'rock',
          '#95a88b',
          [x, -5, z],
          [45 + random() * 65, 28 + random() * 45, 45 + random() * 60],
          [0, random() * TAU, 0],
        );
      }
    } else {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1050, 1050), standard(track.ground));
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.07;
      ground.receiveShadow = true;
      this.world.add(ground);
    }
    this.ribbon(
      points,
      0,
      track.width + 2.5,
      night ? '#1f3046' : coast ? '#c5b79e' : '#995d42',
      0.005,
    );
    this.ribbon(points, 0, track.width, track.road, 0.035);
    this.ribbon(points, -track.width / 2 + 0.4, 0.13, night ? '#89d6dc' : '#e4e3ca', 0.055);
    this.ribbon(points, track.width / 2 - 0.4, 0.13, night ? '#89d6dc' : '#e4e3ca', 0.055);
    for (let p = 0; p < length; p += 5) {
      const point = sampleTrack(this.trackId, p);
      const next = sampleTrack(this.trackId, p + 5);
      const span = Math.hypot(next.x - point.x, next.z - point.z) + 0.15;
      const middle = sampleTrack(this.trackId, p + 2.5);
      for (const sign of [-1, 1]) {
        const edge = track.width / 2 + 0.32;
        batch.add(
          'box',
          night
            ? Math.floor(p / 5) % 2
              ? '#ab85fe'
              : '#6ae0dd'
            : Math.floor(p / 5) % 2
              ? '#f3f1df'
              : '#ed775d',
          [
            middle.x + Math.cos(middle.heading) * edge * sign,
            0.105,
            middle.z - Math.sin(middle.heading) * edge * sign,
          ],
          [0.7, 0.15, span],
          [0, middle.heading, 0],
          night,
        );
      }
      if (Math.floor(p / 5) % 2 === 0) {
        batch.add(
          'box',
          night ? '#aec1de' : '#e9e7cd',
          [point.x, 0.06, point.z],
          [0.17, 0.017, 2.6],
          [0, point.heading, 0],
        );
      }
    }
    this.buildStart(batch);
    // Keep the road corridor unobstructed, including tight corners.
    const clearance = (x: number, z: number) => {
      let nearest = Infinity;
      for (let i = 0; i < points.length; i += 4)
        nearest = Math.min(nearest, (points[i].x - x) ** 2 + (points[i].z - z) ** 2);
      return Math.sqrt(nearest);
    };
    for (let i = 0; i < 380; i++) {
      const x = minX - 45 + random() * (maxX - minX + 90);
      const z = minZ - 45 + random() * (maxZ - minZ + 90);
      const distance = clearance(x, z);
      if (
        distance < track.width / 2 + 4 ||
        ((x - centerX) / radiusX) ** 2 + ((z - centerZ) / radiusZ) ** 2 > 0.96
      )
        continue;
      if (coast) {
        if (i % 4 === 0) {
          const h = 7 + random() * 5;
          const lean = (random() - 0.5) * 0.2;
          batch.add(
            'cylinder',
            '#a27d55',
            [x + (Math.sin(lean) * h) / 2, (Math.cos(lean) * h) / 2, z],
            [0.43, h, 0.43],
            [0, 0, -lean],
          );
          const topX = x + Math.sin(lean) * h;
          const topY = Math.cos(lean) * h;
          for (let j = 0; j < 7; j++)
            batch.add(
              'leaf',
              j % 2 ? '#518b67' : '#6d9c60',
              [topX, topY, z],
              [3.1, 3.1, 3.1],
              [random() * 0.18 - 0.2, (j * TAU) / 7 + random() * 0.3, 0],
            );
          batch.add('sphere', '#98714a', [topX, topY - 0.45, z], [0.55, 0.6, 0.5]);
        } else if (i % 11 === 0) {
          const umbrella = i % 2 ? '#ff967a' : '#fff1c5';
          batch.add('cylinder', '#e5d7b3', [x, 1.9, z], [0.07, 3.8, 0.07]);
          batch.add('cone', umbrella, [x, 3.7, z], [2.25, 1.15, 2.25]);
          batch.add('box', '#fff2ce', [x + 1.3, 0.3, z + 1], [0.9, 0.18, 2.2], [0, 0.2, 0]);
        } else if (i % 3 === 0) {
          batch.add(
            'rock',
            '#b0bb8d',
            [x, 0.2, z],
            [1.4 + random() * 2, 0.3 + random(), 1.5 + random()],
            [0, random() * TAU, 0],
          );
        }
      } else if (night) {
        if (i % 5 === 0 && distance > 22) {
          const h = 10 + random() * 38;
          const w = 5 + random() * 8;
          batch.add('box', i % 2 ? '#283852' : '#202f48', [x, h / 2, z], [w, h, w]);
          batch.add(
            'box',
            i % 3 ? '#b88eff' : '#55ddd0',
            [x, h + 0.12, z],
            [w + 0.15, 0.24, w + 0.15],
            [0, 0, 0],
            true,
          );
          for (let floor = 3; floor < h - 2; floor += 4) {
            batch.add(
              'box',
              '#75adbf',
              [x, floor, z + w / 2 + 0.02],
              [w * 0.58, 0.45, 0.05],
              [0, 0, 0],
              true,
            );
            batch.add(
              'box',
              '#927ba9',
              [x - w / 2 - 0.02, floor, z],
              [0.05, 0.45, w * 0.58],
              [0, 0, 0],
              true,
            );
          }
        } else if (i % 3 === 0) {
          batch.add('cone', '#36616b', [x, 2.2, z], [1.1, 4.8, 1.1]);
          batch.add('box', '#4f8489', [x, 0.25, z], [2.5, 0.5, 2.5]);
        }
      } else {
        if (i % 5 === 0 && distance > 21) {
          const h = 9 + random() * 28;
          batch.add(
            'cylinder',
            i % 2 ? '#cb8156' : '#ad6449',
            [x, h / 2 - 1, z],
            [6 + random() * 5, h, 5 + random() * 5],
            [0, random() * TAU, 0],
          );
          batch.add(
            'cylinder',
            '#e1a06a',
            [x, h - 0.3, z],
            [4 + random() * 4, 2.8, 4 + random() * 3],
            [0, random() * TAU, 0],
          );
        } else if (i % 6 === 0) {
          const h = 2.8 + random() * 3;
          batch.add('cylinder', '#52765c', [x, h / 2, z], [0.36, h, 0.36]);
          batch.add('cylinder', '#52765c', [x + 0.65, h * 0.57, z], [0.24, 1.5, 0.24]);
          batch.add('box', '#52765c', [x + 0.32, h * 0.43, z], [0.8, 0.35, 0.36]);
          batch.add('sphere', '#749173', [x, h, z], [0.26, 0.22, 0.26]);
        } else if (i % 3 === 0) {
          batch.add(
            'rock',
            '#d69869',
            [x, 0.35, z],
            [1.2 + random() * 2, 0.8 + random() * 2, 1.5 + random()],
            [0, random() * TAU, 0],
          );
        }
      }
    }
    // Road furniture makes turns legible at speed.
    for (let p = 30; p < length; p += 48) {
      const point = sampleTrack(this.trackId, p);
      const x = point.x + Math.cos(point.heading) * (track.width / 2 + 2.9);
      const z = point.z - Math.sin(point.heading) * (track.width / 2 + 2.9);
      if (night) {
        batch.add('box', '#556d85', [x, 3.8, z], [0.22, 7.6, 0.22]);
        batch.add('box', '#c5b3ff', [x, 7.65, z], [2, 0.16, 0.4], [0, point.heading, 0], true);
      } else {
        batch.add('box', '#f5e8cd', [x, 0.7, z], [0.25, 1.4, 0.25]);
        batch.add('box', '#e88d60', [x, 1.2, z], [0.28, 0.32, 0.28]);
      }
    }
    batch.finish(this.world);
    if (night) {
      const moon = new THREE.Mesh(
        new THREE.SphereGeometry(18, 24, 16),
        new THREE.MeshBasicMaterial({ color: '#d5d3ea' }),
      );
      moon.position.set(-160, 170, 330);
      this.world.add(moon);
    } else {
      // Small groups of low-poly clouds sit above the coast and desert.
      const clouds = new SceneryBatch();
      for (let i = 0; i < 16; i++) {
        const x = centerX + (random() - 0.5) * 1000;
        const z = centerZ + (random() - 0.5) * 1000;
        for (let j = 0; j < 3; j++)
          clouds.add(
            'sphere',
            '#f8f2de',
            [x + j * 13, 90 + random() * 6, z],
            [20 + random() * 8, 5 + random() * 4, 10],
          );
      }
      clouds.finish(this.world);
    }
  }

  private buildStart(batch: SceneryBatch) {
    const track = getTrack(this.trackId);
    const start = sampleTrack(this.trackId, 0);
    const width = track.width;
    const place = (x: number, y: number, z: number) => [
      start.x + Math.cos(start.heading) * x + Math.sin(start.heading) * z,
      y,
      start.z - Math.sin(start.heading) * x + Math.cos(start.heading) * z,
    ];
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 12; col++) {
        batch.add(
          'box',
          (row + col) % 2 ? '#f1edda' : '#37414b',
          place(((col - 5.5) * width) / 12, 0.072, row * 0.7),
          [width / 12, 0.02, 0.7],
          [0, start.heading, 0],
        );
      }
    for (const side of [-1, 1]) {
      batch.add(
        'box',
        '#f6f0dc',
        place(side * (width / 2 + 1.5), 4.8, 0),
        [0.65, 9.6, 0.65],
        [0, start.heading, 0],
      );
      batch.add(
        'box',
        '#c2e972',
        place(side * (width / 2 + 1.5), 1.5, 0),
        [0.75, 3, 0.75],
        [0, start.heading, 0],
      );
    }
    batch.add('box', '#f6f0dc', place(0, 9.6, 0), [width + 3.65, 1.65, 0.6], [0, start.heading, 0]);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#f6f0dc';
      context.fillRect(0, 0, 1024, 128);
      context.fillStyle = '#293932';
      context.font = '900 65px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('POCKET CIRCUIT', 512, 69);
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 4; col++)
          if ((row + col) % 2 === 0) {
            context.fillRect(15 + col * 24, 16 + row * 24, 24, 24);
            context.fillRect(911 + col * 24, 16 + row * 24, 24, 24);
          }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 3.4, 1.55),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, side: THREE.DoubleSide }),
      );
      const xyz = place(0, 9.6, -0.32);
      sign.position.set(xyz[0], xyz[1], xyz[2]);
      sign.rotation.y = start.heading + Math.PI;
      this.world.add(sign);
    }
  }

  private makePickup(kind: 'item' | 'coin') {
    const root = new THREE.Group();
    if (kind === 'coin') {
      const coin = part(
        root,
        new THREE.CylinderGeometry(0.57, 0.57, 0.14, 16),
        new THREE.MeshStandardMaterial({
          color: '#ffce53',
          metalness: 0.4,
          roughness: 0.28,
          emissive: '#ffb727',
          emissiveIntensity: 0.23,
        }),
        [0, 0, 0],
      );
      coin.rotation.x = Math.PI / 2;
      const center = part(
        root,
        new THREE.CylinderGeometry(0.38, 0.38, 0.155, 16),
        standard('#ffe493', 0.3),
        [0, 0, 0],
      );
      center.rotation.x = Math.PI / 2;
    } else {
      const box = part(
        root,
        new THREE.BoxGeometry(1.5, 1.5, 1.5),
        new THREE.MeshStandardMaterial({
          color: '#c2f482',
          transparent: true,
          opacity: 0.82,
          emissive: '#8cc54c',
          emissiveIntensity: 0.35,
          roughness: 0.26,
        }),
        [0, 0, 0],
      );
      box.rotation.set(0.15, Math.PI / 4, 0.15);
      part(
        root,
        new THREE.OctahedronGeometry(0.43, 0),
        new THREE.MeshStandardMaterial({
          color: '#ffffff',
          emissive: '#fffbe4',
          emissiveIntensity: 1,
        }),
        [0, 0, 0],
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.2, 0.035, 5, 20),
        new THREE.MeshBasicMaterial({ color: '#d2ff91', transparent: true, opacity: 0.6 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.7;
      root.add(ring);
    }
    return root;
  }

  render(state: RaceState | null, localId: string, dt: number) {
    if (this.disposed) return;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt;
    const newMode = state ? 'race' : 'attract';
    if (newMode !== this.mode) {
      this.cameraStarted = false;
      this.mode = newMode;
    }
    if (state && state.id !== this.raceId) {
      this.raceId = state.id;
      this.cameraStarted = false;
      for (const kart of this.racers.values()) kart.userData.positioned = false;
    }
    if (state && state.trackId !== this.trackId) this.setTrack(state.trackId);
    this.attract.visible = !state;
    let x: number,
      z: number,
      heading: number,
      speed = 0;
    if (state) {
      const activeIds = new Set(state.racers.map((r) => r.id));
      for (const [id, kart] of this.racers)
        if (!activeIds.has(id)) {
          this.scene.remove(kart);
          disposeObject(kart);
          this.racers.delete(id);
        }
      for (const racer of state.racers) {
        let kart = this.racers.get(racer.id);
        if (kart && kart.userData.skin !== racer.skin) {
          this.scene.remove(kart);
          disposeObject(kart);
          this.racers.delete(racer.id);
          kart = undefined;
        }
        if (!kart) {
          kart = makeKart(racer.skin);
          this.racers.set(racer.id, kart);
          this.scene.add(kart);
          const shield = new THREE.Mesh(
            new THREE.SphereGeometry(2.1, 16, 12),
            new THREE.MeshBasicMaterial({
              color: '#8ceafa',
              transparent: true,
              opacity: 0.15,
              depthWrite: false,
            }),
          );
          shield.position.y = 1.2;
          shield.name = 'shield';
          kart.add(shield);
          const boost = new THREE.Group();
          boost.name = 'boost';
          for (const side of [-1, 1]) {
            const flame = part(
              boost,
              new THREE.ConeGeometry(0.28, 2, 7),
              new THREE.MeshBasicMaterial({ color: '#82dffc' }),
              [side * 0.54, 0.6, -2.4],
            );
            flame.rotation.x = -Math.PI / 2;
          }
          kart.add(boost);
          const sparks = new THREE.Group();
          sparks.name = 'sparks';
          const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#7ce5ff' });
          for (const side of [-1, 1])
            for (let index = 0; index < 3; index++) {
              const spark = part(
                sparks,
                new THREE.OctahedronGeometry(0.1, 0),
                sparkMaterial,
                [side * (1.3 + index * 0.18), 0.15 + index * 0.12, -1.2 - index * 0.4],
                [1, 1, 2.5],
              );
              spark.castShadow = false;
            }
          kart.add(sparks);
        }
        kart.visible = true;
        const smooth = kart.userData.positioned ? 1 - Math.exp(-18 * dt) : 1;
        kart.position.x += (racer.x - kart.position.x) * smooth;
        kart.position.z += (racer.z - kart.position.z) * smooth;
        kart.position.y =
          0.075 +
          (racer.stun > 0
            ? Math.abs(Math.sin(this.time * 25)) * 0.28
            : Math.sin(this.time * 13) * Math.min(Math.abs(racer.speed) / 400, 0.022));
        const angle = Math.atan2(
          Math.sin(racer.heading - kart.rotation.y),
          Math.cos(racer.heading - kart.rotation.y),
        );
        kart.rotation.y += angle * smooth;
        kart.rotation.z = racer.drifting ? Math.sin(this.time * 5) * 0.035 : 0;
        kart.userData.positioned = true;
        kart.getObjectByName('shield')!.visible = racer.shield > 0;
        const boost = kart.getObjectByName('boost')!;
        boost.visible = racer.boost > 0;
        boost.scale.z = 0.8 + Math.sin(this.time * 37) * 0.22;
        const sparks = kart.getObjectByName('sparks')!;
        sparks.visible = racer.drifting && Math.abs(racer.speed) > 10;
        sparks.scale.setScalar(0.9 + Math.sin(this.time * 45) * 0.28);
        const sparkMaterial = (sparks.children[0] as THREE.Mesh)
          .material as THREE.MeshBasicMaterial;
        sparkMaterial.color.set(racer.driftCharge >= 1.2 ? '#ffd35d' : '#7ce5ff');
        for (const child of kart.children)
          if (child.name.startsWith('wheel')) child.rotation.x += (racer.speed * dt) / 0.53;
      }
      const local = state.racers.find((r) => r.id === localId) ?? state.racers[0];
      if (!local) {
        this.renderer.render(this.scene, this.camera);
        return;
      }
      const localMesh = this.racers.get(local.id)!;
      x = localMesh.position.x;
      z = localMesh.position.z;
      heading = local.heading;
      speed = local.speed;
      for (const pickup of state.pickups) {
        let object = this.pickups.get(pickup.id);
        if (!object) {
          object = this.makePickup(pickup.kind);
          const point = sampleTrack(this.trackId, pickup.progress);
          object.position.set(point.x, 1.5, point.z);
          this.pickups.set(pickup.id, object);
          this.world.add(object);
        }
        object.visible = pickup.availableAt <= state.elapsed;
        object.position.y =
          (pickup.kind === 'coin' ? 1.35 : 1.85) + Math.sin(this.time * 2.7 + pickup.id) * 0.18;
        object.rotation.y += dt * (pickup.kind === 'coin' ? 2.1 : 0.8);
      }
      const fov = 55 + Math.min(Math.max(speed, 0) / 14, 6) + (local.boost > 0 ? 4 : 0);
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
      const followDistance = 11.8 + Math.min(Math.abs(speed) / 60, 1.6);
      this.cameraTarget.set(
        x - Math.sin(heading) * followDistance,
        7.2,
        z - Math.cos(heading) * followDistance,
      );
      const look = new THREE.Vector3(x + Math.sin(heading) * 8, 1.15, z + Math.cos(heading) * 8);
      if (!this.cameraStarted) this.lookAt.copy(look);
      else this.lookAt.lerp(look, 1 - Math.exp(-8 * dt));
    } else {
      for (const kart of this.racers.values()) kart.visible = false;
      for (const pickup of this.pickups.values()) pickup.visible = false;
      const progress = this.reducedMotion ? 38 : 38 + this.time * 3.5;
      const point = sampleTrack(this.trackId, progress);
      x = point.x;
      z = point.z;
      heading = point.heading;
      this.attract.position.set(x, 0.085, z);
      this.attract.rotation.y = heading;
      if (!this.reducedMotion)
        for (const child of this.attract.children)
          if (child.name.startsWith('wheel')) child.rotation.x += dt * 6;
      // Elevated three-quarter camera leaves generous room for the track and coastline.
      const distance = this.camera.aspect < 1 ? 24 : 18;
      this.cameraTarget.set(
        x + Math.sin(heading) * distance + Math.cos(heading) * 12,
        13,
        z + Math.cos(heading) * distance - Math.sin(heading) * 12,
      );
      const textSpace = this.camera.aspect > 1.35 ? 7 : 0;
      const look = new THREE.Vector3(
        x + Math.sin(heading) * 4 - Math.cos(heading) * textSpace,
        0,
        z + Math.cos(heading) * 4 + Math.sin(heading) * textSpace,
      );
      if (!this.cameraStarted) this.lookAt.copy(look);
      else this.lookAt.lerp(look, 1 - Math.exp(-3 * dt));
      if (Math.abs(this.camera.fov - 43) > 0.1) {
        this.camera.fov = 43;
        this.camera.updateProjectionMatrix();
      }
    }
    if (!this.cameraStarted) {
      this.camera.position.copy(this.cameraTarget);
      this.cameraStarted = true;
    } else this.camera.position.lerp(this.cameraTarget, 1 - Math.exp(-(state ? 5.5 : 3) * dt));
    this.camera.lookAt(this.lookAt);
    this.sun.position.set(x - 50, 110, z - 35);
    this.sun.target.position.set(x, 0, z);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    disposeObject(this.scene);
    this.scene.clear();
    this.racers.clear();
    this.pickups.clear();
    this.sun.shadow.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
