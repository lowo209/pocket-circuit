import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import {
  EMPTY_INPUT,
  SKINS,
  type InputState,
  type Player,
  type Racer,
  type RaceState,
  type RoomState,
  type TrackId,
} from './shared';

type Callbacks = {
  onRoom: (room: RoomState | null) => void;
  onRace: (state: RaceState) => void;
  onInput: (id: string, input: InputState) => void;
  onError: (message: string) => void;
  onDisconnect: () => void;
};
type Guest = {
  connection: DataConnection;
  accepted: boolean;
  seen: number;
  lastInput: number;
  timer: ReturnType<typeof setTimeout>;
};
type Message = Record<string, unknown>;
const CHANNEL = 'pocket-circuit-v1';
const PREFIX = 'pc-v1-';
const CONNECT_TIMEOUT = 18_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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
    value.hostId !== PREFIX + value.code ||
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
function identity(value: { name: string; skin: string }): { name: string; skin: string } {
  const name =
    value.name
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 20) || 'Racer';
  return { name, skin: skin(value.skin) ? value.skin : 'lime' };
}
function code(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}
function peerOptions(): PeerOptions {
  const env = import.meta.env;
  const options: PeerOptions = { debug: 0 };
  if (env.VITE_PEER_HOST) {
    const port = Number(env.VITE_PEER_PORT || 443);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('VITE_PEER_PORT ist ungültig.');
    options.host = env.VITE_PEER_HOST;
    options.port = port;
    options.path = env.VITE_PEER_PATH || '/';
    options.secure = env.VITE_PEER_SECURE !== 'false';
  }
  if (env.VITE_ICE_SERVERS) {
    let servers: unknown;
    try {
      servers = JSON.parse(env.VITE_ICE_SERVERS);
    } catch {
      throw new Error('VITE_ICE_SERVERS muss ein gültiges JSON-Array sein.');
    }
    if (
      !Array.isArray(servers) ||
      !servers.length ||
      servers.length > 16 ||
      !servers.every((server) => {
        if (!record(server)) return false;
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
        return (
          urls.length > 0 &&
          urls.every((url) => typeof url === 'string' && /^(stun|stuns|turn|turns):/.test(url)) &&
          (server.username === undefined || typeof server.username === 'string') &&
          (server.credential === undefined || typeof server.credential === 'string')
        );
      })
    )
      throw new Error('VITE_ICE_SERVERS enthält ungültige ICE-Server.');
    options.config = { iceServers: servers as RTCIceServer[] };
  }
  return options;
}
function errorMessage(error: unknown): string {
  const type = record(error) ? error.type : undefined;
  if (type === 'peer-unavailable')
    return 'Raum nicht gefunden. Prüfe den Code und ob der Host noch online ist.';
  if (type === 'unavailable-id')
    return 'Dieser Raumcode ist schon belegt. Erstelle bitte erneut einen Raum.';
  if (type === 'browser-incompatible')
    return 'Dein Browser unterstützt WebRTC nicht. Nutze einen aktuellen Chrome, Firefox oder Safari.';
  if (type === 'ssl-unavailable')
    return 'Der Signalserver unterstützt kein HTTPS. Prüfe die PeerServer-Konfiguration.';
  return 'Die Verbindung zum Multiplayer-Dienst ist fehlgeschlagen. Prüfe deine Internetverbindung und versuche es erneut.';
}

/** The host simulates the race. Guests send controls and receive authoritative snapshots. */
export class Multiplayer {
  private callbacks: Callbacks;
  private peer: Peer | null = null;
  private guests = new Map<string, Guest>();
  private server: DataConnection | null = null;
  private currentRoom: RoomState | null = null;
  private raceId: string | null = null;
  private id = '';
  private hosting = false;
  private generation = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private serverSeen = 0;
  private pending: {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private cancelOpen: (() => void) | null = null;

  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks;
  }
  get localId(): string {
    return this.id;
  }
  get isHost(): boolean {
    return this.hosting;
  }

  async host(value: { name: string; skin: string }, trackId: TrackId): Promise<void> {
    this.dispose();
    this.hosting = true;
    const current = this.generation;
    const roomCode = code();
    try {
      await this.openPeer(PREFIX + roomCode);
      if (current !== this.generation) throw new Error('Verbindung abgebrochen.');
      this.currentRoom = {
        code: roomCode,
        hostId: this.id,
        trackId: track(trackId) ? trackId : 'coast',
        players: [{ id: this.id, ...identity(value), ready: true }],
        racing: false,
      };
      this.publishRoom();
      this.startHeartbeat();
    } catch (error) {
      if (current === this.generation) this.dispose();
      throw error;
    }
  }

  async join(rawCode: string, value: { name: string; skin: string }): Promise<void> {
    const roomCode = rawCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(roomCode))
      throw new Error('Gib einen gültigen Raumcode mit 6 Zeichen ein.');
    this.dispose();
    const current = this.generation;
    try {
      await this.openPeer();
      if (current !== this.generation || !this.peer) throw new Error('Verbindung abgebrochen.');
      await new Promise<void>((resolve, reject) => {
        this.pending = {
          resolve,
          reject,
          timer: setTimeout(
            () =>
              this.fail(
                'Der Raum antwortet nicht. Prüfe den Code oder versuche ein anderes Netzwerk.',
              ),
            CONNECT_TIMEOUT,
          ),
        };
        const connection = this.peer!.connect(PREFIX + roomCode, {
          reliable: true,
          serialization: 'json',
          label: CHANNEL,
        });
        this.server = connection;
        this.serverSeen = Date.now();
        connection.on('open', () => {
          if (current !== this.generation) return;
          this.send(connection, { type: 'hello', player: identity(value) });
        });
        connection.on('data', (data) => {
          if (current === this.generation) this.receiveFromHost(data, roomCode);
        });
        connection.on('error', () => {
          if (current === this.generation) this.fail('Die Verbindung zum Host ist fehlgeschlagen.');
        });
        connection.on('close', () => {
          if (current === this.generation)
            this.fail(
              'Der Host hat den Raum verlassen. Erstelle einen neuen Raum, um weiterzuspielen.',
            );
        });
      });
      if (current === this.generation) this.startHeartbeat();
    } catch (error) {
      if (current === this.generation) this.dispose();
      throw error;
    }
  }

  setReady(ready: boolean): void {
    if (!this.currentRoom || this.currentRoom.racing) return;
    if (this.hosting) {
      this.currentRoom.players = this.currentRoom.players.map((p) =>
        p.id === this.id ? { ...p, ready: true } : p,
      );
      this.publishRoom();
    } else if (this.server) this.send(this.server, { type: 'ready', ready: Boolean(ready) });
  }

  setTrack(trackId: TrackId): void {
    if (!this.hosting || !this.currentRoom || this.currentRoom.racing || !track(trackId)) return;
    this.currentRoom.trackId = trackId;
    this.currentRoom.players = this.currentRoom.players.map((p) => ({
      ...p,
      ready: p.id === this.id,
    }));
    this.publishRoom();
  }

  startRace(state: RaceState): void {
    if (!this.hosting || !this.currentRoom || this.currentRoom.racing) return;
    if (!this.currentRoom.players.every((p) => p.ready)) {
      this.callbacks.onError('Alle Fahrer müssen bereit sein.');
      return;
    }
    if (
      !race(state) ||
      state.trackId !== this.currentRoom.trackId ||
      !this.currentRoom.players.every((p) => state.racers.some((r) => r.id === p.id))
    ) {
      this.callbacks.onError('Das Rennen konnte nicht gestartet werden. Bitte versuche es erneut.');
      return;
    }
    this.currentRoom.racing = true;
    this.raceId = state.id;
    for (const guest of this.guests.values()) guest.lastInput = 0;
    this.publishRoom();
    this.broadcastRace(state);
    this.callbacks.onRace(state);
  }

  broadcastRace(state: RaceState): void {
    if (!this.hosting || !this.currentRoom?.racing || this.raceId !== state.id) return;
    for (const guest of this.guests.values()) {
      if (
        guest.accepted &&
        (state.phase === 'finished' ||
          (guest.connection.dataChannel?.bufferedAmount ?? 0) < 64 * 1024)
      )
        this.send(guest.connection, { type: 'race', state });
    }
  }

  sendInput(value: InputState): void {
    if (!this.currentRoom?.racing || !this.raceId || !input(value)) return;
    if (this.hosting) this.callbacks.onInput(this.id, { ...value });
    else if (this.server && (this.server.dataChannel?.bufferedAmount ?? 0) < 64 * 1024)
      this.send(this.server, { type: 'input', raceId: this.raceId, input: value });
  }

  returnToLobby(): void {
    if (!this.hosting || !this.currentRoom) return;
    this.currentRoom.racing = false;
    this.currentRoom.players = this.currentRoom.players.map((p) => ({
      ...p,
      ready: p.id === this.id,
    }));
    this.raceId = null;
    this.publishRoom();
  }

  dispose(): void {
    this.generation++;
    this.cancelOpen?.();
    this.cancelOpen = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Verbindung abgebrochen.'));
      this.pending = null;
    }
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const guest of this.guests.values()) {
      clearTimeout(guest.timer);
      guest.connection.close();
    }
    this.guests.clear();
    this.server?.close();
    this.server = null;
    this.peer?.destroy();
    this.peer = null;
    this.currentRoom = null;
    this.raceId = null;
    this.id = '';
    this.hosting = false;
    this.callbacks.onRoom(null);
  }

  private openPeer(requestedId?: string): Promise<void> {
    const current = this.generation;
    return new Promise((resolve, reject) => {
      let opened = false;
      const peer = requestedId ? new Peer(requestedId, peerOptions()) : new Peer(peerOptions());
      this.peer = peer;
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              'Der Multiplayer-Dienst antwortet nicht. Versuche es in einem Moment erneut.',
            ),
          ),
        CONNECT_TIMEOUT,
      );
      this.cancelOpen = () => {
        clearTimeout(timer);
        reject(new Error('Verbindung abgebrochen.'));
      };
      peer.on('open', (assignedId) => {
        if (current !== this.generation) return;
        opened = true;
        clearTimeout(timer);
        this.cancelOpen = null;
        this.id = assignedId;
        resolve();
      });
      peer.on('connection', (connection) => {
        if (current === this.generation && this.hosting) this.accept(connection);
        else connection.close();
      });
      peer.on('error', (error) => {
        if (current !== this.generation) return;
        if (!opened) {
          clearTimeout(timer);
          reject(new Error(errorMessage(error)));
        } else if (this.pending) this.fail(errorMessage(error));
        else if (this.hosting && error.type === 'peer-unavailable') return;
        else this.callbacks.onError(errorMessage(error));
      });
      peer.on('disconnected', () => {
        // Existing WebRTC connections survive a signaling interruption.
        if (current !== this.generation || peer.destroyed) return;
        try {
          peer.reconnect();
        } catch {
          this.callbacks.onError('Der Raum ist gerade nicht für neue Verbindungen erreichbar.');
        }
      });
      peer.on('close', () => {
        if (current === this.generation) this.fail('Die Multiplayer-Verbindung wurde beendet.');
      });
    });
  }

  private accept(connection: DataConnection): void {
    const current = this.generation;
    const refuse = (message: string) => {
      const reject = () => {
        this.send(connection, { type: 'reject', message });
        setTimeout(() => connection.close(), 300);
      };
      if (connection.open) reject();
      else connection.once('open', reject);
      connection.on('error', () => connection.close());
      setTimeout(() => connection.close(), CONNECT_TIMEOUT);
    };
    if (connection.label !== CHANNEL || !this.currentRoom) {
      refuse('Dieser Raum ist nicht verfügbar.');
      return;
    }
    if (this.currentRoom.racing) {
      refuse('Das Rennen läuft bereits. Tritt bei, sobald der Host wieder in der Lobby ist.');
      return;
    }
    if (this.guests.size >= 3 || this.guests.has(connection.peer) || connection.peer === this.id) {
      refuse('Der Raum ist voll. Maximal 4 Fahrer können mitspielen.');
      return;
    }
    const guest: Guest = {
      connection,
      accepted: false,
      seen: Date.now(),
      lastInput: 0,
      timer: setTimeout(() => {
        if (current === this.generation) this.removeGuest(connection.peer);
      }, CONNECT_TIMEOUT),
    };
    this.guests.set(connection.peer, guest);
    connection.on('data', (data) => {
      if (
        current !== this.generation ||
        this.guests.get(connection.peer) !== guest ||
        !record(data) ||
        data.v !== 1
      )
        return;
      guest.seen = Date.now();
      if (data.type === 'ping') {
        this.send(connection, { type: 'pong' });
        return;
      }
      if (data.type === 'pong') return;
      if (!guest.accepted) {
        if (
          data.type !== 'hello' ||
          !record(data.player) ||
          !text(data.player.name, 20) ||
          !skin(data.player.skin)
        ) {
          this.removeGuest(connection.peer);
          return;
        }
        if (!this.currentRoom || this.currentRoom.racing) {
          refuse('Das Rennen läuft bereits. Bitte warte auf die nächste Runde.');
          return;
        }
        clearTimeout(guest.timer);
        guest.accepted = true;
        this.currentRoom.players.push({
          id: connection.peer,
          ...identity({ name: data.player.name, skin: data.player.skin }),
          ready: false,
        });
        this.publishRoom();
        return;
      }
      if (
        data.type === 'ready' &&
        typeof data.ready === 'boolean' &&
        this.currentRoom &&
        !this.currentRoom.racing
      ) {
        this.currentRoom.players = this.currentRoom.players.map((p) =>
          p.id === connection.peer ? { ...p, ready: data.ready as boolean } : p,
        );
        this.publishRoom();
      } else if (
        data.type === 'input' &&
        this.currentRoom?.racing &&
        data.raceId === this.raceId &&
        input(data.input)
      ) {
        guest.lastInput = Date.now();
        this.callbacks.onInput(connection.peer, {
          throttle: data.input.throttle,
          brake: data.input.brake,
          left: data.input.left,
          right: data.input.right,
          drift: data.input.drift,
          item: data.input.item,
        });
      }
    });
    connection.on('close', () => {
      if (current === this.generation && this.guests.get(connection.peer) === guest)
        this.removeGuest(connection.peer);
    });
    connection.on('error', () => {
      if (current === this.generation && this.guests.get(connection.peer) === guest)
        this.removeGuest(connection.peer);
    });
  }

  private removeGuest(id: string): void {
    const guest = this.guests.get(id);
    if (!guest) return;
    this.guests.delete(id);
    clearTimeout(guest.timer);
    guest.connection.close();
    this.callbacks.onInput(id, { ...EMPTY_INPUT });
    if (guest.accepted && this.currentRoom) {
      this.currentRoom.players = this.currentRoom.players.filter((p) => p.id !== id);
      this.publishRoom();
    }
  }

  private receiveFromHost(data: unknown, expectedCode: string): void {
    if (!record(data) || data.v !== 1) return;
    this.serverSeen = Date.now();
    if (data.type === 'ping' && this.server) {
      this.send(this.server, { type: 'pong' });
      return;
    }
    if (data.type === 'pong') return;
    if (data.type === 'reject') {
      this.fail(text(data.message, 240) ? data.message : 'Der Host hat die Verbindung abgelehnt.');
    } else if (
      data.type === 'room' &&
      room(data.room) &&
      data.room.code === expectedCode &&
      data.room.hostId === this.server?.peer
    ) {
      if (!data.room.players.some((p) => p.id === this.id)) {
        this.fail('Du bist nicht mehr in diesem Raum.');
        return;
      }
      this.currentRoom = data.room;
      if (!data.room.racing) this.raceId = null;
      this.callbacks.onRoom(this.copyRoom());
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.resolve();
        this.pending = null;
      }
    } else if (
      data.type === 'race' &&
      this.currentRoom?.racing &&
      race(data.state) &&
      data.state.trackId === this.currentRoom.trackId
    ) {
      if (this.raceId && data.state.id !== this.raceId) return;
      this.raceId = data.state.id;
      this.callbacks.onRace(data.state);
    }
  }

  private copyRoom(): RoomState | null {
    return this.currentRoom
      ? { ...this.currentRoom, players: this.currentRoom.players.map((p) => ({ ...p })) }
      : null;
  }

  private publishRoom(): void {
    for (const guest of this.guests.values())
      if (guest.accepted) this.send(guest.connection, { type: 'room', room: this.currentRoom });
    this.callbacks.onRoom(this.copyRoom());
  }

  private send(connection: DataConnection, message: Message): void {
    if (!connection.open) return;
    try {
      const sent = connection.send({ v: 1, ...message });
      if (sent instanceof Promise) void sent.catch(() => {});
    } catch {
      /* Close/error and heartbeat handle broken data channels. */
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      if (this.hosting) {
        for (const [id, guest] of this.guests) {
          if (now - guest.seen > 15_000) {
            this.removeGuest(id);
            continue;
          }
          if (guest.lastInput && now - guest.lastInput > 1500) {
            guest.lastInput = 0;
            this.callbacks.onInput(id, { ...EMPTY_INPUT });
          }
          this.send(guest.connection, { type: 'ping' });
        }
      } else if (this.server) {
        if (now - this.serverSeen > 15_000) {
          this.fail('Der Host antwortet nicht mehr. Die Verbindung wurde beendet.');
          return;
        }
        this.send(this.server, { type: 'ping' });
      }
    }, 2000);
  }

  private fail(message: string): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    const established = Boolean(this.currentRoom);
    this.dispose();
    if (!pending) this.callbacks.onError(message);
    if (established) this.callbacks.onDisconnect();
  }
}
