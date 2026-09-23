import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Flag,
  Users,
  Gamepad2,
  Check,
  Lock,
  Plus,
  Copy,
  X,
  Trophy,
  Coins,
  Zap,
  ChevronRight,
  Keyboard,
  LoaderCircle,
  Wifi,
  ArrowLeft,
  CheckCheck,
  Sparkles,
} from 'lucide-react';
import GameSurface from './GameSurface';
import type { RaceSession } from './GameSurface';
import { TRACKS, SKINS, TRAILS, DRIVERS, TIRES, TRACK_WEATHER, getTrack, getSkin, getTrail, getDriver, getTire } from './shared';
import type { GraphicsQuality } from './game/environment';
import type { InputState, RaceState, RoomState, TrackId } from './shared';
import { createRace, trackSamples } from './game/simulation';
import { Multiplayer, type ConnectionStatus } from './network';
import { loadProfile, saveProfile, levelFor, rewardRace, buySkin, buyTrail, buyDriver, buyTire, formatTime } from './profile';
import type { Profile } from './profile';

type Page = 'race' | 'garage' | 'career';
function savedQuality(): GraphicsQuality {
  try {
    const saved = localStorage.getItem('pocket-circuit.graphics.v1');
    if (saved === 'high' || saved === 'balanced') return saved;
  } catch {}
  return window.matchMedia('(max-width: 800px)').matches ? 'balanced' : 'high';
}
export default function App() {
  const [profile, setProfile] = useState(loadProfile),
    [quality, setQuality] = useState<GraphicsQuality>(savedQuality),
    [page, setPage] = useState<Page>('race'),
    [track, setTrack] = useState<TrackId>('coast'),
    [mode, setMode] = useState<'solo' | 'online'>('solo'),
    [room, setRoom] = useState<RoomState | null>(null),
    [race, setRace] = useState<RaceSession | null>(null),
    [network, setNetwork] = useState<Multiplayer | null>(null),
    [joinCode, setJoinCode] = useState(
      () => new URLSearchParams(location.search).get('room')?.toUpperCase().slice(0, 6) ?? '',
    ),
    [busy, setBusy] = useState(false),
    [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('offline'),
    [notice, setNotice] = useState(''),
    [help, setHelp] = useState(false),
    [reward, setReward] = useState<{
      coins: number;
      xp: number;
      race: RaceState;
      localId: string;
    } | null>(null),
    [viewSkin, setViewSkin] = useState(profile.equipped),
    [viewTrail, setViewTrail] = useState(profile.equippedTrail),
    [viewDriver, setViewDriver] = useState(profile.equippedDriver),
    [viewTire, setViewTire] = useState(profile.equippedTire);
  const netRef = useRef<Multiplayer | null>(null),
    profileRef = useRef(profile),
    roomRef = useRef<RoomState | null>(null),
    inputs = useRef<Record<string, InputState>>({}),
    activeRaceRef = useRef<RaceSession | null>(race);
  profileRef.current = profile;
  activeRaceRef.current = race;
  const level = levelFor(profile.xp),
    selectedTrack = getTrack(track);
  useEffect(() => {
    if (joinCode) setMode('online');
    return () => netRef.current?.dispose();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('pocket-circuit.graphics.v1', quality);
    } catch {}
  }, [quality]);
  useEffect(() => {
    if (!saveProfile(profile))
      setNotice(
        'Dein Browser blockiert das Speichern. Der Fortschritt bleibt für diese Sitzung erhalten.',
      );
  }, [profile]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!reward) return;
    const timer = setInterval(
      () =>
        setReward((prev) =>
          prev ? { ...prev, race: activeRaceRef.current?.state ?? prev.race } : prev,
        ),
      400,
    );
    return () => clearInterval(timer);
  }, [reward?.race.id]);
  function clearNetwork() {
    netRef.current?.dispose();
    netRef.current = null;
    setNetwork(null);
    setRoom(null);
    roomRef.current = null;
    setBusy(false);
  }
  async function connect(join: boolean) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    clearNetwork();
    setBusy(true);
    let service: Multiplayer;
    service = new Multiplayer({
      onRoom: (r) => {
        const wasRacing = roomRef.current?.racing;
        roomRef.current = r;
        setRoom(r);
        if (r) {
          setTrack(r.trackId);
          if (wasRacing && !r.racing) {
            setRace(null);
            setReward(null);
          }
        }
      },
      onRace: (state) => {
        setTrack(state.trackId);
        setRace({ state, localId: service.localId, online: true });
      },
      onStatus: setConnectionStatus,
      onError: (message) => setNotice(message),
      onDisconnect: () => {
        setRace(null);
        setReward(null);
        setRoom(null);
        roomRef.current = null;
        setBusy(false);
        setNetwork(null);
      },
    });
    netRef.current = service;
    setNetwork(service);
    try {
      const player = { name: profile.name.trim() || 'Rookie', skin: profile.equipped, trail: profile.equippedTrail, driver: profile.equippedDriver, tire: profile.equippedTire };
      if (join) await service.join(joinCode.trim(), player);
      else await service.host(player, track);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
      );
      if (netRef.current === service) clearNetwork();
    } finally {
      setBusy(false);
    }
  }
  function startSolo() {
    clearNetwork();
    setReward(null);
    inputs.current = {};
    setRace({
      state: createRace(track, [
        { id: 'local', name: profile.name.trim() || 'Rookie', skin: profile.equipped, trail: profile.equippedTrail, driver: profile.equippedDriver, tire: profile.equippedTire, ready: true },
      ]),
      localId: 'local',
      online: false,
    });
  }
  function startOnline() {
    const n = netRef.current;
    if (!room || !n?.isHost) return;
    setReward(null);
    inputs.current = {};
    n.startRace();
  }
  function exitRace() {
    if (race?.online) clearNetwork();
    setRace(null);
    setReward(null);
  }
  function finish(state: RaceState, id: string) {
    const result = rewardRace(profileRef.current, state, id);
    if (result) {
      profileRef.current = result.profile;
      setProfile(result.profile);
      setReward({ coins: result.coins, xp: result.xp, race: state, localId: id });
    }
  }
  function chooseTrack(id: TrackId) {
    if (room) {
      if (netRef.current?.isHost) netRef.current.setTrack(id);
    } else setTrack(id);
  }
  function selectSkin(id: string) {
    setViewSkin(id);
    if (profile.owned.includes(id)) setProfile((p) => ({ ...p, equipped: id }));
  }
  function purchase() {
    const updated = buySkin(profile, viewSkin);
    if (updated) {
      setProfile(updated);
      setNotice(`${getSkin(viewSkin).name} gehört jetzt dir!`);
    }
  }
  function selectTrail(id: string) {
    setViewTrail(id);
    if (profile.ownedTrails.includes(id)) setProfile((p) => ({ ...p, equippedTrail: id }));
  }
  function purchaseTrail() {
    const updated = buyTrail(profile, viewTrail);
    if (updated) {
      setProfile(updated);
      setNotice(`${getTrail(viewTrail).name} gehört jetzt dir!`);
    }
  }
  function selectDriver(id: string) {
    setViewDriver(id);
    if (profile.ownedDrivers.includes(id)) setProfile((p) => ({ ...p, equippedDriver: id }));
  }
  function purchaseDriver() {
    const updated = buyDriver(profile, viewDriver);
    if (updated) { setProfile(updated); setNotice(`${getDriver(viewDriver).name} gehört jetzt dir!`); }
  }
  function selectTire(id: string) {
    setViewTire(id);
    if (profile.ownedTires.includes(id)) setProfile((p) => ({ ...p, equippedTire: id }));
  }
  function purchaseTire() {
    const updated = buyTire(profile, viewTire);
    if (updated) { setProfile(updated); setNotice(`${getTire(viewTire).name} gehört jetzt dir!`); }
  }
  async function copyRoom() {
    if (!room) return;
    const url = new URL(location.href);
    url.searchParams.set('room', room.code);
    try {
      await navigator.clipboard.writeText(url.href);
      setNotice('Einladungslink kopiert. Schick ihn deinen Freunden!');
    } catch {
      setNotice(`Dein Raumcode: ${room.code}`);
    }
  }
  const myRoomPlayer = room?.players.find((p) => p.id === network?.localId),
    canStart = room?.players.every((p) => p.id === room.hostId || p.ready),
    me = reward?.race.racers.find((r) => r.id === reward.localId);
  return (
    <div className={`app ${race ? 'playing' : ''}`}>
      {connectionStatus === 'reconnecting' && (
        <div className="connection-banner" role="status">
          <LoaderCircle size={16} className="spin" /> Verbindung wird wiederhergestellt …
        </div>
      )}
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            if (!race) setPage('race');
          }}
          aria-label="Pocket Circuit Start"
        >
          <span className="brand-icon">
            <Flag size={25} fill="currentColor" />
          </span>
          <span>
            POCKET
            <span>
              CIRCUIT<span className="brand-dot">®</span>
            </span>
          </span>
        </button>
        {!race && (
          <nav aria-label="Hauptnavigation">
            {(
              [
                ['race', 'Rennen', Flag],
                ['garage', 'Garage', Gamepad2],
                ['career', 'Karriere', Trophy],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                className={page === id ? 'active' : ''}
                onClick={() => {
                  setPage(id);
                  if (id === 'garage') {
                    setViewSkin(profile.equipped);
                    setViewTrail(profile.equippedTrail);
                  }
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
        )}
        <div className="profile-bar">
          <span className="coin-balance">
            <Coins size={18} />
            {profile.coins.toLocaleString('de-DE')}
          </span>
          <div className="profile-avatar" style={{ background: getSkin(profile.equipped).color }}>
            {profile.name.slice(0, 1).toUpperCase() || 'R'}
          </div>
          <div className="profile-info">
            <b>
              {profile.name || 'Rookie'}
              <span>LVL {level.toString().padStart(2, '0')}</span>
            </b>
            <div className="xp-line">
              <i style={{ width: `${((profile.xp % 250) / 250) * 100}%` }} />
            </div>
          </div>
        </div>
      </header>
      <main>
        <div
          className={`stage-wrap ${race ? 'racing-stage' : ''} ${page === 'garage' ? 'garage-stage' : ''}`}
        >
          <GameSurface
            trackId={track}
            skinId={page === 'garage' ? viewSkin : profile.equipped}
            driverId={page === 'garage' ? viewDriver : profile.equippedDriver}
            tireId={page === 'garage' ? viewTire : profile.equippedTire}
            trailId={page === 'garage' ? viewTrail : profile.equippedTrail}
            quality={quality}
            onQuality={setQuality}
            race={race}
            network={network}
            remoteInputs={inputs}
            onFinish={finish}
            onExit={exitRace}
          />
          {!race && (
            <>
              <div className="scene-shade" />
              <div className="scene-topline">
                <span className="eyebrow">
                  <i /> {page === 'garage' ? 'DEINE GARAGE' : 'THE POCKET RACING CLUB'}
                </span>
                <div className="scene-tools">
                  <label className="quality-control">
                    <span>GRAFIK</span>
                    <select
                      aria-label="Grafikqualität"
                      value={quality}
                      onChange={(e) => setQuality(e.target.value as GraphicsQuality)}
                    >
                      <option value="high">Hoch</option>
                      <option value="balanced">Flüssig</option>
                    </select>
                  </label>
                  <button className="help-button" onClick={() => setHelp(true)}>
                    <Keyboard size={16} /> Steuerung
                  </button>
                </div>
              </div>
              <div className="scene-copy">
                <span className="outlined-tag">
                  {page === 'garage'
                    ? 'BUILT FOR YOU'
                    : page === 'career'
                      ? 'ONE MORE LAP'
                      : '3 RUNDEN. ALLES GEBEN.'}
                </span>
                <h1>
                  {page === 'garage' ? (
                    <>
                      DEIN KART.
                      <br />
                      <em>DEIN STIL.</em>
                    </>
                  ) : page === 'career' ? (
                    <>
                      JEDE RUNDE
                      <br />
                      <em>ZÄHLT.</em>
                    </>
                  ) : (
                    <>
                      KLEINE KARTS.
                      <br />
                      <em>GROSSE RENNEN.</em>
                    </>
                  )}
                </h1>
                <p>
                  {page === 'garage'
                    ? 'Verdiene Münzen. Finde deinen Look.'
                    : page === 'career'
                      ? 'Deine Bestzeiten, Siege und nächsten Meilensteine.'
                      : 'Driften, boosten, Freunde überholen.'}
                </p>
                <div className="scene-meta">
                  <span>
                    <Users size={16} /> BIS ZU 4 FREUNDE
                  </span>
                  <span>
                    <Flag size={15} /> 3 STRECKEN
                  </span>
                </div>
              </div>
              <div className="scene-track">
                <span>JETZT AUF DER STRECKE</span>
                <b>
                  {selectedTrack.name}
                  <ArrowUpRight size={20} />
                </b>
                <div>
                  0{TRACKS.indexOf(selectedTrack) + 1} <i /> {TRACK_WEATHER[track]}
                </div>
              </div>
              <span className="live-scene-label">LIVE 3D PREVIEW</span>
            </>
          )}
        </div>
        {!race && page === 'race' && (
          <div className="race-setup">
            <section className="track-section">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">01 / DIE STRECKE</span>
                  <h2>Wo geht’s hin?</h2>
                </div>
                <span className="subtle">Alle Strecken freigeschaltet</span>
              </div>
              <div className="track-grid">
                {TRACKS.map((t, i) => (
                  <button
                    key={t.id}
                    className={`track-card ${track === t.id ? 'selected' : ''} ${t.id}`}
                    onClick={() => chooseTrack(t.id)}
                    disabled={!!room && !network?.isHost}
                    aria-pressed={track === t.id}
                  >
                    <div className="track-art">
                      <span className="track-number">0{i + 1}</span>
                      <TrackOutline id={t.id} />
                      <span className="track-selection">
                        {track === t.id ? <Check size={16} /> : <ArrowUpRight size={16} />}
                      </span>
                    </div>
                    <div className="track-copy">
                      <span>{t.difficulty}</span>
                      <h3>{t.name}</h3>
                      <p>{t.subtitle}</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="control-strip">
                <span>
                  <kbd>W A S D</kbd> Fahren
                </span>
                <span>
                  <kbd>SHIFT</kbd> Driften & Boost
                </span>
                <span>
                  <kbd>SPACE</kbd> Item benutzen
                </span>
              </div>
            </section>
            <section className="session-panel">
              <span className="eyebrow">02 / DEIN RENNEN</span>
              <div className="mode-switch">
                <button
                  className={mode === 'solo' ? 'selected' : ''}
                  onClick={() => {
                    setMode('solo');
                    clearNetwork();
                  }}
                >
                  <Gamepad2 size={16} /> Solo-Rennen
                </button>
                <button
                  className={mode === 'online' ? 'selected' : ''}
                  onClick={() => setMode('online')}
                >
                  <Users size={16} /> Mit Freunden
                </button>
              </div>
              {!room && (
                <label className="name-field">
                  FAHRERNAME
                  <input
                    aria-label="Fahrername"
                    value={profile.name}
                    maxLength={18}
                    onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Dein Name"
                    autoComplete="nickname"
                  />
                </label>
              )}
              {mode === 'solo' ? (
                <>
                  <div className="session-description">
                    <span className="session-symbol">
                      <Flag size={20} />
                    </span>
                    <div>
                      <b>Die Startaufstellung steht.</b>
                      <p>Du + 5 KI-Fahrer · 3 Runden</p>
                    </div>
                  </div>
                  <button className="primary start-button" onClick={startSolo}>
                    Auf die Strecke <ArrowRight size={20} />
                  </button>
                </>
              ) : room ? (
                <>
                  <div className="room-heading">
                    <div>
                      <span>DEIN RAUMCODE</span>
                      <strong>{room.code}</strong>
                    </div>
                    <button
                      className="icon-button"
                      onClick={copyRoom}
                      aria-label="Einladungslink kopieren"
                    >
                      <Copy size={17} />
                    </button>
                  </div>
                  <div className="room-players">
                    {room.players.map((p) => (
                      <div key={p.id}>
                        <i style={{ background: getSkin(p.skin).color }} />
                        <b>{p.name}</b>
                        <span>{p.id === room.hostId ? 'HOST' : p.ready ? 'BEREIT' : 'WARTET'}</span>
                        {p.ready && <Check size={13} />}
                      </div>
                    ))}
                    <small>{room.players.length}/4 Fahrer · freie Plätze fahren mit KI</small>
                  </div>
                  {network?.isHost ? (
                    <button className="primary" disabled={!canStart} onClick={startOnline}>
                      {canStart ? 'Rennen starten' : 'Warte auf deine Freunde'}
                      <Flag size={17} />
                    </button>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => network?.setReady(!myRoomPlayer?.ready)}
                    >
                      {myRoomPlayer?.ready ? 'Bereit! Warten auf Host' : 'Ich bin bereit'}
                      <Check size={17} />
                    </button>
                  )}
                  <button className="text-button" onClick={clearNetwork}>
                    Raum verlassen
                  </button>
                </>
              ) : (
                <>
                  <button className="primary" onClick={() => connect(false)} disabled={busy}>
                    {busy ? <LoaderCircle className="spin" size={19} /> : <Plus size={19} />} Raum
                    erstellen
                  </button>
                  <div className="join-row">
                    <input
                      aria-label="Raumcode"
                      placeholder="RAUMCODE"
                      value={joinCode}
                      maxLength={6}
                      onChange={(e) =>
                        setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                      }
                    />
                    <button
                      aria-label="Raum beitreten"
                      onClick={() => connect(true)}
                      disabled={busy || joinCode.length !== 6}
                    >
                      <ArrowRight size={19} />
                    </button>
                  </div>
                  <p className="online-note">
                    <Wifi size={13} /> Server-Multiplayer. Code teilen. Losfahren.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
        {!race && page === 'garage' && (
          <section className="garage-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  DIE KOLLEKTION / {profile.owned.length} VON {SKINS.length}
                </span>
                <h2>Guter Stil. Gleiche Chancen.</h2>
              </div>
              <p className="subtle">Alle Skins haben die gleichen Fahrwerte.</p>
            </div>
            <div className="skin-grid">
              {SKINS.map((s) => (
                <button
                  key={s.id}
                  className={`skin-card ${viewSkin === s.id ? 'selected' : ''}`}
                  onClick={() => selectSkin(s.id)}
                >
                  <div
                    className="skin-swatch"
                    style={{ '--skin': s.color, '--accent': s.accent } as React.CSSProperties}
                  >
                    <span className="skin-monogram">
                      {s.name
                        .split(' ')
                        .map((w) => w[0])
                        .join('')}
                    </span>
                    {profile.equipped === s.id ? (
                      <span className="skin-status">
                        <Check size={14} /> AKTIV
                      </span>
                    ) : (
                      !profile.owned.includes(s.id) && <Lock size={15} className="skin-lock" />
                    )}
                  </div>
                  <div>
                    <small>{s.label}</small>
                    <h3>{s.name}</h3>
                    <span>
                      {profile.owned.includes(s.id) ? (
                        'In deiner Garage'
                      ) : (
                        <>
                          <Coins size={13} /> {s.price} <em>· Level {s.level}</em>
                        </>
                      )}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="garage-buy">
              <span>
                <b>{getSkin(viewSkin).name}</b>
                <p>
                  {profile.owned.includes(viewSkin)
                    ? 'Bereit für die nächste Startaufstellung.'
                    : `Freischaltbar ab Level ${getSkin(viewSkin).level} für ${getSkin(viewSkin).price} Münzen.`}
                </p>
              </span>
              {profile.owned.includes(viewSkin) ? (
                <button
                  className="primary"
                  onClick={() => {
                    setPage('race');
                    setNotice('Dein Skin ist für das nächste Rennen ausgerüstet.');
                  }}
                >
                  Zum Rennen <ArrowRight size={18} />
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={
                    level < getSkin(viewSkin).level || profile.coins < getSkin(viewSkin).price
                  }
                  onClick={purchase}
                >
                  {level < getSkin(viewSkin).level
                    ? `Ab Level ${getSkin(viewSkin).level}`
                    : profile.coins < getSkin(viewSkin).price
                      ? 'Noch Münzen sammeln'
                      : 'Skin freischalten'}
                  <Coins size={18} />
                </button>
              )}
            </div>
            <div className="section-heading trail-heading">
              <div>
                <span className="eyebrow">DEIN ANTRIEB / {profile.ownedTrails.length} VON {TRAILS.length}</span>
                <h2>Deine Spur im Rennen.</h2>
              </div>
              <Sparkles size={22} />
            </div>
            <div className="trail-grid">
              {TRAILS.map((trail) => (
                <button
                  key={trail.id}
                  className={`trail-card ${viewTrail === trail.id ? 'selected' : ''}`}
                  onClick={() => selectTrail(trail.id)}
                >
                  <span className="trail-swatch" style={{ '--trail': trail.color } as React.CSSProperties}>
                    <i /><i /><i /><i />
                  </span>
                  <span className="trail-details">
                    <small>{trail.label}</small>
                    <b>{trail.name}</b>
                    <em>{profile.equippedTrail === trail.id ? 'AKTIV' : profile.ownedTrails.includes(trail.id)
                      ? 'In deiner Garage' : `${trail.price} Münzen · Level ${trail.level}`}</em>
                  </span>
                  {profile.ownedTrails.includes(trail.id) ? <Check size={16} /> : <Lock size={16} />}
                </button>
              ))}
            </div>
            {!profile.ownedTrails.includes(viewTrail) && (
              <div className="garage-buy">
                <span>
                  <b>{getTrail(viewTrail).name}</b>
                  <p>Schalte diesen Trail frei und zeig ihn deinen Freunden im Rennen.</p>
                </span>
                <button className="primary" onClick={purchaseTrail}
                  disabled={level < getTrail(viewTrail).level || profile.coins < getTrail(viewTrail).price}>
                  {level < getTrail(viewTrail).level ? `Ab Level ${getTrail(viewTrail).level}`
                    : profile.coins < getTrail(viewTrail).price ? 'Noch Münzen sammeln' : 'Trail freischalten'}
                  <Coins size={18} />
                </button>
              </div>
            )}
            <div className="section-heading trail-heading"><div><span className="eyebrow">FAHRER / {profile.ownedDrivers.length} VON {DRIVERS.length}</span><h2>Wer sitzt am Steuer?</h2></div><Sparkles size={22} /></div>
            <div className="cosmetic-grid">
              {DRIVERS.map((item) => <button key={item.id} className={`cosmetic-card ${viewDriver === item.id ? 'selected' : ''}`} onClick={() => selectDriver(item.id)}>
                <span className="cosmetic-icon helmet-icon" style={{ '--cosmetic': item.color } as React.CSSProperties}>●</span>
                <span><small>{item.label}</small><b>{item.name}</b><em>{profile.equippedDriver === item.id ? 'AKTIV' : profile.ownedDrivers.includes(item.id) ? 'In deiner Garage' : `${item.price} Münzen · Level ${item.level}`}</em></span>
                {profile.ownedDrivers.includes(item.id) ? <Check size={16} /> : <Lock size={16} />}
              </button>)}
            </div>
            {!profile.ownedDrivers.includes(viewDriver) && <div className="garage-buy"><span><b>{getDriver(viewDriver).name}</b><p>Ein neuer Look für deinen Fahrer.</p></span><button className="primary" onClick={purchaseDriver} disabled={level < getDriver(viewDriver).level || profile.coins < getDriver(viewDriver).price}>{level < getDriver(viewDriver).level ? `Ab Level ${getDriver(viewDriver).level}` : profile.coins < getDriver(viewDriver).price ? 'Noch Münzen sammeln' : 'Fahrer freischalten'} <Coins size={18} /></button></div>}
            <div className="section-heading trail-heading"><div><span className="eyebrow">REIFEN / {profile.ownedTires.length} VON {TIRES.length}</span><h2>Dein Grip. Dein Stil.</h2></div><Sparkles size={22} /></div>
            <div className="cosmetic-grid">
              {TIRES.map((item) => <button key={item.id} className={`cosmetic-card ${viewTire === item.id ? 'selected' : ''}`} onClick={() => selectTire(item.id)}>
                <span className="cosmetic-icon tire-icon" style={{ '--cosmetic': item.color } as React.CSSProperties}>◉</span>
                <span><small>{item.label}</small><b>{item.name}</b><em>{profile.equippedTire === item.id ? 'AKTIV' : profile.ownedTires.includes(item.id) ? 'In deiner Garage' : `${item.price} Münzen · Level ${item.level}`}</em></span>
                {profile.ownedTires.includes(item.id) ? <Check size={16} /> : <Lock size={16} />}
              </button>)}
            </div>
            {!profile.ownedTires.includes(viewTire) && <div className="garage-buy"><span><b>{getTire(viewTire).name}</b><p>Reifen für dein nächstes Rennen.</p></span><button className="primary" onClick={purchaseTire} disabled={level < getTire(viewTire).level || profile.coins < getTire(viewTire).price}>{level < getTire(viewTire).level ? `Ab Level ${getTire(viewTire).level}` : profile.coins < getTire(viewTire).price ? 'Noch Münzen sammeln' : 'Reifen freischalten'} <Coins size={18} /></button></div>}
            {room && (
              <p className="subtle">
                Neue Garage-Teile gelten im nächsten erstellten oder betretenen Raum.
              </p>
            )}
          </section>
        )}
        {!race && page === 'career' && (
          <section className="career-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">DEIN FAHRERPROFIL</span>
                <h2>Vom Rookie zur Legende.</h2>
              </div>
              <span className="local-badge">Auf diesem Gerät gespeichert</span>
            </div>
            <div className="career-grid">
              <div className="level-card">
                <span className="eyebrow">AKTUELLES LEVEL</span>
                <strong>{level.toString().padStart(2, '0')}</strong>
                <b>
                  {level >= 10
                    ? 'Circuit Legend'
                    : level >= 5
                      ? 'Pro Driver'
                      : level >= 3
                        ? 'Club Racer'
                        : 'Rookie'}
                </b>
                <div className="xp-line">
                  <i style={{ width: `${((profile.xp % 250) / 250) * 100}%` }} />
                </div>
                <small>{profile.xp % 250} / 250 XP zum nächsten Level</small>
              </div>
              <div className="career-stats">
                <div>
                  <Flag />
                  <strong>{profile.races}</strong>
                  <span>Rennen beendet</span>
                </div>
                <div>
                  <Trophy />
                  <strong>{profile.wins}</strong>
                  <span>Siege eingefahren</span>
                </div>
                <div>
                  <Gamepad2 />
                  <strong>{profile.owned.length}</strong>
                  <span>Skins gesammelt</span>
                </div>
              </div>
              <div className="best-times">
                <span className="eyebrow">DEINE BESTZEITEN / 3 RUNDEN</span>
                {TRACKS.map((t) => (
                  <div key={t.id}>
                    <i style={{ background: t.color }} />
                    <b>{t.name}</b>
                    <span>{formatTime(profile.bestTimes[t.id])}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="career-tip">
              <Zap size={20} />
              <p>
                Jedes abgeschlossene Rennen bringt XP und Münzen. Eine gute Platzierung und
                eingesammelte Münzen geben extra Belohnungen.
              </p>
              <button className="text-button" onClick={() => setPage('race')}>
                Nächstes Rennen <ArrowRight size={16} />
              </button>
            </div>
          </section>
        )}
      </main>
      {!race && (
        <footer>
          <span>
            POCKET CIRCUIT <i /> ONE MORE LAP.
          </span>
          <span>
            Indie Kart Racing <span className="footer-divider">/</span> v1.2
          </span>
        </footer>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button aria-label="Hinweis schließen" onClick={() => setNotice('')}>
            <X size={17} />
          </button>
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div
            className="dialog-card help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Steuerung"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-dialog icon-button"
              aria-label="Schließen"
              onClick={() => setHelp(false)}
            >
              <X />
            </button>
            <span className="eyebrow">DEIN ERSTES RENNEN</span>
            <h2>
              Leicht zu lernen.
              <br />
              Schwer einzuholen.
            </h2>
            <div className="help-row">
              <kbd>W / ↑</kbd>
              <span>Gas geben</span>
            </div>
            <div className="help-row">
              <kbd>S / ↓</kbd>
              <span>Bremsen & rückwärts fahren</span>
            </div>
            <div className="help-row">
              <kbd>A D / ← →</kbd>
              <span>Lenken</span>
            </div>
            <div className="help-row">
              <kbd>SHIFT</kbd>
              <span>In der Kurve halten, für Drift-Boost loslassen</span>
            </div>
            <div className="help-row">
              <kbd>SPACE</kbd>
              <span>Turbo, Schild oder Impuls einsetzen</span>
            </div>
            <div className="help-row">
              <kbd>ESC</kbd>
              <span>Rennmenü öffnen</span>
            </div>
            <p>
              Fahre durch die schwebenden Item-Boxen. Sammle Münzen und beende drei Runden. Auf dem
              Handy steuerst du mit den Bildschirmtasten.
            </p>
            <button className="primary" onClick={() => setHelp(false)}>
              Alles klar <Check size={17} />
            </button>
          </div>
        </div>
      )}
      {reward && me && (
        <div className="result-overlay">
          <div className="finish-burst" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ '--i': i, left: `${(i * 43) % 100}%` } as React.CSSProperties} />)}</div>
          <div className="result-card">
            <span className="eyebrow">
              {me.finishTime === null ? 'ZEITLIMIT ERREICHT' : 'ZIELLINIE ÜBERQUERT'}
            </span>
            <span className="result-position">
              {me.position}
              <em>.</em>
            </span>
            <h2>
              {me.finishTime === null
                ? 'Bis zur nächsten Runde.'
                : me.position === 1
                  ? 'Das ist dein Podium.'
                  : me.position <= 3
                    ? 'Starkes Rennen!'
                    : 'Jede Runde macht schneller.'}
            </h2>
            <p>
              {getTrack(reward.race.trackId).name} <span>·</span> {formatTime(me.finishTime)}
            </p>
            <div className="reward-row">
              <span>
                <Coins /> +{reward.coins}
                <small>MÜNZEN</small>
              </span>
              <span>
                <Zap /> +{reward.xp}
                <small>XP</small>
              </span>
            </div>
            <div className="result-ranking">
              {[...reward.race.racers]
                .sort((a, b) => a.position - b.position)
                .map((r) => (
                  <div className={r.id === reward.localId ? 'is-me' : ''} key={r.id}>
                    <b>{r.position.toString().padStart(2, '0')}</b>
                    <i style={{ background: getSkin(r.skin).color }} />
                    <span>{r.name}</span>
                    <small>
                      {r.finished
                        ? r.finishTime === null
                          ? 'Zeitlimit'
                          : formatTime(r.finishTime)
                        : 'Noch im Rennen'}
                    </small>
                  </div>
                ))}
            </div>
            {!race?.online ? (
              <>
                <button className="primary" onClick={startSolo}>
                  Noch eine Runde <RotateIcon />
                </button>
                <button className="text-button" onClick={exitRace}>
                  Zurück zur Garage & Streckenauswahl
                </button>
              </>
            ) : network?.isHost ? (
              <button
                className="primary"
                disabled={reward.race.racers.some((r) => !r.bot && !r.finished)}
                onClick={() => {
                  network.returnToLobby();
                  setReward(null);
                  setRace(null);
                }}
              >
                {reward.race.racers.some((r) => !r.bot && !r.finished)
                  ? 'Freunde noch im Rennen …'
                  : 'Alle zurück zur Lobby'}
                <ArrowRight size={18} />
              </button>
            ) : (
              <>
                <p>Der Host startet das nächste Rennen.</p>
                <button className="secondary" onClick={exitRace}>
                  Raum verlassen
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function RotateIcon() {
  return <Flag size={18} />;
}
function TrackOutline({ id }: { id: TrackId }) {
  const points = trackSamples(id).filter((_, i) => i % 6 === 0);
  const xs = points.map((p) => p.x),
    zs = points.map((p) => p.z),
    minX = Math.min(...xs) - 28,
    minZ = Math.min(...zs) - 28,
    w = Math.max(...xs) - minX + 28,
    h = Math.max(...zs) - minZ + 28;
  return (
    <svg viewBox={`${minX} ${minZ} ${w} ${h}`} aria-label={`Streckenverlauf ${getTrack(id).name}`}>
      <polyline
        points={points.map((p) => `${p.x},${p.z}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={points[0]?.x}
        cy={points[0]?.z}
        r="10"
        fill="currentColor"
        stroke="#182324"
        strokeWidth="4"
      />
    </svg>
  );
}
