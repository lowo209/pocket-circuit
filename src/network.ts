import type { InputState, RaceState, RoomState, TrackId } from './shared';
import { record, text, room, race } from './protocol';

export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting';
type Callbacks = {
  onRoom: (room: RoomState | null) => void;
  onRace: (state: RaceState) => void;
  onError: (message: string) => void;
  onDisconnect: () => void;
  onStatus?: (status: ConnectionStatus) => void;
};
type Message = Record<string, unknown>;

/** Same-origin WebSocket client. Only the Vercel server can simulate a race. */
export class Multiplayer {
  private socket: WebSocket | null = null;
  private currentRoom: RoomState | null = null;
  private id = '';
  private token = '';
  private raceId = '';
  private sequence = 0;
  private generation = 0;
  private stopped = true;
  private reconnectSince = 0;
  private retry = 0;
  private seen = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private pending?: { resolve: () => void; reject: (error: Error) => void };
  private endpoint: string;
  private makeSocket: (url: string) => WebSocket;

  constructor(
    private callbacks: Callbacks,
    options?: { endpoint?: string; socketFactory?: (url: string) => WebSocket },
  ) {
    this.endpoint =
      options?.endpoint ??
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`;
    this.makeSocket = options?.socketFactory ?? ((url) => new WebSocket(url));
  }
  get localId() {
    return this.id;
  }
  get isHost() {
    return Boolean(this.id && this.currentRoom?.hostId === this.id);
  }
  async host(player: { name: string; skin: string; trail?: string; driver?: string; tire?: string }, trackId: TrackId): Promise<void> {
    return this.begin({ type: 'create', name: player.name, skin: player.skin, trail: player.trail ?? 'none', driver: player.driver ?? 'rookie', tire: player.tire ?? 'standard', trackId });
  }
  async join(rawCode: string, player: { name: string; skin: string; trail?: string; driver?: string; tire?: string }): Promise<void> {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
      throw new Error('Bitte gib einen gültigen sechsstelligen Raumcode ein.');
    return this.begin({ type: 'join', code, name: player.name, skin: player.skin, trail: player.trail ?? 'none', driver: player.driver ?? 'rookie', tire: player.tire ?? 'standard' });
  }
  setReady(ready: boolean) {
    this.send({ type: 'ready', ready });
  }
  setTrack(trackId: TrackId) {
    this.send({ type: 'track', trackId });
  }
  startRace() {
    this.send({ type: 'start' });
  }
  returnToLobby() {
    this.send({ type: 'lobby' });
  }
  sendInput(input: InputState) {
    if (!this.raceId || !this.currentRoom?.racing || this.reconnectSince) return;
    if ((this.socket?.bufferedAmount ?? Infinity) > 64 * 1024) return;
    this.send({ type: 'input', input, raceId: this.raceId, seq: ++this.sequence });
  }
  private begin(message: Message): Promise<void> {
    this.dispose();
    this.stopped = false;
    this.callbacks.onStatus?.('connecting');
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.open(message);
    });
  }
  private open(message: Message) {
    if (this.stopped) return;
    const generation = ++this.generation;
    let socket: WebSocket;
    try {
      socket = this.makeSocket(this.endpoint);
    } catch {
      this.fail('Der Multiplayer-Server konnte nicht erreicht werden. Bitte erneut versuchen.');
      return;
    }
    this.socket = socket;
    const active = () => !this.stopped && this.generation === generation && this.socket === socket;
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (active()) socket.close();
    }, 12_000);
    socket.onopen = () => {
      if (!active()) return;
      this.seen = Date.now();
      this.send(message);
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (!active()) return;
        if (Date.now() - this.seen > 15_000) socket.close();
        else this.send({ type: 'ping' });
      }, 2500);
    };
    socket.onmessage = (event) => {
      if (!active() || typeof event.data !== 'string' || event.data.length > 128_000) return;
      try {
        this.receive(JSON.parse(event.data));
      } catch {
        /* Ignore malformed frames. */
      }
    };
    socket.onerror = () => {
      /* close drives bounded retries and cleanup */
    };
    socket.onclose = () => {
      if (!active()) return;
      clearTimeout(this.connectTimer);
      clearInterval(this.heartbeat);
      this.socket = null;
      if (!this.token || !this.currentRoom) {
        this.fail(
          'Der Multiplayer-Server ist nicht erreichbar. Prüfe die Verbindung und die Vercel-Einrichtung.',
        );
        return;
      }
      this.reconnectSince ||= Date.now();
      if (Date.now() - this.reconnectSince > 30_000) {
        this.fail('Die Verbindung wurde unterbrochen. Bitte tritt dem Raum erneut bei.');
        return;
      }
      this.callbacks.onStatus?.('reconnecting');
      this.reconnectTimer = setTimeout(
        () => {
          if (!this.currentRoom || this.stopped) return;
          this.open({
            type: 'resume',
            code: this.currentRoom.code,
            id: this.id,
            token: this.token,
          });
        },
        Math.min(4000, 250 * 2 ** this.retry++),
      );
    };
  }
  private receive(data: unknown) {
    if (!record(data) || data.v !== 2) return;
    this.seen = Date.now();
    if (data.type === 'error') {
      const message = text(data.message, 500)
        ? data.message
        : 'Der Server hat die Anfrage abgelehnt.';
      if (data.fatal || this.pending || this.reconnectSince) this.fail(message);
      else this.callbacks.onError(message);
    } else if (
      data.type === 'welcome' &&
      text(data.id) &&
      text(data.token, 256) &&
      room(data.room)
    ) {
      if (!data.room.players.some((p) => p.id === data.id)) return;
      if (this.id && data.id !== this.id) return;
      this.id = data.id;
      this.token = data.token;
      this.currentRoom = data.room;
      if (!data.room.racing) this.raceId = '';
      clearTimeout(this.connectTimer);
      this.retry = 0;
      this.reconnectSince = 0;
      this.callbacks.onStatus?.('connected');
      this.callbacks.onRoom(data.room);
      this.pending?.resolve();
      this.pending = undefined;
    } else if (
      data.type === 'room' &&
      room(data.room) &&
      data.room.code === this.currentRoom?.code
    ) {
      if (!data.room.players.some((p) => p.id === this.id)) {
        this.fail('Du bist nicht mehr in diesem Raum.');
        return;
      }
      this.currentRoom = data.room;
      if (!data.room.racing) this.raceId = '';
      this.callbacks.onRoom(data.room);
    } else if (data.type === 'race' && this.currentRoom?.racing && race(data.state)) {
      if (
        data.state.trackId !== this.currentRoom.trackId ||
        (this.raceId && this.raceId !== data.state.id)
      )
        return;
      if (!data.state.racers.some((r) => r.id === this.id)) return;
      this.raceId = data.state.id;
      this.callbacks.onRace(data.state);
    }
  }
  private send(message: Message) {
    if (this.socket?.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify({ v: 2, ...message }));
    } catch {
      this.socket.close();
    }
  }
  private fail(message: string) {
    const pending = this.pending;
    this.pending = undefined;
    const established = !!this.currentRoom;
    this.dispose();
    if (pending) pending.reject(new Error(message));
    else this.callbacks.onError(message);
    if (established) this.callbacks.onDisconnect();
  }
  dispose() {
    if (!this.stopped) this.send({ type: 'leave' });
    this.stopped = true;
    this.generation++;
    clearTimeout(this.connectTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    this.socket?.close();
    this.socket = null;
    this.pending?.reject(new Error('Verbindung abgebrochen.'));
    this.pending = undefined;
    this.currentRoom = null;
    this.id = '';
    this.token = '';
    this.raceId = '';
    this.sequence = 0;
    this.retry = 0;
    this.reconnectSince = 0;
    this.callbacks.onStatus?.('offline');
    this.callbacks.onRoom(null);
  }
}
