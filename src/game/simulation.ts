import { EMPTY_INPUT, LAPS, SKINS, getTrack } from '../shared.js';
import type {
  InputState,
  ItemKind,
  Player,
  Racer,
  RaceState,
  TrackId,
  TrackSample,
} from '../shared.js';

const TAU = Math.PI * 2;
const GATES_PER_LAP = 12;
const MAX_RACE_SECONDS = 240;
const FIXED_STEP = 1 / 60;
export const KART_HALF_WIDTH = 1.35;
export const KART_HALF_LENGTH = 1.8;
const trackCache = new Map<TrackId, TrackSample[]>();
const lengthCache = new Map<TrackId, number>();
interface RacerRuntime {
  nextGate: number;
  itemHeld: boolean;
  previousDrift: boolean;
  knockX: number;
  knockZ: number;
  offsetX: number;
  offsetZ: number;
  botLane: number;
  wasBot: boolean;
}
interface RaceRuntime {
  racers: Map<string, RacerRuntime>;
  seed: number;
}
export interface SerializableRaceRuntime {
  version: 1;
  seed: number;
  racers: Record<string, RacerRuntime>;
}
const runtimes = new WeakMap<RaceState, RaceRuntime>();
let raceSequence = 0;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const wrap = (n: number, length: number) => ((n % length) + length) % length;
const angleDelta = (a: number, b: number) => wrap(b - a + Math.PI, TAU) - Math.PI;
const distanceDelta = (a: number, b: number, length: number) =>
  wrap(b - a + length / 2, length) - length / 2;

function catmull(a: number, b: number, c: number, d: number, t: number): number {
  return (
    0.5 *
    (2 * b +
      (c - a) * t +
      (2 * a - 5 * b + 4 * c - d) * t * t +
      (-a + 3 * b - 3 * c + d) * t * t * t)
  );
}

function buildTrack(id: TrackId): void {
  if (trackCache.has(id)) return;
  const { points } = getTrack(id);
  const samples: TrackSample[] = [];
  let distance = 0;
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const p0 = points[(i + count - 1) % count];
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    const p3 = points[(i + 2) % count];
    for (let j = 0; j < 72; j++) {
      const t = j / 72;
      const x = catmull(p0[0], p1[0], p2[0], p3[0], t);
      const z = catmull(p0[1], p1[1], p2[1], p3[1], t);
      if (samples.length) {
        const prev = samples[samples.length - 1];
        distance += Math.hypot(x - prev.x, z - prev.z);
      }
      samples.push({ x, z, progress: distance, heading: 0 });
    }
  }
  const first = samples[0],
    last = samples[samples.length - 1];
  distance += Math.hypot(first.x - last.x, first.z - last.z);
  samples.forEach((sample, i) => {
    const before = samples[(i + samples.length - 1) % samples.length];
    const after = samples[(i + 1) % samples.length];
    sample.heading = Math.atan2(after.x - before.x, after.z - before.z);
  });
  trackCache.set(id, samples);
  lengthCache.set(id, distance);
}

/** Closed, dense centerline samples. The first point is not repeated at the end. */
export function trackSamples(id: TrackId): TrackSample[] {
  buildTrack(id);
  return trackCache.get(id)!;
}

export function trackLength(id: TrackId): number {
  buildTrack(id);
  return lengthCache.get(id)!;
}

/** Distance is in meters and wraps in both directions, including grid positions. */
export function sampleTrack(id: TrackId, progress: number): TrackSample {
  const samples = trackSamples(id);
  const length = trackLength(id);
  const p = wrap(Number.isFinite(progress) ? progress : 0, length);
  let lo = 0,
    hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (samples[mid].progress <= p) lo = mid;
    else hi = mid - 1;
  }
  const a = samples[lo],
    b = samples[(lo + 1) % samples.length];
  const bProgress = lo + 1 === samples.length ? length : b.progress;
  const t = (p - a.progress) / (bProgress - a.progress);
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    heading: a.heading + angleDelta(a.heading, b.heading) * t,
    progress: p,
  };
}

/** Project onto the road; the projected distance is used for gates and guardrails. */
export function nearestTrackPoint(
  id: TrackId,
  x: number,
  z: number,
): TrackSample & { distance: number; lateral: number } {
  const samples = trackSamples(id),
    length = trackLength(id);
  let best = Infinity,
    result = samples[0];
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i],
      b = samples[(i + 1) % samples.length];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    const px = a.x + dx * t,
      pz = a.z + dz * t;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best) {
      best = d;
      result = {
        x: px,
        z: pz,
        heading: a.heading + angleDelta(a.heading, b.heading) * t,
        progress: a.progress + ((i + 1 === samples.length ? length : b.progress) - a.progress) * t,
      };
    }
  }
  return {
    ...result,
    distance: Math.sqrt(best),
    lateral: (x - result.x) * Math.cos(result.heading) - (z - result.z) * Math.sin(result.heading),
  };
}

function random(runtime: RaceRuntime): number {
  runtime.seed = (Math.imul(runtime.seed, 1664525) + 1013904223) >>> 0;
  return runtime.seed / 0x100000000;
}

function hash(text: string): number {
  let result = 2166136261;
  for (const char of text) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function runtimeFor(state: RaceState): RaceRuntime {
  let runtime = runtimes.get(state);
  if (!runtime) {
    runtime = {
      seed: hash(state.trackId + state.racers.map((r) => r.id).join('|')),
      racers: new Map(),
    };
    const gateDistance = trackLength(state.trackId) / GATES_PER_LAP;
    state.racers.forEach((r) =>
      runtime!.racers.set(r.id, {
        nextGate: Math.max(0, Math.floor(r.progress / gateDistance) + 1),
        itemHeld: false,
        previousDrift: false,
        knockX: 0,
        knockZ: 0,
        offsetX: 0,
        offsetZ: 0,
        botLane: nearestTrackPoint(state.trackId, r.x, r.z).lateral,
        wasBot: r.bot,
      }),
    );
    runtimes.set(state, runtime);
  }
  return runtime;
}

/** Persist alongside RaceState when an authoritative race moves between server instances. */
export function exportRaceRuntime(state: RaceState): SerializableRaceRuntime {
  const runtime = runtimeFor(state);
  return {
    version: 1,
    seed: runtime.seed,
    racers: Object.fromEntries([...runtime.racers].map(([id, racer]) => [id, { ...racer }])),
  };
}

/** Restore gate order, held buttons, random sequence and collision motion atomically. */
export function restoreRaceRuntime(state: RaceState, snapshot: SerializableRaceRuntime): void {
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !Number.isInteger(snapshot.seed) ||
    snapshot.seed < 0 ||
    snapshot.seed > 0xffffffff ||
    !snapshot.racers ||
    typeof snapshot.racers !== 'object' ||
    Array.isArray(snapshot.racers)
  )
    throw new Error('Invalid simulation runtime snapshot.');
  const racers = new Map<string, RacerRuntime>();
  for (const racer of state.racers) {
    const saved = snapshot.racers[racer.id];
    if (
      !saved ||
      !Number.isInteger(saved.nextGate) ||
      saved.nextGate < 0 ||
      saved.nextGate > LAPS * GATES_PER_LAP + 1 ||
      typeof saved.itemHeld !== 'boolean' ||
      typeof saved.previousDrift !== 'boolean' ||
      typeof saved.wasBot !== 'boolean' ||
      ![saved.knockX, saved.knockZ, saved.offsetX, saved.offsetZ, saved.botLane].every(
        Number.isFinite,
      )
    )
      throw new Error(`Invalid simulation runtime for racer ${racer.id}.`);
    racers.set(racer.id, {
      nextGate: saved.nextGate,
      itemHeld: saved.itemHeld,
      previousDrift: saved.previousDrift,
      knockX: saved.knockX,
      knockZ: saved.knockZ,
      offsetX: saved.offsetX,
      offsetZ: saved.offsetZ,
      botLane: saved.botLane,
      wasBot: saved.wasBot,
    });
  }
  runtimes.set(state, { seed: snapshot.seed, racers });
}

export function createRace(trackId: TrackId, players: Player[], fillBots = true): RaceState {
  const unique = players
    .filter((p, i, list) => list.findIndex((candidate) => candidate.id === p.id) === i)
    .slice(0, 6);
  const racers = [...unique];
  const botNames = ['Coco', 'Rocket', 'Mochi', 'Blitz', 'Nova', 'Pip'];
  for (let i = 0; fillBots && racers.length < 6; i++) {
    const id = `bot-${i}`;
    if (!racers.some((p) => p.id === id))
      racers.push({
        id,
        name: botNames[i % botNames.length],
        skin: SKINS[(i + 1) % SKINS.length].id,
        bot: true,
        ready: true,
      });
  }
  const length = trackLength(trackId);
  const state: RaceState = {
    id: globalThis.crypto?.randomUUID?.() ?? `race-${Date.now()}-${++raceSequence}`,
    trackId,
    phase: 'countdown',
    countdown: 3,
    elapsed: 0,
    racers: racers.map((p, i): Racer => {
      const progress = -6 - Math.floor(i / 2) * 5.5;
      const sample = sampleTrack(trackId, progress),
        lane = i % 2 === 0 ? -2.7 : 2.7;
      return {
        id: p.id,
        name: p.name,
        skin: p.skin,
        trail: p.trail ?? 'none',
        driver: p.driver ?? 'rookie',
        tire: p.tire ?? 'standard',
        bot: !!p.bot,
        x: sample.x + Math.cos(sample.heading) * lane,
        z: sample.z - Math.sin(sample.heading) * lane,
        heading: sample.heading,
        speed: 0,
        progress,
        lap: 1,
        position: i + 1,
        finished: false,
        finishTime: null,
        item: null,
        boost: 0,
        shield: 0,
        magnet: 0,
        stun: 0,
        driftCharge: 0,
        drifting: false,
        coins: 0,
        impact: 0,
        steering: 0,
      };
    }),
    pickups: Array.from({ length: 24 }, (_, i) => ({
      id: i,
      progress: ((i + 0.7) * length) / 24,
      availableAt: 0,
      kind: i % 3 === 0 ? ('item' as const) : ('coin' as const),
    })),
  };
  runtimeFor(state);
  return state;
}

function updateProgress(
  state: RaceState,
  racer: Racer,
  nextProgress: number,
  runtime: RacerRuntime,
): void {
  const previous = racer.progress;
  racer.progress = nextProgress;
  const gateDistance = trackLength(state.trackId) / GATES_PER_LAP;
  const gate = runtime.nextGate * gateDistance;
  // Gates must be crossed in order and forwards. Reversing across the line never adds a lap.
  if (previous <= gate && nextProgress >= gate && nextProgress > previous) {
    runtime.nextGate++;
    racer.lap = clamp(Math.floor((runtime.nextGate - 1) / GATES_PER_LAP) + 1, 1, LAPS);
    if (runtime.nextGate > LAPS * GATES_PER_LAP) {
      racer.finished = true;
      racer.finishTime = state.elapsed;
      racer.lap = LAPS;
      racer.progress = trackLength(state.trackId) * LAPS;
      racer.drifting = false;
    }
  }
}

function useItem(state: RaceState, racer: Racer): void {
  if (!racer.item) return;
  if (racer.item === 'boost') racer.boost = Math.max(racer.boost, 2.25);
  if (racer.item === 'shield') racer.shield = 6;
  if (racer.item === 'magnet') racer.magnet = Math.max(racer.magnet, 7);
  if (racer.item === 'rocket') {
    const target = state.racers
      .filter((other) => other.id !== racer.id && !other.finished && other.progress > racer.progress && other.progress - racer.progress < 65)
      .sort((a, b) => a.progress - b.progress)[0];
    if (target) {
      if (target.shield > 0) target.shield = 0;
      else {
        target.stun = Math.max(target.stun, 1.8);
        target.speed *= 0.4;
        target.impact = Math.max(target.impact ?? 0, 0.9);
      }
    } else racer.boost = Math.max(racer.boost, 1.1);
  }
  if (racer.item === 'pulse') {
    for (const other of state.racers) {
      if (
        other.id === racer.id ||
        other.finished ||
        Math.hypot(other.x - racer.x, other.z - racer.z) > 24
      )
        continue;
      if (other.shield > 0) other.shield = 0;
      else {
        other.stun = 1.3;
        other.speed *= 0.52;
      }
    }
    racer.boost = Math.max(racer.boost, 0.6);
  }
  racer.item = null;
}

interface Contact {
  x: number;
  z: number;
  depth: number;
}

/** Separating-axis contact for the same oriented footprint as the visible kart. */
function kartContact(a: Racer, b: Racer): Contact | null {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  if (dx * dx + dz * dz > 4 * (KART_HALF_WIDTH ** 2 + KART_HALF_LENGTH ** 2)) return null;
  const aRight = { x: Math.cos(a.heading), z: -Math.sin(a.heading) };
  const aForward = { x: Math.sin(a.heading), z: Math.cos(a.heading) };
  const bRight = { x: Math.cos(b.heading), z: -Math.sin(b.heading) };
  const bForward = { x: Math.sin(b.heading), z: Math.cos(b.heading) };
  let contact: Contact = { x: 0, z: 0, depth: Infinity };
  for (const axis of [aRight, aForward, bRight, bForward]) {
    const span =
      KART_HALF_WIDTH *
        (Math.abs(axis.x * aRight.x + axis.z * aRight.z) +
          Math.abs(axis.x * bRight.x + axis.z * bRight.z)) +
      KART_HALF_LENGTH *
        (Math.abs(axis.x * aForward.x + axis.z * aForward.z) +
          Math.abs(axis.x * bForward.x + axis.z * bForward.z));
    const projected = dx * axis.x + dz * axis.z;
    const depth = span - Math.abs(projected);
    if (depth <= 0) return null;
    if (depth < contact.depth) {
      const side = projected < 0 ? -1 : 1;
      contact = { x: axis.x * side, z: axis.z * side, depth };
    }
  }
  return contact;
}

function displace(racer: Racer, meta: RacerRuntime, x: number, z: number): void {
  racer.x += x;
  racer.z += z;
  // A bot's spline position retains the bump and eases back over the next second.
  if (racer.bot) {
    meta.offsetX += x;
    meta.offsetZ += z;
  }
}

function velocity(racer: Racer, meta: RacerRuntime): { x: number; z: number } {
  return {
    x: Math.sin(racer.heading) * racer.speed + meta.knockX,
    z: Math.cos(racer.heading) * racer.speed + meta.knockZ,
  };
}

function impulse(racer: Racer, meta: RacerRuntime, x: number, z: number): void {
  const forwardX = Math.sin(racer.heading),
    forwardZ = Math.cos(racer.heading);
  const longitudinal = x * forwardX + z * forwardZ;
  racer.speed = clamp(racer.speed + longitudinal, -12, 56);
  meta.knockX = clamp(meta.knockX + x - longitudinal * forwardX, -12, 12);
  meta.knockZ = clamp(meta.knockZ + z - longitudinal * forwardZ, -12, 12);
}

function resolveKartCollisions(state: RaceState, runtime: RaceRuntime): void {
  // Repeated position passes also resolve a small pack without stacking karts.
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < state.racers.length; i++) {
      const a = state.racers[i];
      if (a.finished) continue;
      for (let j = i + 1; j < state.racers.length; j++) {
        const b = state.racers[j];
        if (b.finished) continue;
        const contact = kartContact(a, b);
        if (!contact) continue;
        const ma = runtime.racers.get(a.id)!,
          mb = runtime.racers.get(b.id)!;
        const weightA = a.shield > 0 ? 0.3 : 1,
          weightB = b.shield > 0 ? 0.3 : 1;
        const totalWeight = weightA + weightB;
        const separation = contact.depth + 0.003;
        displace(
          a,
          ma,
          (-contact.x * separation * weightA) / totalWeight,
          (-contact.z * separation * weightA) / totalWeight,
        );
        displace(
          b,
          mb,
          (contact.x * separation * weightB) / totalWeight,
          (contact.z * separation * weightB) / totalWeight,
        );
        if (pass !== 0) continue;
        const va = velocity(a, ma),
          vb = velocity(b, mb);
        const closing = Math.max(0, (va.x - vb.x) * contact.x + (va.z - vb.z) * contact.z);
        const force = Math.min(27, (closing * 1.18) / totalWeight);
        impulse(a, ma, -contact.x * force * weightA, -contact.z * force * weightA);
        impulse(b, mb, contact.x * force * weightB, contact.z * force * weightB);
        const strength = clamp((closing + contact.depth * 3) / 27, 0.07, 1);
        a.impact = Math.max(a.impact ?? 0, strength * weightA);
        b.impact = Math.max(b.impact ?? 0, strength * weightB);
      }
    }
  }
}

function constrainToRoad(state: RaceState, racer: Racer, meta: RacerRuntime, dt: number): void {
  if (racer.finished) return;
  const road = nearestTrackPoint(state.trackId, racer.x, racer.z);
  const rail = getTrack(state.trackId).width / 2 + 4;
  if (road.distance <= rail) return;
  const side = Math.sign(road.lateral) || 1;
  const normalX = Math.cos(road.heading) * side,
    normalZ = -Math.sin(road.heading) * side;
  displace(racer, meta, road.x + normalX * rail - racer.x, road.z + normalZ * rail - racer.z);
  const motion = velocity(racer, meta);
  const outward = Math.max(0, motion.x * normalX + motion.z * normalZ);
  const protection = racer.shield > 0 ? 0.4 : 1;
  const force = Math.min(16, outward * 1.15) * protection;
  impulse(racer, meta, -normalX * force, -normalZ * force);
  racer.impact = Math.max(racer.impact ?? 0, clamp(outward / 23, 0.06, 1) * protection);
  const recovery = road.heading - side * 0.26;
  racer.heading += angleDelta(racer.heading, recovery) * Math.min(1, dt * 3.6);
}

function advanceRacer(
  state: RaceState,
  racer: Racer,
  input: InputState,
  dt: number,
  runtime: RaceRuntime,
): void {
  const meta = runtime.racers.get(racer.id)!;
  racer.impact = (racer.impact ?? 0) * Math.exp(-dt * 7);
  if (racer.impact < 0.005) racer.impact = 0;
  if (racer.finished) {
    racer.speed *= Math.exp(-dt * 3);
    racer.steering = (racer.steering ?? 0) * Math.exp(-dt * 9);
    return;
  }
  racer.boost = Math.max(0, racer.boost - dt);
  racer.shield = Math.max(0, racer.shield - dt);
  racer.magnet = Math.max(0, racer.magnet - dt);
  racer.stun = Math.max(0, racer.stun - dt);
  if (input.item && !meta.itemHeld) useItem(state, racer);
  meta.itemHeld = input.item;

  if (racer.bot) {
    const botIndex = state.racers.indexOf(racer);
    const here = sampleTrack(state.trackId, racer.progress),
      ahead = sampleTrack(state.trackId, racer.progress + 20);
    const curve = Math.abs(angleDelta(here.heading, ahead.heading));
    if (!meta.wasBot) {
      meta.botLane = nearestTrackPoint(state.trackId, racer.x, racer.z).lateral;
      meta.offsetX = 0;
      meta.offsetZ = 0;
    }
    let speedTarget =
      (29.5 + Math.sin(botIndex * 3) * 2.7) * (1 - Math.min(curve, 1) * 0.18) +
      (racer.boost > 0 ? 17 : 0) -
      (racer.stun > 0 ? 16 : 0);
    const laneLimit = getTrack(state.trackId).width / 2 - 1.65;
    let desiredLane = Math.sin(botIndex * 2.4 + racer.progress / 90) * 2.4;
    for (const other of state.racers) {
      if (other.id === racer.id || other.finished) continue;
      const dx = other.x - racer.x,
        dz = other.z - racer.z;
      const gap = dx * Math.sin(here.heading) + dz * Math.cos(here.heading);
      const across = dx * Math.cos(here.heading) - dz * Math.sin(here.heading);
      if (gap < -0.5 || gap > 23 || Math.abs(across) > 3.6) continue;
      const otherLane = meta.botLane + across;
      let side = Math.abs(across) > 0.25 ? -Math.sign(across) : botIndex % 2 === 0 ? 1 : -1;
      let target = clamp(otherLane + side * 3.9, -laneLimit, laneLimit);
      if (Math.abs(target - otherLane) < 3.1) {
        side *= -1;
        target = clamp(otherLane + side * 3.9, -laneLimit, laneLimit);
      }
      desiredLane = target;
      if (gap < 9 && Math.abs(across) < 2.8)
        speedTarget = Math.min(speedTarget, Math.max(5, other.speed + Math.max(0, gap - 4) * 1.8));
    }
    meta.botLane += clamp(desiredLane - meta.botLane, -3.8 * dt, 3.8 * dt);
    racer.speed += (speedTarget - racer.speed) * Math.min(1, dt * 1.2);
    const nextProgress = racer.progress + racer.speed * dt;
    const road = sampleTrack(state.trackId, nextProgress);
    meta.offsetX = (meta.offsetX + meta.knockX * dt) * Math.exp(-dt * 1.65);
    meta.offsetZ = (meta.offsetZ + meta.knockZ * dt) * Math.exp(-dt * 1.65);
    racer.x = road.x + Math.cos(road.heading) * meta.botLane + meta.offsetX;
    racer.z = road.z - Math.sin(road.heading) * meta.botLane + meta.offsetZ;
    const steering = clamp(
      angleDelta(racer.heading, road.heading) / Math.max(dt, 0.001) / 1.35 +
        (desiredLane - meta.botLane) * 0.13,
      -1,
      1,
    );
    racer.steering =
      (racer.steering ?? 0) + (steering - (racer.steering ?? 0)) * Math.min(1, dt * 9);
    racer.heading = road.heading;
    updateProgress(state, racer, nextProgress, meta);
    if (racer.item && random(runtime) < dt * 0.35) useItem(state, racer);
  } else {
    const roadBefore = nearestTrackPoint(state.trackId, racer.x, racer.z);
    const halfWidth = getTrack(state.trackId).width / 2;
    const offroad = roadBefore.distance > halfWidth - 0.65;
    const maxSpeed =
      (racer.boost > 0 ? 51 : 35) * (offroad ? 0.53 : 1) * (racer.stun > 0 ? 0.42 : 1);
    const acceleration = input.throttle ? (racer.boost > 0 ? 26 : 17) : 0;
    if (input.brake) racer.speed -= (racer.speed > 0 ? 31 : 11) * dt;
    else if (input.throttle) racer.speed += acceleration * dt;
    else racer.speed *= Math.exp(-dt * (offroad ? 1.5 : 0.48));
    if (racer.speed > maxSpeed)
      racer.speed += (maxSpeed - racer.speed) * Math.min(1, dt * (offroad ? 3 : 2));
    racer.speed = clamp(racer.speed, -9, racer.boost > 0 ? 54 : 39);
    // The chase camera looks along +Z, so +Y yaw points toward screen-left.
    // Keep wheel metadata in yaw coordinates; reversing flips body yaw, not wheel direction.
    const turn = Number(input.left) - Number(input.right);
    racer.steering = (racer.steering ?? 0) + (turn - (racer.steering ?? 0)) * Math.min(1, dt * 10);
    racer.drifting = input.drift && Math.abs(racer.speed) > 11 && turn !== 0 && !offroad;
    if (racer.drifting) racer.driftCharge = Math.min(2, racer.driftCharge + dt);
    if (!input.drift && meta.previousDrift && racer.driftCharge > 0.45) {
      racer.boost = Math.max(racer.boost, 0.6 + Math.min(racer.driftCharge, 1.6));
      racer.driftCharge = 0;
    } else if (!input.drift) racer.driftCharge = 0;
    meta.previousDrift = input.drift;
    const steerSpeed = 1.35 * Math.min(1, Math.abs(racer.speed) / 9) * (racer.drifting ? 1.32 : 1);
    racer.heading += turn * steerSpeed * dt * (racer.speed < 0 ? -1 : 1);
    racer.heading = wrap(racer.heading + Math.PI, TAU) - Math.PI;
    racer.x += (Math.sin(racer.heading) * racer.speed + meta.knockX) * dt;
    racer.z += (Math.cos(racer.heading) * racer.speed + meta.knockZ) * dt;
    const road = nearestTrackPoint(state.trackId, racer.x, racer.z);
    const delta = distanceDelta(roadBefore.progress, road.progress, trackLength(state.trackId));
    // A projection jump across a nearby road section cannot grant race progress.
    if (Math.abs(delta) < Math.abs(racer.speed) * dt * 2.5 + 0.5)
      updateProgress(state, racer, racer.progress + delta, meta);
  }
  meta.wasBot = racer.bot;
  meta.knockX *= Math.exp(-dt * 4.5);
  meta.knockZ *= Math.exp(-dt * 4.5);

  for (const pickup of state.pickups) {
    if (pickup.availableAt > state.elapsed || (pickup.kind === 'item' && racer.item)) continue;
    if (
      Math.abs(
        distanceDelta(
          wrap(racer.progress, trackLength(state.trackId)),
          pickup.progress,
          trackLength(state.trackId),
        ),
      ) > 4
    )
      continue;
    const point = sampleTrack(state.trackId, pickup.progress);
    if (Math.hypot(point.x - racer.x, point.z - racer.z) > (pickup.kind === 'coin' && racer.magnet > 0 ? 13 : 4.7)) continue;
    pickup.availableAt = state.elapsed + (pickup.kind === 'coin' ? 4 : 7);
    if (pickup.kind === 'coin') racer.coins++;
    else {
      const choices: ItemKind[] =
        racer.position > 3
          ? ['boost', 'boost', 'pulse', 'rocket', 'magnet']
          : ['boost', 'shield', 'pulse', 'rocket', 'magnet'];
      racer.item = choices[Math.floor(random(runtime) * choices.length)];
    }
  }
}

function rankRacers(state: RaceState): void {
  const ranked = [...state.racers].sort((a, b) => {
    if (a.finished && b.finished) return (a.finishTime ?? Infinity) - (b.finishTime ?? Infinity);
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.progress - a.progress;
  });
  ranked.forEach((racer, i) => {
    racer.position = i + 1;
  });
}

/** Advance the host-authoritative simulation. Bad or paused-tab deltas cannot teleport racers. */
export function stepRace(state: RaceState, inputs: Record<string, InputState>, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0 || state.phase === 'finished') return;
  const runtime = runtimeFor(state);
  let remaining = Math.min(dt, 0.1);
  while (remaining > 1e-8) {
    const step = Math.min(FIXED_STEP, remaining);
    remaining -= step;
    if (state.phase === 'countdown') {
      state.countdown = Math.max(0, state.countdown - step);
      if (state.countdown < 1e-8) {
        state.countdown = 0;
        state.phase = 'racing';
      }
      continue;
    }
    state.elapsed += step;
    for (const racer of state.racers)
      advanceRacer(state, racer, inputs[racer.id] ?? EMPTY_INPUT, step, runtime);
    resolveKartCollisions(state, runtime);
    for (const racer of state.racers)
      constrainToRoad(state, racer, runtime.racers.get(racer.id)!, step);
    rankRacers(state);
    if (state.elapsed >= MAX_RACE_SECONDS) {
      for (const racer of state.racers) {
        if (!racer.finished) {
          racer.finished = true;
          racer.finishTime = null;
          racer.drifting = false;
        }
      }
    }
    if (state.racers.every((r) => r.finished)) {
      state.phase = 'finished';
      break;
    }
  }
}
