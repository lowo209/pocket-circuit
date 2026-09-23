# Pocket Circuit 🏁

> **Standalone Godot rebuild in development:** the new Windows/GDScript project lives in [`godot/`](godot/README.md). Its v0.4 development preview overhauls all three environments: an ocean causeway, a drive-through desert pyramid with drifting sand, and a dense cyberpunk NEON City with moving air taxis. Solo races, adaptive opponents and editable maps remain included. The web version documented below remains the original prototype; the standalone build is not yet an official stable release.

Ein eigenständiger 3D-Kart-Racer für den Browser: private Multiplayer-Räume, drei Strecken, Drift-Boosts, Items und freischaltbare Skins. Eigene prozedurale Grafiken, ohne Nintendo-Assets.

![Pocket Circuit](docs/preview.png)

## Auf Vercel starten

1. Dieses Repository in [Vercel](https://vercel.com/new) importieren. Framework **Vite**, Projektverzeichnis `/`, Node.js **22.x**. Build und Ausgabe stehen in `vercel.json`.
2. Im Projekt **Storage → Create Database → Redis** wählen und die Datenbank mit dem Projekt verbinden. Die Integration setzt die geheime Servervariable `REDIS_URL`. Alternativ funktioniert eine native Redis-/Upstash-TCP-Verbindung als `REDIS_URL`; ein REST-Endpunkt genügt nicht.
3. Datenbank möglichst in **Frankfurt / AWS eu-central-1** anlegen, passend zur Function-Region `fra1`. **Fluid Compute** muss in den Projekteinstellungen aktiviert sein (bei neuen Projekten Standard).
4. Neu deployen, die HTTPS-Adresse öffnen und **Mit Freunden → Raum erstellen** wählen. Freunde öffnen dieselbe Website und geben den Code ein oder verwenden den Einladungslink.

**Der gesamte Multiplayer läuft über Vercel:** Browser verbinden sich per `wss://<deine-domain>/api/ws` mit der Vercel Function. Sie berechnet Rennen, KI, Kollisionen, Items und Ergebnisse. Redis aus dem Vercel Marketplace hält Räume und laufende Rennen über Function-Instanzen hinweg zusammen. Es gibt keinen PeerJS-Dienst, keinen WebRTC-/TURN-Server und keine direkte Verbindung zwischen Geräten.

Vercel [unterstützt WebSockets derzeit in Beta](https://vercel.com/docs/functions/websockets). Verbindungen werden vor dem Function-Zeitlimit erneuert; die Sitzung setzt sich mit demselben Fahrer fort. Ohne Redis zeigt Multiplayer eine verständliche Einrichtungsmeldung, statt einen unzuverlässigen Produktionsraum im Arbeitsspeicher anzulegen. Solo benötigt keine Datenbank. Vercel- und Datenbank-Planlimits gelten; kostenlose Pläne sind nicht unbegrenzt.

## Spielen

- **Solo:** du gegen fünf KI-Fahrer. **Multiplayer:** bis zu vier Menschen, auf sechs Fahrer mit KI aufgefüllt.
- **Sunset Bay:** Strandpromenade, Leuchtturm, Strandhütten und lange Küstenkurven.
- **Dust Valley:** Canyon-Kehren, Felsbögen und Minenabschnitte.
- **Neon Harbor:** Hafen-Schikanen, Container, Kräne und beleuchtete Durchfahrten im Regen.
- Drei Runden mit Countdown, Platzierungen, Bestzeiten und Ergebnisbildschirm.
- Driften und aufgeladene Boosts; Turbo, Schild und Impuls aus Item-Boxen.
- Münzen, XP, Level und sechs kosmetische Skins mit identischen Fahrwerten.
- Klarlack, Metallfelgen, HDR-Licht sowie planare Spiegelungen auf Wasser und nassem Asphalt.
- Wetter, gelenkte und rotierende Räder, Federung, Bremslichter und Drift-/Aufprallpartikel.
- Grafik **Hoch / Flüssig**, Tastatur und Touch-Steuerung.

![Neon Harbor](docs/neon-harbor.png)

| Taste | Aktion |
| --- | --- |
| W / ↑ | Gas |
| S / ↓ | Bremsen / rückwärts |
| A / ← | Links lenken |
| D / → | Rechts lenken |
| Shift + Lenken | Driften; nach Aufladen loslassen für Boost |
| Leertaste | Item |
| Esc | Pause / Rennmenü |

Online läuft die Simulation auf dem Server weiter, auch wenn ein Spieler das Rennmenü öffnet oder seinen Tab in den Hintergrund legt. Verbindungsabbrüche lösen eine automatische Wiederverbindung aus. Bei Ausstieg übernimmt KI das Kart; falls der Raumersteller geht, übernimmt ein anderer Spieler die Lobby-Verwaltung. Neue Spieler können erst nach dem Rennen beitreten. Rennen enden spätestens nach vier Minuten; nicht angekommene Fahrer bekommen keine Bestzeit.

Fortschritt wird je Browser in `localStorage` gespeichert und ist nicht kontogebunden. Das Spiel bietet private Freundesrunden, keine Accounts, öffentliche Spielersuche oder Cloud-Spielstände. Serverberechnete Rennen verhindern vom Client erfundene Positionen; lokale Münzen/XP sind weiterhin lokal veränderbar.

## Lokal entwickeln und prüfen

Node.js ≥ 22.12:

```bash
npm ci
npm run dev
```

Der Vite-Server enthält auch den Multiplayer-WebSocket-Endpunkt. Ohne `REDIS_URL` teilen lokale Geräte einen Entwicklungsraum im selben Serverprozess. Zum Testen auf zwei Geräten dieselbe von Vite ausgegebene LAN-Adresse öffnen; `localhost` verweist auf jedem Gerät auf das jeweilige Gerät selbst.

```bash
npm test              # Lenkung, Rennphysik, Fortschritt, Protokoll und Backend
npm run build         # Frontend UND Backend-Typprüfung, Produktionsbuild
npm run test:e2e      # Mehrere Browser, Lobby, serverseitiges Fahren, Mobile
npm run test:graphics # Alle Strecken, Grafikmodi, Shader und Screenshots
```

Browser-Tests benötigen Edge unter Windows oder `npx playwright install chromium` auf anderen Systemen. `PW_BROWSER_CHANNEL` überschreibt die Browserwahl. Die Tests starten eigene Server auf Ports 5183/5184; Screenshots landen im ignorierten Ordner `test-results/`. Tests mit `REDIS_URL` können dieselbe echte Redis-Implementierung verwenden. `npm run preview` liefert nur den statischen Build; für lokalen Multiplayer `npm run dev` verwenden.

## Aufbau

```text
api/ws.ts               Vercel-WebSocket-Function
server/multiplayer.ts   Verbindungen, Validierung, Wiederverbindung
server/rooms.ts         Räume, Berechtigungen, serverseitige Simulation
server/store.ts         Redis-CAS, Sitzungen, Eingaben und TTL
src/App.tsx             Menü, Garage, Karriere, Lobby und Ergebnisse
src/GameSurface.tsx     Solo-Spielschleife, Eingaben und HUD
src/network.ts          WebSocket-Client und Wiederverbindung
src/game/simulation.ts  Fahrphysik, KI, Items, Runden, Zustandsexport
src/game/renderer.ts    Three.js-Welten und Kamera
src/game/trackScenery.ts Strecken-Landmarks
src/game/kartVisuals.ts Karts und Animationen
src/game/environment.ts HDR-Himmel, Materialien, Spiegelungen
src/game/weather.ts     Regen, Spritzringe, Wolken und Staub
src/profile.ts          Geräte-lokaler Fortschritt
```

Räume speichern keine Klartext-Sitzungstokens: serverseitig liegt nur ein Hash. Schreibzugriffe werden per atomarem Redis-Vergleich serialisiert; mehrere Function-Instanzen können ein Rennen nicht doppelt fortschreiben. Eingaben sind an Verbindung, Renn-ID und aufsteigende Sequenz gebunden. Räume laufen nach Inaktivität ab. Datenbank-Geheimnisse gehören ausschließlich in Servervariablen, niemals in `VITE_*` oder Git.

Stack: React, TypeScript, Vite, Three.js, native WebSockets (`ws`), Redis (`ioredis`). Google Fonts ist optional; Systemschriften dienen als Fallback.
