import { EMPTY_INPUT, LAPS, SKINS, getTrack } from '../shared';
import type {
  InputState,
  ItemKind,
  Player,
  Racer,
  RaceState,
  TrackId,
  TrackSample,
} from '../shared';

const TAU = Math.PI * 2;
const GATES_PER_LAP = 12;
const MAX_RACE_SECONDS = 240;
const FIXED_STEP = 1 / 60;
const trackCache = new Map<TrackId, TrackSample[]>();
const lengthCache = new Map<TrackId, number>();
interface RacerRuntime {
  nextGate: number;
  itemHeld: boolean;
  previousDrift: boolean;
}
interface RaceRuntime {
  racers: Map<string, RacerRuntime>;
  seed: number;
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
      }),
    );
    runtimes.set(state, runtime);
  }
  return runtime;
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
        stun: 0,
        driftCharge: 0,
        drifting: false,
        coins: 0,
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

function advanceRacer(
  state: RaceState,
  racer: Racer,
  input: InputState,
  dt: number,
  runtime: RaceRuntime,
): void {
  const meta = runtime.racers.get(racer.id)!;
  if (racer.finished) {
    racer.speed *= Math.exp(-dt * 3);
    return;
  }
  racer.boost = Math.max(0, racer.boost - dt);
  racer.shield = Math.max(0, racer.shield - dt);
  racer.stun = Math.max(0, racer.stun - dt);
  if (input.item && !meta.itemHeld) useItem(state, racer);
  meta.itemHeld = input.item;

  if (racer.bot) {
    const botIndex = state.racers.indexOf(racer);
    const here = sampleTrack(state.trackId, racer.progress),
      ahead = sampleTrack(state.trackId, racer.progress + 20);
    const curve = Math.abs(angleDelta(here.heading, ahead.heading));
    const speedTarget =
      (29.5 + Math.sin(botIndex * 3) * 2.7) * (1 - Math.min(curve, 1) * 0.18) +
      (racer.boost > 0 ? 17 : 0) -
      (racer.stun > 0 ? 16 : 0);
    racer.speed += (speedTarget - racer.speed) * Math.min(1, dt * 1.2);
    const nextProgress = racer.progress + racer.speed * dt;
    const road = sampleTrack(state.trackId, nextProgress);
    const lane = Math.sin(botIndex * 2.4 + nextProgress / 90) * 2.4;
    racer.x = road.x + Math.cos(road.heading) * lane;
    racer.z = road.z - Math.sin(road.heading) * lane;
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
    const turn = Number(input.right) - Number(input.left);
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
    racer.x += Math.sin(racer.heading) * racer.speed * dt;
    racer.z += Math.cos(racer.heading) * racer.speed * dt;
    const road = nearestTrackPoint(state.trackId, racer.x, racer.z);
    const delta = distanceDelta(roadBefore.progress, road.progress, trackLength(state.trackId));
    // A projection jump across a nearby road section cannot grant race progress.
    if (Math.abs(delta) < Math.abs(racer.speed) * dt * 2.5 + 0.5)
      updateProgress(state, racer, racer.progress + delta, meta);
    const rail = halfWidth + 4;
    if (road.distance > rail) {
      const side = Math.sign(road.lateral) || 1;
      racer.x = road.x + Math.cos(road.heading) * rail * side;
      racer.z = road.z - Math.sin(road.heading) * rail * side;
      racer.speed *= Math.exp(-dt * 3);
      // A glancing rail collision gently points the kart back along the course.
      const recovery = road.heading - side * 0.26;
      racer.heading += angleDelta(racer.heading, recovery) * Math.min(1, dt * 3.6);
    }
  }

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
    if (Math.hypot(point.x - racer.x, point.z - racer.z) > 4.7) continue;
    pickup.availableAt = state.elapsed + (pickup.kind === 'coin' ? 4 : 7);
    if (pickup.kind === 'coin') racer.coins++;
    else {
      const choices: ItemKind[] =
        racer.position > 3 ? ['boost', 'boost', 'pulse'] : ['boost', 'shield', 'pulse'];
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
