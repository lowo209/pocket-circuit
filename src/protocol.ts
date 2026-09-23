import {
  SKINS,
  type InputState,
  type Player,
  type Racer,
  type RaceState,
  type RoomState,
  type TrackId,
} from './shared';
type Message = Record<string, unknown>;
const INPUT_KEYS = ['throttle', 'brake', 'left', 'right', 'drift', 'item'] as const;
function record(value: unknown): value is Message {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max = 100): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e8;
}
function track(value: unknown): value is TrackId {
  return value === 'coast' || value === 'canyon' || value === 'midnight';
}
function skin(value: unknown): value is string {
  return typeof value === 'string' && SKINS.some((s) => s.id === value);
}
function input(value: unknown): value is InputState {
  return record(value) && INPUT_KEYS.every((key) => typeof value[key] === 'boolean');
}
function player(value: unknown): value is Player {
  return (
    record(value) &&
    text(value.id) &&
    text(value.name, 20) &&
    skin(value.skin) &&
    typeof value.ready === 'boolean' &&
    !value.bot
  );
}
function room(value: unknown): value is RoomState {
  if (
    !record(value) ||
    !text(value.code, 6) ||
    !/^[A-Z2-9]{6}$/.test(value.code) ||
    !text(value.hostId) ||
    !track(value.trackId) ||
    typeof value.racing !== 'boolean' ||
    !Array.isArray(value.players)
  )
    return false;
  return (
    value.players.length > 0 &&
    value.players.length <= 4 &&
    value.players.every(player) &&
    value.players.some((p) => p.id === value.hostId) &&
    new Set(value.players.map((p) => p.id)).size === value.players.length
  );
}
function racer(value: unknown): value is Racer {
  if (!record(value) || !text(value.id) || !text(value.name, 20) || !skin(value.skin)) return false;
  return (
    [
      'x',
      'z',
      'heading',
      'speed',
      'progress',
      'lap',
      'position',
      'boost',
      'shield',
      'stun',
      'driftCharge',
      'coins',
    ].every((key) => finite(value[key])) &&
    ['bot', 'finished', 'drifting'].every((key) => typeof value[key] === 'boolean') &&
    (value.impact === undefined ||
      (finite(value.impact) && value.impact >= 0 && value.impact <= 1)) &&
    (value.steering === undefined || (finite(value.steering) && Math.abs(value.steering) <= 1)) &&
    (value.finishTime === null || finite(value.finishTime)) &&
    (value.item === null ||
      value.item === 'boost' ||
      value.item === 'shield' ||
      value.item === 'pulse')
  );
}
function race(value: unknown): value is RaceState {
  if (
    !record(value) ||
    !text(value.id) ||
    !track(value.trackId) ||
    !['countdown', 'racing', 'finished'].includes(String(value.phase)) ||
    !finite(value.countdown) ||
    !finite(value.elapsed)
  )
    return false;
  if (
    !Array.isArray(value.racers) ||
    value.racers.length < 1 ||
    value.racers.length > 12 ||
    !value.racers.every(racer) ||
    new Set(value.racers.map((r) => r.id)).size !== value.racers.length
  )
    return false;
  return (
    Array.isArray(value.pickups) &&
    value.pickups.length <= 256 &&
    value.pickups.every(
      (p) =>
        record(p) &&
        finite(p.id) &&
        finite(p.progress) &&
        finite(p.availableAt) &&
        (p.kind === 'item' || p.kind === 'coin'),
    )
  );
}

export { record, text, room, race };
