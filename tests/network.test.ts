import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { DataConnection } from 'peerjs';
import { Multiplayer } from '../src/network';
import { createRace } from '../src/game/simulation';
import { EMPTY_INPUT, type InputState, type RaceState, type RoomState } from '../src/shared';

class Channel extends EventEmitter {
  peer: string;
  label = 'pocket-circuit-v1';
  open = true;
  dataChannel = { bufferedAmount: 0 };
  messages: any[] = [];
  constructor(peer: string) {
    super();
    this.peer = peer;
  }
  send(message: unknown) {
    this.messages.push(structuredClone(message));
  }
  close() {
    if (this.open) {
      this.open = false;
      this.emit('close');
    }
  }
  receive(message: Record<string, unknown>) {
    this.emit('data', { v: 1, ...message });
  }
}

interface Internals {
  id: string;
  hosting: boolean;
  currentRoom: RoomState | null;
  server: DataConnection | null;
  accept(channel: DataConnection): void;
  receiveFromHost(message: unknown, code: string): void;
}
const room = (): RoomState => ({
  code: 'ABC234',
  hostId: 'pc-v1-ABC234',
  trackId: 'coast',
  racing: false,
  players: [{ id: 'pc-v1-ABC234', name: 'Host', skin: 'lime', ready: true }],
});
function harness(host = true) {
  const rooms: (RoomState | null)[] = [],
    races: RaceState[] = [],
    errors: string[] = [],
    inputs: { id: string; input: InputState }[] = [];
  let disconnected = 0;
  const network = new Multiplayer({
    onRoom: (value) => rooms.push(value),
    onRace: (value) => races.push(value),
    onInput: (id, input) => inputs.push({ id, input }),
    onError: (message) => errors.push(message),
    onDisconnect: () => disconnected++,
  });
  const internals = network as unknown as Internals;
  internals.hosting = host;
  internals.id = host ? 'pc-v1-ABC234' : 'guest';
  if (host) internals.currentRoom = room();
  const guest = (id = 'guest') => {
    const channel = new Channel(id);
    internals.accept(channel as unknown as DataConnection);
    channel.receive({ type: 'hello', player: { name: 'Guest', skin: 'coral' } });
    return channel;
  };
  return {
    network,
    internals,
    rooms,
    races,
    errors,
    inputs,
    guest,
    disconnects: () => disconnected,
  };
}

test('guests cannot start a race or change its map, and every guest must be ready', (t) => {
  const h = harness();
  t.after(() => h.network.dispose());
  const channel = h.guest();
  channel.receive({ type: 'room', room: { ...room(), trackId: 'midnight' } });
  channel.receive({ type: 'race', state: createRace('midnight', room().players) });
  assert.equal(h.internals.currentRoom?.trackId, 'coast');
  assert.equal(h.races.length, 0);
  h.network.startRace(createRace('coast', h.internals.currentRoom!.players));
  assert.equal(h.internals.currentRoom?.racing, false);
  assert.match(h.errors[0], /bereit/);
  channel.receive({ type: 'ready', ready: true });
  h.network.setTrack('canyon');
  assert.equal(h.internals.currentRoom?.players.find((p) => p.id === 'guest')?.ready, false);
  channel.receive({ type: 'ready', ready: true });
  h.network.startRace(createRace('canyon', h.internals.currentRoom!.players));
  assert.equal(h.internals.currentRoom?.racing, true);
  assert.equal(h.races.length, 1);
  assert.equal(channel.messages.at(-1).type, 'race');
});

test('host accepts only current-race boolean controls and binds them to the sender', (t) => {
  const h = harness();
  t.after(() => h.network.dispose());
  const channel = h.guest();
  channel.receive({ type: 'ready', ready: true });
  const state = createRace('coast', h.internals.currentRoom!.players);
  h.network.startRace(state);
  channel.receive({ type: 'input', raceId: 'old-race', input: { ...EMPTY_INPUT, throttle: true } });
  channel.receive({ type: 'input', raceId: state.id, input: { ...EMPTY_INPUT, throttle: 9000 } });
  channel.receive({ type: 'input', raceId: state.id, input: { throttle: true } });
  assert.equal(h.inputs.length, 0);
  channel.receive({
    type: 'input',
    raceId: state.id,
    id: 'pc-v1-ABC234',
    input: { ...EMPTY_INPUT, throttle: true },
  });
  assert.deepEqual(h.inputs, [{ id: 'guest', input: { ...EMPTY_INPUT, throttle: true } }]);
  channel.close();
  assert.equal(h.internals.currentRoom?.players.length, 1);
  assert.deepEqual(h.inputs.at(-1), { id: 'guest', input: EMPTY_INPUT });
});

test('client rejects malformed snapshots and stale race ids across consecutive races', (t) => {
  const h = harness(false);
  t.after(() => h.network.dispose());
  const server = new Channel('pc-v1-ABC234');
  h.internals.server = server as unknown as DataConnection;
  const lobby = room();
  lobby.players.push({ id: 'guest', name: 'Guest', skin: 'coral', ready: true });
  const receive = (message: unknown) => h.internals.receiveFromHost(message, lobby.code);
  receive({ v: 1, type: 'room', room: { ...lobby, hostId: 'impostor' } });
  assert.equal(h.internals.currentRoom, null);
  receive({ v: 1, type: 'room', room: { ...lobby, racing: true } });
  const state = createRace('coast', lobby.players);
  const broken = structuredClone(state);
  broken.racers[0].x = Infinity;
  receive({ v: 1, type: 'race', state: broken });
  assert.equal(h.races.length, 0);
  receive({ v: 1, type: 'race', state });
  receive({ v: 1, type: 'race', state: { ...state, id: 'stale-race' } });
  assert.equal(h.races.length, 1);
  receive({ v: 1, type: 'room', room: lobby });
  receive({ v: 1, type: 'race', state });
  assert.equal(h.races.length, 1);
  receive({ v: 1, type: 'room', room: { ...lobby, racing: true } });
  const next = createRace('coast', lobby.players);
  receive({ v: 1, type: 'race', state: next });
  assert.equal(h.races.length, 2);
  assert.equal(h.races[1].id, next.id);
});

test('returning to the lobby resets readiness and stops old-race inputs', (t) => {
  const h = harness();
  t.after(() => h.network.dispose());
  const channel = h.guest();
  channel.receive({ type: 'ready', ready: true });
  const state = createRace('coast', h.internals.currentRoom!.players);
  h.network.startRace(state);
  h.network.returnToLobby();
  channel.receive({ type: 'input', raceId: state.id, input: { ...EMPTY_INPUT, throttle: true } });
  assert.equal(h.inputs.length, 0);
  assert.equal(h.internals.currentRoom?.racing, false);
  assert.equal(h.internals.currentRoom?.players.find((p) => p.id === 'guest')?.ready, false);
  assert.equal(channel.messages.at(-1).room.racing, false);
});

test('snapshot backpressure drops intermediate frames but always delivers the result', (t) => {
  const h = harness();
  t.after(() => h.network.dispose());
  const channel = h.guest();
  channel.receive({ type: 'ready', ready: true });
  const state = createRace('coast', h.internals.currentRoom!.players);
  h.network.startRace(state);
  channel.dataChannel.bufferedAmount = 128 * 1024;
  const count = channel.messages.length;
  h.network.broadcastRace({ ...state, phase: 'racing' });
  assert.equal(channel.messages.length, count);
  h.network.broadcastRace({ ...state, phase: 'finished' });
  assert.equal(channel.messages.length, count + 1);
  assert.equal(channel.messages.at(-1).state.phase, 'finished');
});
