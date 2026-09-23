import * as THREE from 'three';
import { getTrack } from '../shared';
import type { TrackId, TrackSample } from '../shared';
import { sampleTrack, trackLength, trackSamples } from './simulation';

type Shape = 'box' | 'cylinder' | 'cone' | 'rock' | 'ring';
type Anchor = { x: number; z: number; heading: number };
type Batch = { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; matrices: THREE.Matrix4[] };
const UP = new THREE.Vector3(0, 1, 0);

/** Authored landmarks share geometry and materials; there are no extra render passes. */
class LandmarkBatch {
  private batches = new Map<string, Batch>();
  private transform = new THREE.Object3D();
  private delta = new THREE.Vector3();
  private bounds = new THREE.Box3();
  private samples: TrackSample[];
  private clearance: number;
  constructor(id: TrackId) {
    this.samples = trackSamples(id);
    this.clearance = getTrack(id).width / 2 + 6.2;
  }
  private colorMaterial(color: string, glow: boolean) {
    return new THREE.MeshStandardMaterial({ color, roughness: glow ? .37 : .72, metalness: glow ? .3 : .06,
      ...(glow ? { emissive: color, emissiveIntensity: 1.5 } : {}) });
  }
  add(shape: Shape, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, heading = 0, rx = 0, rz = 0, glow = false) {
    this.transform.position.set(x, y, z);
    this.transform.scale.set(sx, sy, sz);
    this.transform.rotation.set(rx, heading, rz);
    this.transform.updateMatrix();
    return this.matrix(shape, color, this.transform.matrix, glow);
  }
  matrix(shape: Shape, color: string, matrix: THREE.Matrix4, glow = false) {
    const key = `${shape}:${color}:${glow}`;
    let batch = this.batches.get(key);
    if (!batch) {
      const geometry = shape === 'cylinder' ? new THREE.CylinderGeometry(1, 1, 1, 16)
        : shape === 'cone' ? new THREE.ConeGeometry(1, 1, 8)
        : shape === 'rock' ? new THREE.IcosahedronGeometry(1, 0)
        : shape === 'ring' ? new THREE.TorusGeometry(1, .075, 6, 20)
        : new THREE.BoxGeometry(1, 1, 1);
      batch = { geometry, material: this.colorMaterial(color, glow), matrices: [] };
      geometry.computeBoundingBox();
      this.batches.set(key, batch);
    }
    this.bounds.copy(batch.geometry.boundingBox!).applyMatrix4(matrix);
    // Ground scenery stays outside every branch, not just its anchor's road edge.
    // Gates, cranes and roofs can cross above the 8.5 m camera-clearance plane.
    if (this.bounds.min.y < 8.5) {
      for (const sample of this.samples) {
        const dx = Math.max(this.bounds.min.x - sample.x, 0, sample.x - this.bounds.max.x);
        const dz = Math.max(this.bounds.min.z - sample.z, 0, sample.z - this.bounds.max.z);
        if (dx * dx + dz * dz < this.clearance * this.clearance) return false;
      }
    }
    batch.matrices.push(matrix.clone());
    return true;
  }
  beam(a: THREE.Vector3, b: THREE.Vector3, width: number, color: string, glow = false) {
    this.delta.subVectors(b, a);
    this.transform.position.copy(a).add(b).multiplyScalar(.5);
    this.transform.scale.set(width, this.delta.length(), width);
    this.transform.quaternion.setFromUnitVectors(UP, this.delta.normalize());
    this.transform.updateMatrix();
    this.matrix('box', color, this.transform.matrix, glow);
  }
  finish(root: THREE.Group) {
    for (const batch of this.batches.values()) {
      if (!batch.matrices.length) { batch.geometry.dispose(); batch.material.dispose(); continue; }
      const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
    this.batches.clear();
  }
}

function anchorAt(id: TrackId, meters: number, lateral = 0): Anchor {
  const point = sampleTrack(id, meters);
  return { x: point.x + Math.cos(point.heading) * lateral, z: point.z - Math.sin(point.heading) * lateral, heading: point.heading };
}
function point(anchor: Anchor, x: number, y: number, z: number) {
  return new THREE.Vector3(anchor.x + Math.cos(anchor.heading) * x + Math.sin(anchor.heading) * z, y, anchor.z - Math.sin(anchor.heading) * x + Math.cos(anchor.heading) * z);
}
function local(batch: LandmarkBatch, anchor: Anchor, shape: Shape, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0, glow = false) {
  const p = point(anchor, x, y, z);
  return batch.add(shape, color, p.x, p.y, p.z, sx, sy, sz, anchor.heading + ry, rx, rz, glow);
}

/** Excludes background trees/rocks/buildings from the landmark footprints. */
export function sceneryReservations(id: TrackId) {
  const length = trackLength(id);
  const reservations: { x: number; z: number; radius: number }[] = [];
  for (const meters of [20, 50, 80]) for (const side of [-1, 1]) {
    const a = anchorAt(id, meters, side * 26);
    reservations.push({ x: a.x, z: a.z, radius: id === 'midnight' ? 27 : 21 });
  }
  for (const fraction of [.26, .39, .61, .78]) {
    const a = anchorAt(id, fraction * length, 23);
    reservations.push({ x: a.x, z: a.z, radius: 18 });
  }
  return reservations;
}

function sign(root: THREE.Group, anchor: Anchor, label: string, subtitle: string, color: string, width: number, y: number, localZ = 0) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#152a2e'; ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = color; ctx.fillRect(0, 0, 12, 256); ctx.fillRect(1012, 0, 12, 256);
  ctx.fillStyle = '#fff5d6'; ctx.font = '900 84px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 512, 100, 936);
  ctx.fillStyle = color; ctx.font = '700 28px sans-serif'; ctx.fillText(subtitle, 512, 190, 936);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .65, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: texture, emissiveIntensity: .2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), material);
  mesh.position.copy(point(anchor, 0, y, localZ)); mesh.rotation.y = anchor.heading + Math.PI;
  root.add(mesh);
}

function hut(batch: LandmarkBatch, anchor: Anchor, color: string) {
  if (!local(batch, anchor, 'box', '#cda67c', 0, .35, 0, 6.8, .7, 7.2)) return;
  local(batch, anchor, 'box', color, 0, 2.5, 0, 5.8, 4.2, 5.7);
  for (let i = -2; i <= 2; i++) local(batch, anchor, 'box', '#f5e9ce', i * 1.1, 2.55, -2.9, .07, 4, .055);
  local(batch, anchor, 'box', '#fff4d9', 0, 5.1, 0, 3.8, .3, 6.6, 0, 0, .46);
  local(batch, anchor, 'box', '#fff4d9', -2.3, 4.63, 0, 2.3, .3, 6.6, 0, 0, -.46);
  local(batch, anchor, 'box', '#2a6973', 0, 2.45, -2.96, 1.6, 2.7, .09);
  local(batch, anchor, 'box', '#fff1b8', 1.95, 3.1, -2.96, 1.1, 1.1, .09);
  local(batch, anchor, 'box', '#e7c890', 0, .72, -3.7, 2.7, .3, 1.2);
  local(batch, anchor, 'box', '#ef9277', -4.3, 1.7, -1, .65, 3.4, .16, .15, 0, -.12);
  local(batch, anchor, 'box', '#c5e589', -3.6, 1.5, -1, .6, 3, .16, -.1, 0, -.15);
}

function lighthouse(batch: LandmarkBatch, root: THREE.Group, anchor: Anchor) {
  local(batch, anchor, 'rock', '#97a092', 0, 1, 0, 9, 2.2, 9);
  local(batch, anchor, 'cylinder', '#e8ddc2', 0, 2, 0, 5, 3, 5);
  for (let i = 0; i < 6; i++) local(batch, anchor, 'cylinder', i % 2 ? '#ef8066' : '#fff3d7', 0, 5 + i * 4, 0, 3.25 - i * .21, 4.1, 3.25 - i * .21);
  local(batch, anchor, 'cylinder', '#f6eacb', 0, 27.5, 0, 4, .75, 4);
  local(batch, anchor, 'cylinder', '#38505a', 0, 29.1, 0, 2.25, 3, 2.25);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    local(batch, anchor, 'box', '#ffe595', Math.cos(angle) * 2.27, 29.2, Math.sin(angle) * 2.27, 1.25, 1.85, .075, -angle + Math.PI / 2, 0, 0, true);
    local(batch, anchor, 'cylinder', '#fff4dc', Math.cos(angle) * 3.7, 28.4, Math.sin(angle) * 3.7, .075, 1.2, .075);
  }
  local(batch, anchor, 'ring', '#fff0d5', 0, 28.9, 0, 3.8, 3.8, 3.8, 0, Math.PI / 2);
  local(batch, anchor, 'cone', '#ea7965', 0, 32, 0, 3.1, 3, 3.1);
  local(batch, anchor, 'cylinder', '#fff0d5', 0, 34, 0, .09, 2, .09);
  const welcome = { ...anchor, z: anchor.z - 6.5 };
  sign(root, welcome, 'SUNSET BAY', 'COASTAL RACING CLUB', '#bdf04e', 13, 4.5);
}

function coast(batch: LandmarkBatch, root: THREE.Group, id: TrackId) {
  lighthouse(batch, root, anchorAt(id, 72, -30));
  for (let p = 15; p <= 93; p += 6) {
    const a = anchorAt(id, p, 20);
    local(batch, a, 'box', '#b88b62', 0, .27, 0, 8.3, .4, 6.3);
    for (let board = -3; board <= 3; board++) local(batch, a, 'box', '#d6b183', 0, .49, board * .83, 8.1, .075, .69);
    for (const side of [-1, 1]) {
      local(batch, a, 'cylinder', '#f5e3bd', side * 3.9, 1.24, -2.8, .14, 1.65, .14);
      local(batch, a, 'box', '#f5e3bd', side * 3.9, 1.95, 0, .12, .12, 6.2);
    }
  }
  [28, 55, 83].forEach((p, i) => hut(batch, { ...anchorAt(id, p, 27), heading: anchorAt(id, p).heading + Math.PI / 2 }, ['#ef9b7d', '#75b3ac', '#b6cc7e'][i]));
  const surf = anchorAt(id, 45, 20);
  sign(root, { ...surf, heading: surf.heading + Math.PI / 2 }, 'SURF & GO', 'BOARDWALK • EST. 1986', '#f3be80', 8, 6.2);
  const length = trackLength(id);
  for (const fraction of [.26, .61, .78]) {
    const a = anchorAt(id, length * fraction, 24);
    hut(batch, a, fraction === .61 ? '#ebaa76' : '#6ab6b1');
    for (let i = 0; i < 4; i++) {
      local(batch, a, 'cylinder', '#f4e7c8', 7 + i * 3.8, 1.9, -1, .09, 3.8, .09);
      local(batch, a, 'cone', i % 2 ? '#f5d48f' : '#ea947c', 7 + i * 3.8, 3.7, -1, 2.2, .8, 2.2);
      local(batch, a, 'box', '#fff0ce', 7 + i * 3.8, .45, 1.6, 1.1, .17, 2.4, .15);
    }
  }
  // A broad festival gateway marks the eastern coastal sweep.
  const gate = anchorAt(id, length * .39);
  for (const side of [-1, 1]) local(batch, gate, 'cylinder', '#e9c797', side * 15.2, 5.5, 0, .4, 11, .4);
  local(batch, gate, 'box', '#de8267', 0, 10.8, 0, 31, 1.9, .4);
  sign(root, gate, 'BAY FESTIVAL', 'FOLLOW THE COAST', '#ffe5a8', 18, 10.8, -.25);
}

function mineFrame(batch: LandmarkBatch, a: Anchor, width: number, roof: boolean) {
  for (const side of [-1, 1]) {
    local(batch, a, 'box', '#674937', side * (width / 2 + 7.3), 5, 0, .9, 10, .9);
    batch.beam(point(a, side * (width / 2 + 7.3), 6.3, 0), point(a, side * (width / 2 + 5.8), 9.8, 0), .55, '#927054');
  }
  local(batch, a, 'box', '#987351', 0, 10, 0, width + 15.5, .85, 1.1);
  if (roof) local(batch, a, 'box', '#795540', 0, 11.05, 0, width + 16.5, 1.35, 9.1);
  local(batch, a, 'box', '#ffda80', 0, 9.48, 0, 2.1, .13, .3, 0, 0, 0, true);
}

function canyon(batch: LandmarkBatch, root: THREE.Group, id: TrackId) {
  const width = getTrack(id).width, length = trackLength(id);
  for (let p = 24; p <= 78; p += 9) mineFrame(batch, anchorAt(id, p), width, true);
  sign(root, anchorAt(id, 19), 'DUST MINE', 'KEEP THE ENGINE RUNNING', '#f3b477', width + 5, 13.6, -.2);
  const tower = anchorAt(id, 69, -31);
  for (const x of [-3.8, 3.8]) for (const z of [-3.8, 3.8]) {
    local(batch, tower, 'box', '#73533e', x, 9, z, .6, 18, .6);
    batch.beam(point(tower, x, 2, z), point(tower, -x, 15.5, z), .24, '#967353');
  }
  local(batch, tower, 'cylinder', '#a95941', 0, 19, 0, 6, 8, 6);
  local(batch, tower, 'cone', '#cf9569', 0, 24, 0, 6.5, 2.5, 6.5);
  for (const y of [16, 19, 22]) local(batch, tower, 'ring', '#5f4c40', 0, y, 0, 6.1, 6.1, 6.1, 0, Math.PI / 2);
  sign(root, tower, 'DUST CO.', 'ORE • WATER • SPEED', '#efbe82', 10, 19, -6.05);
  const arch = anchorAt(id, length * .39);
  for (const side of [-1, 1]) {
    local(batch, arch, 'rock', '#b7734d', side * 19.5, 6.5, 0, 4.8, 10, 5.4);
    local(batch, arch, 'rock', '#ce8e5c', side * 12, 15.2, 0, 8.1, 3.1, 4.6, side * .2);
  }
  local(batch, arch, 'rock', '#e0a471', 0, 16.5, 0, 7, 3.2, 4.5);
  for (const fraction of [.26, .61, .78]) {
    const a = anchorAt(id, fraction * length, 26);
    local(batch, a, 'rock', '#b77752', 0, 9, 0, 7, 14, 7);
    local(batch, a, 'rock', '#e0a574', 0, 22.2, 0, 9, 4.4, 8);
    local(batch, a, 'rock', '#965c43', 9, 4, 8, 4, 7.5, 4);
    local(batch, a, 'box', '#786350', -3, 1.25, -10, 6.1, 2.4, 3.5);
    for (const x of [-2, 2]) for (const z of [-11.2, -8.8]) local(batch, a, 'cylinder', '#353c3f', x, .5, z, .52, .3, .52, 0, 0, Math.PI / 2);
    for (let i = 0; i < 5; i++) local(batch, a, 'rock', '#a08360', -5 + i, 2.6, -10, 1.2, 1.1, 1);
    sign(root, { ...a, heading: a.heading + .15 }, fraction === .61 ? 'HAIRPIN' : 'RED ROCK PASS', 'BRAKE • TURN • BOOST', '#f2bb79', 10, 4.8, -14);
  }
}

function container(batch: LandmarkBatch, a: Anchor, x: number, z: number, y: number, color: string) {
  if (!local(batch, a, 'box', color, x, y + 1.9, z, 5.5, 3.8, 10.8)) return false;
  for (let rib = -5; rib <= 5; rib++) for (const side of [-1, 1]) local(batch, a, 'box', '#344857', x + side * 2.77, y + 1.9, z + rib * .94, .08, 3.35, .13);
  for (const side of [-1, 1]) local(batch, a, 'box', '#b6b5a2', x + side * 2.65, y + 1.9, z - 5.43, .1, 3.7, .07);
  local(batch, a, 'box', '#d9d8bb', x, y + 2.3, z - 5.43, 2.4, .47, .04);
  return true;
}

function crane(batch: LandmarkBatch, anchor: Anchor) {
  const steel = '#ddac58', shadowSteel = '#7c684b';
  for (const x of [-8, 8]) for (const z of [-7, 7]) {
    local(batch, anchor, 'box', shadowSteel, x, .6, z, 3.7, 1.2, 2.8);
    batch.beam(point(anchor, x, 1, z), point(anchor, x * .6, 27, z * .7), 1, steel);
  }
  for (const z of [-5, 5]) {
    batch.beam(point(anchor, -15, 28, z), point(anchor, 29, 28, z), 1.1, steel);
    batch.beam(point(anchor, -15, 31, z), point(anchor, 29, 31, z), .65, steel);
    for (let x = -14; x < 28; x += 5) batch.beam(point(anchor, x, 28, z), point(anchor, x + 5, 31, z), .28, shadowSteel);
  }
  local(batch, anchor, 'box', '#78d9d6', -3, 27.2, 0, 4.1, 3.9, 4.6);
  local(batch, anchor, 'box', '#2e5968', -3, 27.5, -2.35, 3.1, 2.1, .05);
  for (const z of [-4.5, 4.5]) batch.beam(point(anchor, 20, 28, z), point(anchor, 20, 13, z), .07, '#88a8b3');
  local(batch, anchor, 'box', '#8a69a7', 20, 12.5, 0, 5.3, 3.5, 10.4);
  local(batch, anchor, 'box', '#ffbc79', 29, 30.4, 0, .4, .45, 11, 0, 0, 0, true);
}

function neon(batch: LandmarkBatch, root: THREE.Group, id: TrackId) {
  const length = trackLength(id), width = getTrack(id).width;
  crane(batch, anchorAt(id, 65, -39));
  const harbor = new THREE.Mesh(new THREE.PlaneGeometry(43, 132), new THREE.MeshPhysicalMaterial({ color: '#164658', metalness: .4, roughness: .16, clearcoat: 1, envMapIntensity: 1.2 }));
  harbor.rotation.x = -Math.PI / 2; harbor.position.set(-68, -.035, 53); harbor.receiveShadow = true; root.add(harbor);
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const a = anchorAt(id, 15 + i * 19, side * 20);
    const grounded = container(batch, a, 0, 0, 0, i % 2 ? '#42677d' : '#805470');
    if (grounded && i % 2 === 0) container(batch, a, .5, 0, 3.85, '#427e7c');
    local(batch, a, 'box', side > 0 ? '#fb87c9' : '#79e7e2', -side * 2.85, 4.3, 0, .09, .12, 10.8, 0, 0, 0, true);
  }
  for (let p = 123; p <= 179; p += 8) {
    const a = anchorAt(id, p);
    for (const side of [-1, 1]) {
      local(batch, a, 'box', '#35465e', side * (width / 2 + 7.3), 5.1, 0, .6, 10.2, .6);
      local(batch, a, 'box', side > 0 ? '#cd8cfa' : '#61e3e6', side * (width / 2 + 6.91), 5.1, 0, .1, 9.1, .16, 0, 0, 0, true);
    }
    local(batch, a, 'box', '#35465e', 0, 10.2, 0, width + 15.2, .7, .65);
    local(batch, a, 'box', '#ca9efa', 0, 9.78, 0, width + 14.2, .12, .2, 0, 0, 0, true);
  }
  sign(root, anchorAt(id, 119), 'NIGHT SHIFT', 'DOCK 03 • STAY SHARP', '#c197ff', 16, 10.6);
  for (const [index, fraction] of [.26, .61, .78].entries()) {
    const a = anchorAt(id, length * fraction, 25);
    for (let stack = 0; stack < 3; stack++) for (let level = 0; level < 2; level++) container(batch, a, stack * 5.8, 0, level * 3.85, (stack + level) % 2 ? '#4a7a80' : '#786385');
    local(batch, a, 'box', '#63e0db', 5.8, 8.1, 0, 17.5, .17, 11, 0, 0, 0, true);
    sign(root, a, ['SECTOR 02', 'THE SWITCHBACK', 'FINAL DOCK'][index], 'NEON HARBOR • AFTER DARK', '#92f3db', 17, 9.8, -5.5);
  }
}

function turnSigns(batch: LandmarkBatch, root: THREE.Group, id: TrackId) {
  const samples = trackSamples(id), length = trackLength(id), width = getTrack(id).width;
  let lastSign = -50;
  for (let p = 115; p < length - 45; p += 25) {
    const before = sampleTrack(id, p - 14), current = sampleTrack(id, p), after = sampleTrack(id, p + 14);
    const turn = Math.atan2(Math.sin(after.heading - before.heading), Math.cos(after.heading - before.heading));
    if (Math.abs(turn) < .57 || p - lastSign < 60) continue;
    const side = turn > 0 ? -1 : 1;
    const a = anchorAt(id, p, side * (width / 2 + 9));
    // Other branches must also stay clear of the sign's ground footprint.
    if (samples.some((s: TrackSample) => Math.hypot(s.x - a.x, s.z - a.z) < width / 2 + 1.3)) continue;
    local(batch, a, 'box', '#d7cfb8', 0, 1.25, 0, .16, 2.5, .16);
    const facing = { ...a, heading: current.heading - turn * .4 };
    sign(root, facing, turn > 0 ? '❮ ❮ ❮' : '❯ ❯ ❯', 'APEX', id === 'midnight' ? '#b69bff' : '#ffc487', 4.3, 2.8);
    lastSign = p;
  }
}

export function buildTrackScenery(root: THREE.Group, id: TrackId) {
  const batch = new LandmarkBatch(id);
  if (id === 'coast') coast(batch, root, id);
  else if (id === 'canyon') canyon(batch, root, id);
  else neon(batch, root, id);
  turnSigns(batch, root, id);
  batch.finish(root);
}
