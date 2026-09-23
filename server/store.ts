import Redis from 'ioredis';
import type { InputState, RaceState, RoomState } from '../src/shared.js';
import type { SerializableRaceRuntime } from '../src/game/simulation.js';

export const ROOM_TTL_SECONDS = 3600;

export interface Session {
  tokenHash: string;
  connectionId: string | null;
  lastSeen: number;
  disconnectedAt: number | null;
}

export interface StoredRoom {
  revision: number;
  room: RoomState;
  sessions: Record<string, Session>;
  race: { state: RaceState; runtime: SerializableRaceRuntime } | null;
  lastTick: number;
  updatedAt: number;
}

export interface StoredInput {
  connectionId: string;
  raceId: string;
  seq: number;
  at: number;
  input: InputState;
}

/** Compare-and-swap is the single authority: no process owns an in-memory race. */
export interface RoomStore {
  get(code: string): Promise<StoredRoom | null>;
  create(room: StoredRoom): Promise<boolean>;
  compareAndSet(code: string, revision: number, room: StoredRoom): Promise<boolean>;
  getInputs(code: string): Promise<Record<string, StoredInput>>;
  setInput(code: string, playerId: string, value: StoredInput): Promise<boolean>;
  consumeRateLimit(key: string, limit: number, windowMs: number): Promise<boolean>;
  close(): Promise<void>;
}

const CAS = `
  local old = redis.call('GET', KEYS[1])
  if not old then return 0 end
  if cjson.decode(old).revision ~= tonumber(ARGV[1]) then return 0 end
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return 1
`;

const SAVE_INPUT = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return 0 end
  local room = cjson.decode(raw)
  local incoming = cjson.decode(ARGV[2])
  local session = room.sessions[ARGV[1]]
  if not session or session.connectionId ~= incoming.connectionId then return 0 end
  if not room.race or room.race == cjson.null or room.race.state.id ~= incoming.raceId then return 0 end
  local previous = redis.call('HGET', KEYS[2], ARGV[1])
  if previous then
    previous = cjson.decode(previous)
    if previous.connectionId == incoming.connectionId and previous.raceId == incoming.raceId and previous.seq >= incoming.seq then return 0 end
  end
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
  redis.call('EXPIRE', KEYS[2], ARGV[3])
  return 1
`;

const RATE_LIMIT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

export class RedisRoomStore implements RoomStore {
  private readonly redis: Redis;
  private connection?: Promise<void>;

  constructor(
    url: string,
    private readonly prefix = 'pocket-circuit:v2',
  ) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      retryStrategy: (times) => Math.min(times * 250, 2000),
    });
    // Errors are surfaced as sanitized protocol errors; Redis URLs can contain secrets.
    this.redis.on('error', () => {});
  }

  private async ready(): Promise<void> {
    if (this.redis.status === 'ready') return;
    if (!this.connection && this.redis.status === 'wait')
      this.connection = this.redis.connect().finally(() => {
        this.connection = undefined;
      });
    if (this.connection) await this.connection;
    if ((this.redis.status as string) !== 'ready')
      throw new Error('Multiplayer-Speicher ist gerade nicht erreichbar.');
  }

  private key(code: string): string {
    // Redis Cluster hash tags keep the room and its inputs in the same slot.
    return `${this.prefix}:{${code}}:room`;
  }

  async get(code: string): Promise<StoredRoom | null> {
    await this.ready();
    const raw = await this.redis.get(this.key(code));
    return raw ? (JSON.parse(raw) as StoredRoom) : null;
  }

  async create(room: StoredRoom): Promise<boolean> {
    await this.ready();
    return (
      (await this.redis.set(
        this.key(room.room.code),
        JSON.stringify(room),
        'EX',
        ROOM_TTL_SECONDS,
        'NX',
      )) === 'OK'
    );
  }

  async compareAndSet(code: string, revision: number, room: StoredRoom): Promise<boolean> {
    await this.ready();
    return (
      (await this.redis.eval(
        CAS,
        1,
        this.key(code),
        revision,
        JSON.stringify(room),
        ROOM_TTL_SECONDS,
      )) === 1
    );
  }

  async getInputs(code: string): Promise<Record<string, StoredInput>> {
    await this.ready();
    const values = await this.redis.hgetall(`${this.prefix}:{${code}}:inputs`);
    return Object.fromEntries(
      Object.entries(values).map(([id, raw]) => [id, JSON.parse(raw) as StoredInput]),
    );
  }

  async setInput(code: string, playerId: string, value: StoredInput): Promise<boolean> {
    await this.ready();
    return (
      (await this.redis.eval(
        SAVE_INPUT,
        2,
        this.key(code),
        `${this.prefix}:{${code}}:inputs`,
        playerId,
        JSON.stringify(value),
        ROOM_TTL_SECONDS,
      )) === 1
    );
  }

  async consumeRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    await this.ready();
    const count = await this.redis.eval(RATE_LIMIT, 1, `${this.prefix}:rate:${key}`, windowMs);
    return Number(count) <= limit;
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

/** Explicit dev/test adapter. Production must use a shared RedisRoomStore. */
export class InMemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, { expires: number; room: StoredRoom }>();
  private readonly inputs = new Map<string, Record<string, StoredInput>>();
  private readonly rates = new Map<string, { expires: number; count: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(code: string): Promise<StoredRoom | null> {
    const entry = this.rooms.get(code);
    if (!entry) return null;
    if (entry.expires <= this.now()) {
      this.rooms.delete(code);
      this.inputs.delete(code);
      return null;
    }
    return structuredClone(entry.room);
  }

  async create(room: StoredRoom): Promise<boolean> {
    const entry = this.rooms.get(room.room.code);
    if (entry && entry.expires > this.now()) return false;
    this.rooms.set(room.room.code, {
      expires: this.now() + ROOM_TTL_SECONDS * 1000,
      room: structuredClone(room),
    });
    return true;
  }

  async compareAndSet(code: string, revision: number, room: StoredRoom): Promise<boolean> {
    const entry = this.rooms.get(code);
    if (!entry || entry.expires <= this.now() || entry.room.revision !== revision) return false;
    this.rooms.set(code, {
      expires: this.now() + ROOM_TTL_SECONDS * 1000,
      room: structuredClone(room),
    });
    return true;
  }

  async getInputs(code: string): Promise<Record<string, StoredInput>> {
    return structuredClone(this.inputs.get(code) ?? {});
  }

  async setInput(code: string, id: string, value: StoredInput): Promise<boolean> {
    const entry = this.rooms.get(code);
    const room = entry?.room;
    if (
      !room ||
      !entry ||
      entry.expires <= this.now() ||
      room.sessions[id]?.connectionId !== value.connectionId ||
      room.race?.state.id !== value.raceId
    )
      return false;
    const inputs = this.inputs.get(code) ?? {};
    const previous = inputs[id];
    if (
      previous &&
      previous.connectionId === value.connectionId &&
      previous.raceId === value.raceId &&
      previous.seq >= value.seq
    )
      return false;
    inputs[id] = structuredClone(value);
    this.inputs.set(code, inputs);
    return true;
  }

  async consumeRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const previous = this.rates.get(key);
    const value =
      previous && previous.expires > this.now()
        ? previous
        : { expires: this.now() + windowMs, count: 0 };
    value.count++;
    this.rates.set(key, value);
    return value.count <= limit;
  }

  async close(): Promise<void> {}
}
