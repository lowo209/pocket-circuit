import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_INPUT, LAPS, TRACKS } from '../src/shared';
import type { InputState, Player } from '../src/shared';
import {
  createRace,
  nearestTrackPoint,
  sampleTrack,
  stepRace,
  trackLength,
  trackSamples,
} from '../src/game/simulation';

const human: Player = { id: 'human', name: 'Driver', skin: 'lime', ready: true };
const throttle: InputState = { ...EMPTY_INPUT, throttle: true };
const advance = (
  state: ReturnType<typeof createRace>,
  seconds: number,
  inputs: Record<string, InputState> = {},
) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepRace(state, inputs, 1 / 60);
};

test('all three tracks are closed and sample by real distance', () => {
  for (const track of TRACKS) {
    const length = trackLength(track.id);
    assert.ok(length > 600 && length < 1800);
    assert.ok(trackSamples(track.id).length > 500);
    const start = sampleTrack(track.id, 0),
      end = sampleTrack(track.id, length),
      before = sampleTrack(track.id, -0.1);
    assert.deepEqual(start, end);
    assert.ok(Math.hypot(start.x - before.x, start.z - before.z) < 0.11);
    const sample = sampleTrack(track.id, 120);
    const projected = nearestTrackPoint(track.id, sample.x, sample.z);
    assert.ok(Math.abs(projected.progress - 120) < 0.01);
    assert.ok(projected.distance < 0.001);
  }
});

test('countdown holds all cars, then throttle moves the player forward', () => {
  const state = createRace('coast', [human]);
  assert.equal(state.racers.length, 6);
  const initial = { ...state.racers[0] };
  advance(state, 2, { human: throttle });
  assert.equal(state.phase, 'countdown');
  assert.equal(state.racers[0].x, initial.x);
  assert.equal(state.racers[0].z, initial.z);
  assert.equal(state.elapsed, 0);
  advance(state, 3, { human: throttle });
  assert.equal(state.phase, 'racing');
  assert.ok(state.racers[0].progress > initial.progress + 15);
  assert.ok(state.racers[0].speed > 15);
  assert.equal(state.racers[0].lap, 1);
});

test('bots cross ordered gates, complete three laps, and finish in ranked order', () => {
  const state = createRace('canyon', [], true);
  advance(state, 165);
  assert.equal(state.phase, 'finished');
  assert.ok(state.racers.every((r) => r.finished && r.lap === LAPS));
  assert.ok(state.racers.every((r) => Math.abs(r.progress - LAPS * trackLength('canyon')) < 0.001));
  const sorted = [...state.racers].sort((a, b) => a.position - b.position);
  assert.deepEqual(
    sorted.map((r) => r.position),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(sorted.every((r, i) => i === 0 || r.finishTime! >= sorted[i - 1].finishTime!));
});

test('driving backwards across the start does not award laps', () => {
  const state = createRace('coast', [human], false);
  advance(state, 3);
  const racer = state.racers[0];
  // Put the kart just beyond the finish line; the ordered start gate was never crossed.
  const point = sampleTrack('coast', 2);
  racer.x = point.x;
  racer.z = point.z;
  racer.heading = point.heading;
  racer.progress = 2;
  advance(state, 1.5, { human: { ...EMPTY_INPUT, brake: true } });
  assert.ok(racer.progress < 0);
  assert.equal(racer.lap, 1);
  assert.equal(racer.finished, false);
});

test('bad deltas do nothing and long background-tab deltas are bounded', () => {
  const state = createRace('midnight', [human], false);
  const original = JSON.stringify(state);
  for (const dt of [NaN, Infinity, -1, 0]) stepRace(state, { human: throttle }, dt);
  assert.equal(JSON.stringify(state), original);
  stepRace(state, { human: throttle }, 60);
  assert.ok(state.countdown > 2.89 && state.countdown < 2.91);
});

test('item use is edge-triggered and shield blocks one pulse', () => {
  const second = { ...human, id: 'second' };
  const state = createRace('coast', [human, second], false);
  advance(state, 3);
  const [a, b] = state.racers;
  a.item = 'pulse';
  b.shield = 6;
  stepRace(state, { human: { ...EMPTY_INPUT, item: true } }, 1 / 60);
  assert.equal(a.item, null);
  assert.equal(b.shield, 0);
  assert.equal(b.stun, 0);
  a.item = 'boost';
  stepRace(state, { human: { ...EMPTY_INPUT, item: true } }, 1 / 60);
  assert.equal(a.item, 'boost');
  stepRace(state, {}, 1 / 60);
  stepRace(state, { human: { ...EMPTY_INPUT, item: true } }, 1 / 60);
  assert.equal(a.item, null);
  assert.ok(a.boost > 2);
});

test('identical starting players and inputs produce identical simulation state', () => {
  const a = createRace('midnight', [human]),
    b = createRace('midnight', [human]);
  advance(a, 12, { human: throttle });
  advance(b, 12, { human: throttle });
  assert.notEqual(a.id, b.id);
  assert.deepEqual({ ...a, id: '' }, { ...b, id: '' });
});

test('a stopped human cannot keep a multiplayer race open forever', () => {
  const state = createRace('coast', [human], false);
  // The race elapsed time is public so host snapshots can restore it.
  advance(state, 3);
  state.elapsed = 239.98;
  advance(state, 0.1);
  assert.equal(state.phase, 'finished');
  assert.equal(state.racers[0].finished, true);
  assert.equal(
    state.racers[0].finishTime,
    null,
    'timeout is a DNF rather than a valid three-lap time',
  );
  assert.equal(state.racers[0].lap, 1);
});
