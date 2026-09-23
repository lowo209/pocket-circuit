import { useEffect, useRef, useState } from 'react';
import { KartRenderer } from './game/renderer';
import { stepRace, trackSamples, trackLength } from './game/simulation';
import { EMPTY_INPUT, LAPS, TRACK_WEATHER, getSkin } from './shared';
import type { GraphicsQuality } from './game/environment';
import type { InputState, RaceState, TrackId } from './shared';
import type { Multiplayer } from './network';
import {
  Flag,
  Pause,
  Play,
  RotateCcw,
  Zap,
  Shield,
  Radio,
  ArrowLeft,
  ArrowRight,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatTime } from './profile';
export interface RaceSession {
  state: RaceState;
  localId: string;
  online: boolean;
}
interface Props {
  trackId: TrackId;
  skinId: string;
  quality: GraphicsQuality;
  onQuality: (quality: GraphicsQuality) => void;
  race: RaceSession | null;
  network: Multiplayer | null;
  remoteInputs: React.RefObject<Record<string, InputState>>;
  onFinish: (race: RaceState, id: string) => void;
  onExit: () => void;
}
export default function GameSurface({
  trackId,
  skinId,
  quality,
  onQuality,
  race,
  network,
  remoteInputs,
  onFinish,
  onExit,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    renderer = useRef<KartRenderer | null>(null),
    input = useRef<InputState>({ ...EMPTY_INPUT }),
    current = useRef(race),
    pausedRef = useRef(false),
    finishRef = useRef(''),
    networkRef = useRef(network),
    finishCallback = useRef(onFinish);
  const [hud, setHud] = useState<RaceState | null>(null),
    [paused, setPaused] = useState(false),
    [error, setError] = useState('');
  current.current = race;
  networkRef.current = network;
  finishCallback.current = onFinish;
  useEffect(() => {
    try {
      renderer.current = new KartRenderer(container.current!, trackId);
    } catch {
      setError(
        'Die 3D-Ansicht konnte nicht starten. Bitte aktiviere die Hardwarebeschleunigung und lade die Seite neu.',
      );
    }
    return () => {
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);
  useEffect(() => {
    renderer.current?.setTrack(trackId);
  }, [trackId]);
  useEffect(() => {
    renderer.current?.setSkin(skinId);
  }, [skinId]);
  useEffect(() => {
    renderer.current?.setQuality(quality);
  }, [quality]);
  useEffect(() => {
    setPaused(false);
    pausedRef.current = false;
    input.current = { ...EMPTY_INPUT };
    finishRef.current = '';
    setHud(race?.state ?? null);
  }, [race?.state.id]);
  useEffect(() => {
    const keyMap: Record<string, keyof InputState> = {
      KeyW: 'throttle',
      ArrowUp: 'throttle',
      KeyS: 'brake',
      ArrowDown: 'brake',
      KeyA: 'left',
      ArrowLeft: 'left',
      KeyD: 'right',
      ArrowRight: 'right',
      ShiftLeft: 'drift',
      ShiftRight: 'drift',
      Space: 'item',
    };
    const key = (e: KeyboardEvent, down: boolean) => {
      if (
        !current.current ||
        (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName))
      )
        return;
      if (e.code === 'Escape' && down && !e.repeat) {
        setPaused((p) => {
          pausedRef.current = !p;
          input.current = { ...EMPTY_INPUT };
          return !p;
        });
        e.preventDefault();
        return;
      }
      const k = keyMap[e.code];
      if (k) {
        input.current[k] = down;
        e.preventDefault();
      }
    };
    const down = (e: KeyboardEvent) => key(e, true),
      up = (e: KeyboardEvent) => key(e, false),
      blur = () => {
        input.current = { ...EMPTY_INPUT };
      };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      netTimer = 0,
      hudTimer = 0;
    const animate = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const session = current.current;
      const net = networkRef.current;
      if (session) {
        const localInput = pausedRef.current ? EMPTY_INPUT : input.current;
        remoteInputs.current[session.localId] = { ...localInput };
        if (!session.online && !pausedRef.current)
          stepRace(session.state, remoteInputs.current, dt);
        netTimer += dt;
        hudTimer += dt;
        if (netTimer >= 1 / 20) {
          netTimer = 0;
          if (session.online) {
            net?.sendInput(localInput);
          }
        }
        if (hudTimer >= 0.08) {
          hudTimer = 0;
          setHud({ ...session.state, racers: session.state.racers.map((r) => ({ ...r })) });
        }
        const me = session.state.racers.find((r) => r.id === session.localId);
        if (me?.finished && finishRef.current !== session.state.id) {
          finishRef.current = session.state.id;
          finishCallback.current(session.state, session.localId);
        }
        renderer.current?.render(session.state, session.localId, dt);
      } else renderer.current?.render(null, '', dt);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);
  const me = hud?.racers.find((r) => r.id === race?.localId);
  const touch = (k: keyof InputState) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    input.current[k] = true;
  };
  const release = (k: keyof InputState) => () => {
    input.current[k] = false;
  };
  const button = (key: keyof InputState, label: string, content: React.ReactNode, cls = '') => (
    <button
      aria-label={label}
      className={`touch-button ${cls}`}
      onPointerDown={touch(key)}
      onPointerUp={release(key)}
      onPointerCancel={release(key)}
      onLostPointerCapture={release(key)}
    >
      {content}
    </button>
  );
  return (
    <div className={`game-surface ${race ? 'is-racing' : ''}`}>
      <div className="three-canvas" ref={container} />
      {error && (
        <div className="webgl-error">
          <b>3D benötigt WebGL</b>
          <p>{error}</p>
        </div>
      )}
      {race && hud && me && (
        <>
          <div className="race-top">
            <div className="position">
              <strong>{me.position}</strong>
              <span>
                / {hud.racers.length}
                <small>POSITION</small>
              </span>
            </div>
            <div className="race-stats">
              <span>
                <small>RUNDE</small>
                <b>
                  {Math.min(me.lap, LAPS)} <em>/ {LAPS}</em>
                </b>
              </span>
              <span>
                <small>ZEIT</small>
                <b>{formatTime(me.finished ? me.finishTime : hud.elapsed)}</b>
              </span>
            </div>
            <button
              className="icon-button pause-button"
              aria-label="Rennmenü öffnen"
              onClick={() => {
                setPaused(true);
                pausedRef.current = true;
                input.current = { ...EMPTY_INPUT };
              }}
            >
              <Pause size={20} />
            </button>
          </div>
          <div className="race-left">
            <div className="live-rank">
              {[...hud.racers]
                .sort((a, b) => a.position - b.position)
                .map((r) => (
                  <div className={r.id === race.localId ? 'is-me' : ''} key={r.id}>
                    <span>{r.position.toString().padStart(2, '0')}</span>
                    <i style={{ background: getSkin(r.skin).color }} />
                    <b>{r.name}</b>
                    {r.finished && <Flag size={12} />}
                  </div>
                ))}
            </div>
            <MiniMap state={hud} localId={race.localId} />
          </div>
          <div className="speedometer">
            <strong>{Math.round(Math.abs(me.speed) * 4.2)}</strong>
            <span>KM/H</span>
            <div className="speed-bar">
              <i style={{ width: `${Math.min(100, (Math.abs(me.speed) / 55) * 100)}%` }} />
            </div>
            {me.drifting && (
              <div className="drift-meter">
                DRIFT <progress value={me.driftCharge} max={1.5} />
              </div>
            )}
            {me.boost > 0 && <b className="boost-active">BOOST!</b>}
          </div>
          <div className={`item-slot ${me.item ? 'has-item' : ''}`}>
            <small>ITEM</small>
            {me.item === 'boost' ? (
              <Zap />
            ) : me.item === 'shield' ? (
              <Shield />
            ) : me.item === 'pulse' ? (
              <Radio />
            ) : (
              <span>?</span>
            )}
            <b>
              {me.item === 'boost'
                ? 'Turbo'
                : me.item === 'shield'
                  ? 'Schild'
                  : me.item === 'pulse'
                    ? 'Impuls'
                    : 'Item-Box holen'}
            </b>
            <kbd>LEERTASTE</kbd>
          </div>
          {hud.phase === 'countdown' && (
            <div className="countdown" key={Math.ceil(hud.countdown)}>
              <strong>{Math.max(1, Math.ceil(hud.countdown))}</strong>
              <span>MACH DICH BEREIT</span>
            </div>
          )}
          {hud.phase === 'racing' && hud.elapsed < 0.8 && (
            <div className="countdown go">
              <strong>GO!</strong>
            </div>
          )}
          <div className="race-controls-hint">
            <span>
              <kbd>W A S D</kbd> Fahren
            </span>
            <span>
              <kbd>SHIFT</kbd> Driften
            </span>
            <span>
              <kbd>SPACE</kbd> Item
            </span>
          </div>
          <div className="touch-controls">
            <div>
              {button('left', 'Links lenken', <ArrowLeft />)}
              {button('right', 'Rechts lenken', <ArrowRight />)}
            </div>
            <div>
              {button('item', 'Item benutzen', <Zap />)}
              {button('drift', 'Driften', 'DRIFT')}
              {button('brake', 'Bremsen', 'S')}
              {button('throttle', 'Gas geben', 'GAS', 'gas')}
            </div>
          </div>
          {paused && (
            <div className="pause-overlay">
              <div className="dialog-card">
                <span className="eyebrow">KURZER BOXENSTOPP</span>
                <h2>{race.online ? 'Rennmenü' : 'Pause.'}</h2>
                {race.online && <p>Das Online-Rennen läuft weiter.</p>}
                <p className="weather-info">{TRACK_WEATHER[trackId]}</p>
                <label className="quality-control pause-quality">
                  <span>GRAFIKQUALITÄT</span>
                  <select
                    aria-label="Grafikqualität im Rennen"
                    value={quality}
                    onChange={(e) => onQuality(e.target.value as GraphicsQuality)}
                  >
                    <option value="high">Hoch — volle Details</option>
                    <option value="balanced">Flüssig — weniger GPU-Last</option>
                  </select>
                </label>
                <button
                  className="primary"
                  onClick={() => {
                    setPaused(false);
                    pausedRef.current = false;
                  }}
                >
                  <Play size={18} /> Weiterfahren
                </button>
                <button className="secondary" onClick={onExit}>
                  <ArrowLeft size={17} /> Rennen verlassen
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
export function MiniMap({ state, localId }: { state: RaceState; localId: string }) {
  const pts = trackSamples(state.trackId);
  const xs = pts.map((p) => p.x),
    zs = pts.map((p) => p.z),
    minX = Math.min(...xs) - 15,
    minZ = Math.min(...zs) - 15,
    w = Math.max(...xs) - minX + 15,
    h = Math.max(...zs) - minZ + 15;
  return (
    <svg className="minimap" viewBox={`${minX} ${minZ} ${w} ${h}`} aria-label="Streckenkarte">
      <polyline
        points={pts.map((p) => `${p.x},${p.z}`).join(' ')}
        fill="none"
        stroke="#ffffff35"
        strokeWidth="9"
        strokeLinejoin="round"
      />
      {state.racers.map((r) => (
        <circle
          key={r.id}
          cx={r.x}
          cy={r.z}
          r={r.id === localId ? 7 : 4}
          fill={r.id === localId ? '#c4f34b' : getSkin(r.skin).color}
          stroke="#111719"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}
