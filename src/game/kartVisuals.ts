import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getSkin } from '../shared';
import type { Racer, TrackId } from '../shared';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const damp = (from: number, to: number, rate: number, dt: number) =>
  from + (to - from) * (1 - Math.exp(-rate * dt));

interface WheelRig {
  pivot: THREE.Group;
  spin: THREE.Group;
  front: boolean;
  side: number;
}
interface KartRig {
  body: THREE.Group;
  driver: THREE.Group;
  helmet: THREE.Group;
  steeringWheel: THREE.Group;
  wheels: WheelRig[];
  brake: THREE.MeshStandardMaterial;
  shield: THREE.Mesh;
  shieldMaterial: THREE.ShaderMaterial;
  boost: THREE.Group;
  speed: number;
  previousSpeed: number;
  previousHeading: number;
  steering: number;
  pitch: number;
  roll: number;
  suspension: number;
  suspensionVelocity: number;
  impact: number;
  initialized: boolean;
  trailTime: number;
  dustTime: number;
}

export interface KartMotion {
  speed: number;
  heading: number;
  steering?: number;
  impact?: number;
  boost: number;
  shield: number;
  stun: number;
  drifting: boolean;
  driftCharge: number;
}

function mesh(
  root: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  object.scale.set(sx, sy, sz);
  object.castShadow = true;
  object.receiveShadow = true;
  root.add(object);
  return object;
}

function mergeStaticChildren(group: THREE.Group, sourceGeometries: Set<THREE.BufferGeometry>) {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of group.children)
    if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
      const bucket = buckets.get(child.material) ?? [];
      bucket.push(child);
      buckets.set(child.material, bucket);
    }
  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((object) => {
      sourceGeometries.add(object.geometry);
      object.updateMatrix();
      const geometry = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();
      return geometry.applyMatrix4(object.matrix);
    });
    const geometry = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, material);
    merged.castShadow = meshes.some((object) => object.castShadow);
    merged.receiveShadow = meshes.some((object) => object.receiveShadow);
    meshes.forEach((object) => group.remove(object));
    group.add(merged);
  }
}

/** A chamfered racing kart; wheel steering and axle rotation have separate pivots. */
export function makeKart(skinId: string): THREE.Group {
  const skin = getSkin(skinId);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  body.position.y = 0.55;
  root.add(body);
  const paint = new THREE.MeshPhysicalMaterial({
    color: skin.color,
    metalness: 0.22,
    roughness: 0.23,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 1.35,
  });
  const trim = new THREE.MeshPhysicalMaterial({
    color: skin.accent,
    metalness: 0.25,
    roughness: 0.32,
    clearcoat: 0.65,
    envMapIntensity: 1.2,
  });
  const carbon = new THREE.MeshStandardMaterial({
    color: '#172027',
    metalness: 0.18,
    roughness: 0.61,
  });
  const tire = new THREE.MeshStandardMaterial({ color: '#14191e', roughness: 0.94 });
  const tireEdge = new THREE.MeshStandardMaterial({ color: '#20272b', roughness: 0.77 });
  const chrome = new THREE.MeshPhysicalMaterial({
    color: '#cbd4dc',
    metalness: 0.93,
    roughness: 0.16,
    clearcoat: 0.4,
    envMapIntensity: 1.8,
  });
  const rimDark = new THREE.MeshStandardMaterial({
    color: '#38404b',
    metalness: 0.85,
    roughness: 0.29,
  });
  const cream = new THREE.MeshPhysicalMaterial({
    color: '#fffaf0',
    metalness: 0.04,
    roughness: 0.23,
    clearcoat: 0.9,
    envMapIntensity: 1.2,
  });
  const suit = new THREE.MeshStandardMaterial({ color: skin.accent, roughness: 0.88 });
  const unit = new RoundedBoxGeometry(1, 1, 1, 3, 0.12);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const bp = (
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ) => mesh(body, unit, material, x, y - 0.55, z, sx, sy, sz);

  bp(carbon, 0, 0.46, 0, 2.23, 0.2, 3.12);
  bp(paint, 0, 0.76, 0.05, 1.87, 0.5, 2.64);
  const nose = new RoundedBoxGeometry(1.78, 0.47, 1.45, 3, 0.15);
  const positions = nose.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const z = positions.getZ(i);
    positions.setX(i, positions.getX(i) * (1 - (z + 0.73) * 0.1));
  }
  nose.computeVertexNormals();
  mesh(body, nose, paint, 0, 0.48, 0.91);
  bp(trim, 0, 1.272, 0.96, 0.35, 0.018, 1.15);
  bp(cream, -0.24, 1.272, 0.96, 0.05, 0.02, 1.15);
  bp(cream, 0.24, 1.272, 0.96, 0.05, 0.02, 1.15);
  bp(chrome, 0, 0.59, 1.69, 2.43, 0.2, 0.24);
  bp(carbon, 0, 0.74, 1.56, 1.98, 0.1, 0.16);
  bp(carbon, 0, 0.56, -1.57, 2.16, 0.24, 0.26);
  for (const side of [-1, 1]) {
    bp(paint, side * 0.94, 0.94, -0.56, 0.35, 0.39, 1.58);
    bp(trim, side * 1.115, 0.95, -0.55, 0.018, 0.12, 1.02);
    bp(chrome, side * 1.0, 0.56, 0.1, 0.13, 0.12, 2.65);
    const vent = bp(carbon, side * 0.64, 0.82, -1.34, 0.36, 0.29, 0.12);
    vent.rotation.x = -0.15;
    for (let i = 0; i < 3; i++) bp(chrome, side * 0.64, 0.75 + i * 0.08, -1.41, 0.31, 0.018, 0.025);
  }
  bp(carbon, 0, 1.08, -0.41, 1.04, 0.25, 0.9);
  const seat = bp(carbon, 0, 1.45, -0.81, 1.12, 0.96, 0.27);
  seat.rotation.x = -0.08;
  bp(trim, 0, 1.63, -0.66, 0.92, 0.63, 0.06);
  for (const side of [-1, 1]) {
    bp(carbon, side * 0.69, 1.22, -1.45, 0.11, 0.6, 0.12);
    bp(paint, side * 1.14, 1.5, -1.46, 0.12, 0.35, 0.59);
  }
  const wing = bp(paint, 0, 1.47, -1.5, 2.39, 0.16, 0.52);
  wing.rotation.x = -0.13;
  bp(trim, 0, 1.545, -1.5, 0.36, 0.024, 0.5);
  const brake = new THREE.MeshStandardMaterial({
    color: '#ce2238',
    emissive: '#ff243c',
    emissiveIntensity: 0.28,
    roughness: 0.2,
    metalness: 0.2,
  });
  const headlight = new THREE.MeshStandardMaterial({
    color: '#fff2cf',
    emissive: '#fff0bd',
    emissiveIntensity: 1.2,
    roughness: 0.14,
  });
  for (const side of [-1, 1]) {
    bp(carbon, side * 0.57, 0.96, 1.591, 0.43, 0.24, 0.1);
    bp(headlight, side * 0.57, 0.97, 1.65, 0.35, 0.13, 0.03);
    bp(carbon, side * 0.77, 0.94, -1.31, 0.35, 0.2, 0.1);
    bp(brake, side * 0.77, 0.955, -1.37, 0.28, 0.09, 0.045);
    const exhaust = mesh(
      body,
      new THREE.CylinderGeometry(0.155, 0.155, 0.4, 16),
      chrome,
      side * 0.5,
      0.02,
      -1.76,
    );
    exhaust.rotation.x = Math.PI / 2;
    const hole = mesh(body, new THREE.CircleGeometry(0.12, 16), carbon, side * 0.5, 0.02, -1.97);
    hole.rotation.y = Math.PI;
  }

  const wheels: WheelRig[] = [];
  const wheelRubber = new THREE.CylinderGeometry(0.49, 0.49, 0.38, 24);
  const wheelShoulder = new THREE.TorusGeometry(0.385, 0.135, 10, 24);
  const wheelRim = new THREE.CylinderGeometry(0.295, 0.295, 0.415, 20);
  const wheelDish = new THREE.CylinderGeometry(0.228, 0.228, 0.428, 20);
  for (const side of [-1, 1])
    for (const front of [false, true]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.13, 0.52, front ? 1.04 : -1.04);
      pivot.name = front ? `steer-${side}` : `rear-${side}`;
      root.add(pivot);
      const spin = new THREE.Group();
      pivot.add(spin);
      mesh(spin, wheelRubber, tire, 0, 0, 0).rotation.z = Math.PI / 2;
      for (const face of [-1, 1])
        mesh(spin, wheelShoulder, tireEdge, face * 0.115, 0, 0).rotation.y = Math.PI / 2;
      mesh(spin, wheelRim, chrome, 0, 0, 0).rotation.z = Math.PI / 2;
      mesh(spin, wheelDish, rimDark, 0, 0, 0).rotation.z = Math.PI / 2;
      for (let i = 0; i < 5; i++) {
        const spoke = mesh(spin, box, chrome, side * 0.222, 0, 0, 0.024, 0.075, 0.49);
        spoke.rotation.x = (i * Math.PI) / 5;
      }
      const cap = mesh(spin, new THREE.CylinderGeometry(0.085, 0.085, 0.455, 12), paint, 0, 0, 0);
      cap.rotation.z = Math.PI / 2;
      // A sidewall stripe makes actual wheel spin legible at low speeds.
      mesh(spin, unit, cream, side * 0.207, 0.35, 0, 0.012, 0.075, 0.15);
      wheels.push({ pivot, spin, front, side });
    }

  const driver = new THREE.Group();
  driver.position.set(0, 0.89, -0.21);
  driver.name = 'driver';
  body.add(driver);
  mesh(driver, unit, suit, 0, 0.16, 0, 0.86, 0.73, 0.56);
  mesh(driver, unit, cream, 0, 0.2, 0.291, 0.075, 0.55, 0.025);
  for (const side of [-1, 1]) {
    const arm = mesh(driver, unit, cream, side * 0.49, 0.16, 0.37, 0.23, 0.25, 0.67);
    arm.rotation.x = -0.22;
    arm.rotation.y = -side * 0.17;
    mesh(driver, sphere, carbon, side * 0.42, 0.18, 0.65, 0.15, 0.14, 0.17);
  }
  const helmet = new THREE.Group();
  helmet.position.set(0, 0.75, 0);
  helmet.name = 'helmet';
  driver.add(helmet);
  mesh(helmet, sphere, cream, 0, 0, 0, 0.605, 0.62, 0.59);
  const helmetShell = new THREE.SphereGeometry(1, 28, 18, 0, TAU, 0, Math.PI * 0.57);
  mesh(helmet, helmetShell, paint, 0, 0, 0, 0.617, 0.632, 0.602);
  const visorMaterial = new THREE.MeshPhysicalMaterial({
    color: '#102a39',
    metalness: 0.58,
    roughness: 0.045,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    envMapIntensity: 2.7,
  });
  mesh(
    helmet,
    new THREE.SphereGeometry(
      1,
      32,
      12,
      Math.PI * 0.105,
      Math.PI * 0.79,
      Math.PI * 0.38,
      Math.PI * 0.24,
    ),
    visorMaterial,
    0,
    -0.01,
    0,
    0.631,
    0.637,
    0.619,
  );
  for (const side of [-1, 1])
    mesh(helmet, sphere, chrome, side * 0.59, -0.075, 0.075, 0.073, 0.073, 0.06);
  mesh(helmet, unit, carbon, 0, -0.29, 0.49, 0.23, 0.06, 0.075);
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, 1.02, 0.49);
  steeringWheel.rotation.x = -0.85;
  body.add(steeringWheel);
  mesh(steeringWheel, new THREE.TorusGeometry(0.3, 0.04, 8, 24), carbon, 0, 0, 0);
  mesh(steeringWheel, unit, chrome, 0, 0, 0, 0.53, 0.065, 0.07);
  mesh(steeringWheel, sphere, paint, 0, 0, 0.025, 0.11, 0.11, 0.035);

  const boost = new THREE.Group();
  boost.name = 'boost';
  boost.visible = false;
  body.add(boost);
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: '#49aaff',
    transparent: true,
    opacity: 0.63,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flameCore = new THREE.MeshBasicMaterial({
    color: '#d4f7ff',
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (const side of [-1, 1]) {
    const flame = mesh(
      boost,
      new THREE.ConeGeometry(0.24, 1.65, 12),
      flameMaterial,
      side * 0.5,
      0.02,
      -2.47,
    );
    flame.rotation.x = -Math.PI / 2;
    flame.castShadow = false;
    const core = mesh(
      boost,
      new THREE.ConeGeometry(0.125, 0.95, 10),
      flameCore,
      side * 0.5,
      0.02,
      -2.15,
    );
    core.rotation.x = -Math.PI / 2;
    core.castShadow = false;
  }
  const shieldMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader:
      'varying vec3 vNormal; varying vec3 vView; void main(){ vec4 p=modelViewMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*normal);vView=-p.xyz;gl_Position=projectionMatrix*p;}',
    fragmentShader:
      'varying vec3 vNormal;varying vec3 vView;uniform float uTime;void main(){float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),2.1);float pulse=.86+.14*sin(uTime*3.);gl_FragColor=vec4(vec3(.3,.82,1.)*(.4+rim),(.025+rim*.46)*pulse);}',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(2.05, 24, 16), shieldMaterial);
  shield.position.y = 1.15;
  shield.scale.set(1, 0.83, 1.15);
  shield.visible = false;
  root.add(shield);

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 6, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(0,0,0,0.6)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.28)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 5.2),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.02;
  root.add(shadow);
  root.userData.skin = skinId;
  root.userData.rig = {
    body,
    driver,
    helmet,
    steeringWheel,
    wheels,
    brake,
    shield,
    shieldMaterial,
    boost,
    speed: 0,
    previousSpeed: 0,
    previousHeading: 0,
    steering: 0,
    pitch: 0,
    roll: 0,
    suspension: 0,
    suspensionVelocity: 0,
    impact: 0,
    initialized: false,
    trailTime: 0,
    dustTime: 0,
  } satisfies KartRig;
  // Bake decorative parts per material; animation pivots stay independent.
  const sourceGeometries = new Set<THREE.BufferGeometry>();
  for (const group of [
    body,
    driver,
    helmet,
    steeringWheel,
    boost,
    ...wheels.map((wheel) => wheel.spin),
  ])
    mergeStaticChildren(group, sourceGeometries);
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) sourceGeometries.delete(object.geometry);
  });
  sourceGeometries.forEach((geometry) => geometry.dispose());
  return root;
}

/** Runs only visual springs: these never change authoritative collision positions. */
export function updateKartVisual(
  kart: THREE.Group,
  motion: KartMotion,
  dt: number,
  time: number,
  reducedMotion: boolean,
) {
  const rig = kart.userData.rig as KartRig;
  if (!rig.initialized) {
    rig.speed = motion.speed;
    rig.previousSpeed = motion.speed;
    rig.previousHeading = motion.heading;
    rig.initialized = true;
  }
  const step = Math.max(dt, 1 / 240);
  const turnDelta = Math.atan2(
    Math.sin(motion.heading - rig.previousHeading),
    Math.cos(motion.heading - rig.previousHeading),
  );
  const inferredSteering = clamp(turnDelta / step / 1.6, -1, 1);
  const steering = Number.isFinite(motion.steering) ? motion.steering! : inferredSteering;
  const previousVisualSpeed = rig.speed;
  rig.speed = damp(rig.speed, motion.speed, 13, dt);
  const acceleration = clamp((rig.speed - previousVisualSpeed) / step, -30, 25);
  rig.steering = damp(rig.steering, steering, 13, dt);
  const pace = Math.min(Math.abs(rig.speed) / 34, 1);
  const impact = clamp(motion.impact ?? (motion.stun > 0 ? 0.18 : 0), 0, 1);
  if (impact > rig.impact + 0.07) rig.suspensionVelocity += (impact - rig.impact) * 1.1;
  rig.impact = impact;
  const animationScale = reducedMotion ? 0.32 : 1;
  rig.pitch = damp(rig.pitch, clamp(acceleration * 0.0026, -0.065, 0.065) * animationScale, 7, dt);
  rig.roll = damp(
    rig.roll,
    (rig.steering * pace * 0.09 + (motion.drifting ? rig.steering * 0.045 : 0)) * animationScale,
    8,
    dt,
  );
  // Semi-implicit damped spring stays stable across uneven render frame times.
  const springStep = Math.min(dt, 1 / 30);
  rig.suspensionVelocity += (-95 * rig.suspension - 15 * rig.suspensionVelocity) * springStep;
  rig.suspension = clamp(rig.suspension + rig.suspensionVelocity * springStep, -0.04, 0.12);
  const engine = (Math.sin(time * 31) + Math.sin(time * 47) * 0.5) * pace * 0.006 * animationScale;
  rig.body.position.y = 0.55 + rig.suspension * animationScale + engine;
  rig.body.rotation.x = rig.pitch;
  rig.body.rotation.z = rig.roll;
  rig.driver.rotation.z = damp(
    rig.driver.rotation.z,
    -rig.steering * pace * 0.13 * animationScale,
    7,
    dt,
  );
  rig.driver.rotation.x = damp(rig.driver.rotation.x, -rig.pitch * 0.6, 6, dt);
  rig.helmet.rotation.y = damp(rig.helmet.rotation.y, rig.steering * 0.19, 5, dt);
  rig.helmet.rotation.z = damp(rig.helmet.rotation.z, -rig.roll * 0.5, 6, dt);
  rig.steeringWheel.rotation.z = -rig.steering * 0.58;
  for (const wheel of rig.wheels) {
    wheel.pivot.rotation.y = wheel.front ? rig.steering * 0.42 : 0;
    wheel.spin.rotation.x = (wheel.spin.rotation.x + (rig.speed * dt) / 0.52) % TAU;
    wheel.pivot.position.y =
      0.52 +
      Math.sin(time * 19 + wheel.side + (wheel.front ? 1.8 : 0)) * pace * 0.012 * animationScale;
  }
  const brakeTarget = acceleration < -4 && Math.abs(motion.speed) > 3 ? 3.5 : 0.32;
  rig.brake.emissiveIntensity = damp(rig.brake.emissiveIntensity, brakeTarget, 20, dt);
  rig.boost.visible = motion.boost > 0;
  rig.boost.scale.z = reducedMotion
    ? 1
    : 1 + Math.sin(time * 39) * 0.15 + Math.sin(time * 61) * 0.06;
  rig.shield.visible = motion.shield > 0;
  rig.shieldMaterial.uniforms.uTime.value = reducedMotion ? 0 : time;
  rig.previousSpeed = motion.speed;
  rig.previousHeading = motion.heading;
}

class ParticlePool {
  readonly object: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private alphas: Float32Array;
  private velocity: Float32Array;
  private life: Float32Array;
  private initialLife: Float32Array;
  private baseSize: Float32Array;
  private cursor = 0;
  constructor(
    private count: number,
    private glow: boolean,
  ) {
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);
    this.velocity = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.initialLife = new Float32Array(count);
    this.baseSize = new Float32Array(count);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'aColor',
      new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      'aAlpha',
      new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage),
    );
    const material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 480 }, uGlow: { value: glow ? 1 : 0 } },
      vertexShader:
        'attribute vec3 aColor;attribute float aSize;attribute float aAlpha;uniform float uScale;varying vec3 vColor;varying float vAlpha;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vColor=aColor;vAlpha=aAlpha;gl_PointSize=min(95.,aSize*uScale/max(1.,-mv.z));gl_Position=projectionMatrix*mv;}',
      fragmentShader:
        'varying vec3 vColor;varying float vAlpha;uniform float uGlow;void main(){float d=length(gl_PointCoord-.5)*2.;float soft=pow(max(0.,1.-d),mix(1.2,2.3,uGlow));gl_FragColor=vec4(vColor,soft*vAlpha);}',
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.object = new THREE.Points(geometry, material);
    this.object.frustumCulled = false;
    this.object.renderOrder = glow ? 4 : 3;
  }
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: THREE.Color,
    size: number,
    duration: number,
  ) {
    const index = this.cursor++ % this.count,
      j = index * 3;
    this.positions[j] = x;
    this.positions[j + 1] = y;
    this.positions[j + 2] = z;
    this.velocity[j] = vx;
    this.velocity[j + 1] = vy;
    this.velocity[j + 2] = vz;
    this.colors[j] = color.r;
    this.colors[j + 1] = color.g;
    this.colors[j + 2] = color.b;
    this.sizes[index] = this.baseSize[index] = size;
    this.life[index] = this.initialLife[index] = duration;
  }
  update(dt: number, height: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      this.life[i] = Math.max(0, this.life[i] - dt);
      const j = i * 3,
        fraction = this.life[i] / this.initialLife[i];
      this.positions[j] += this.velocity[j] * dt;
      this.positions[j + 1] += this.velocity[j + 1] * dt;
      this.positions[j + 2] += this.velocity[j + 2] * dt;
      this.velocity[j + 1] += (this.glow ? -3.5 : 0.22) * dt;
      this.sizes[i] =
        this.baseSize[i] * (this.glow ? 0.6 + fraction * 0.4 : 1 + (1 - fraction) * 2.1);
      this.alphas[i] = fraction * (this.glow ? 0.95 : 0.26);
    }
    this.object.geometry.getAttribute('position').needsUpdate = true;
    this.object.geometry.getAttribute('aColor').needsUpdate = true;
    this.object.geometry.getAttribute('aSize').needsUpdate = true;
    this.object.geometry.getAttribute('aAlpha').needsUpdate = true;
    (this.object.material as THREE.ShaderMaterial).uniforms.uScale.value = height;
  }
  clear() {
    this.life.fill(0);
    this.alphas.fill(0);
    this.sizes.fill(0);
  }
}

/** Two fixed-size GPU pools keep drift smoke, sparks and exhaust trails allocation-free. */
export class KartParticles {
  readonly root = new THREE.Group();
  private sparks = new ParticlePool(240, true);
  private smoke = new ParticlePool(180, false);
  private cyan = new THREE.Color('#8bddff');
  private gold = new THREE.Color('#ffb845');
  private dust = new THREE.Color('#bcae92');
  private water = new THREE.Color('#91a7bd');
  private timers = new Map<string, number>();
  private skid: THREE.InstancedMesh;
  private skidOpacity = new Float32Array(300);
  private skidLife = new Float32Array(300);
  private skidIndex = 0;
  private dummy = new THREE.Object3D();
  private random = 7283;
  constructor(scene: THREE.Scene) {
    this.root.add(this.sparks.object, this.smoke.object);
    const geometry = new THREE.PlaneGeometry(0.21, 1.3);
    geometry.rotateX(-Math.PI / 2);
    geometry.setAttribute(
      'aOpacity',
      new THREE.InstancedBufferAttribute(this.skidOpacity, 1).setUsage(THREE.DynamicDrawUsage),
    );
    const material = new THREE.ShaderMaterial({
      vertexShader:
        'attribute float aOpacity;varying float vAlpha;varying vec2 vUv;void main(){vAlpha=aOpacity;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
      fragmentShader:
        'varying float vAlpha;varying vec2 vUv;void main(){float edge=smoothstep(0.,.2,vUv.x)*smoothstep(0.,.2,1.-vUv.x);gl_FragColor=vec4(.025,.03,.045,vAlpha*edge);}',
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.skid = new THREE.InstancedMesh(geometry, material, 300);
    this.skid.frustumCulled = false;
    this.skid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < 300; i++) this.skid.setMatrixAt(i, this.dummy.matrix);
    this.root.add(this.skid);
    scene.add(this.root);
  }
  private rand() {
    this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0;
    return this.random / 4294967296;
  }
  emit(racer: Racer, kart: THREE.Group, dt: number, track: TrackId, reducedMotion: boolean) {
    if (reducedMotion) return;
    const pace = Math.abs(racer.speed);
    const active = (racer.drifting && pace > 10) || racer.boost > 0 || (racer.impact ?? 0) > 0.2;
    if (!active) {
      this.timers.set(racer.id, 0);
      return;
    }
    let timer = (this.timers.get(racer.id) ?? 0) + dt;
    const interval = racer.boost > 0 ? 0.035 : 0.055;
    const sin = Math.sin(kart.rotation.y),
      cos = Math.cos(kart.rotation.y);
    let emitted = 0;
    while (timer >= interval && emitted++ < 3) {
      timer -= interval;
      for (const side of [-1, 1]) {
        const rear = racer.boost > 0 ? -1.85 : -1.1;
        const lateral = racer.boost > 0 ? side * 0.5 : side * 1.15;
        const x = kart.position.x + cos * lateral + sin * rear;
        const z = kart.position.z - sin * lateral + cos * rear;
        if (racer.boost > 0 || racer.drifting || (racer.impact ?? 0) > 0.2) {
          const color =
            (racer.impact ?? 0) > 0.2 || racer.driftCharge > 1.2 ? this.gold : this.cyan;
          const scatter = (this.rand() - 0.5) * 2.4;
          this.sparks.emit(
            x,
            racer.boost > 0 ? 0.65 : 0.19,
            z,
            -sin * 4 + cos * scatter,
            0.4 + this.rand() * 1.6,
            -cos * 4 - sin * scatter,
            color,
            racer.boost > 0 ? 0.42 : 0.19,
            0.2 + this.rand() * 0.24,
          );
        }
        if (racer.drifting && pace > 10) {
          this.smoke.emit(
            x,
            0.2,
            z,
            -sin * 1.3 + cos * side,
            0.45 + this.rand() * 0.5,
            -cos * 1.3 - sin * side,
            track === 'midnight' ? this.water : this.dust,
            0.45 + this.rand() * 0.25,
            0.65 + this.rand() * 0.3,
          );
          const index = this.skidIndex++ % 300;
          this.dummy.position.set(x, 0.074, z);
          this.dummy.rotation.set(0, kart.rotation.y, 0);
          this.dummy.scale.set(1, 1, Math.max(0.7, (pace * interval) / 1.3));
          this.dummy.updateMatrix();
          this.skid.setMatrixAt(index, this.dummy.matrix);
          this.skidLife[index] = 4.5;
        }
      }
    }
    this.timers.set(racer.id, timer);
  }
  update(dt: number, height: number) {
    this.sparks.update(dt, height);
    this.smoke.update(dt, height);
    for (let i = 0; i < 300; i++) {
      this.skidLife[i] = Math.max(0, this.skidLife[i] - dt);
      this.skidOpacity[i] = Math.min(this.skidLife[i], 1) * 0.2;
    }
    this.skid.geometry.getAttribute('aOpacity').needsUpdate = true;
    this.skid.instanceMatrix.needsUpdate = true;
  }
  clear() {
    this.sparks.clear();
    this.smoke.clear();
    this.skidLife.fill(0);
    this.timers.clear();
  }
}
