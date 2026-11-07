# API Depot 5.0

> Pre koho: kto píše klienta, skript alebo kapitolu dokumentácie. Vygenerované z OpenAPI oboch backendov
> skriptom `tools/gen_api_docs.py`, interaktívne: http://localhost:8000/api/docs a http://localhost:8080/docs.

**Prístup:**
- **app:** session cookie po `POST /api/auth/login`, každý endpoint má `require_role(...)` (ADR-017). Admin smie všetko.
  `/internal/*` volá len telematika so `X-Service-Token`. `POST` z prehliadača musí mať správny `Origin` (CSRF).
- **telematika:** `GET /sim/clock` a `/health` sú verejné, ostatné potrebujú `Authorization: Bearer <ticket>` (ticket z
  `POST /api/auth/ws-ticket`, 60 s) alebo `X-Service-Token`. Ovládanie simulácie len admin a `SIM_CONTROLS_ENABLED=true` (ADR-053).
- Nové API sú v camelCase (ADR-036), chyby po anglicky (ADR-019).

## Hlavný backend (app, Python FastAPI)

Základná adresa: `http://localhost:8000`. 48 ciest.

| Skupina | Metóda | Cesta | Popis |
| --- | --- | --- | --- |
| actions | GET | `/api/maintenance` | Maintenance Orders |
| actions | PATCH | `/api/trips/{trip_id}/door` | Move Trip |
| actions | POST | `/api/devices/{code}/maintenance` | Start Maintenance |
| admin | GET | `/api/admin/directions` | List Directions |
| admin | GET | `/api/admin/notifications` | Notifications |
| admin | GET | `/api/admin/users` | List Users |
| admin | PATCH | `/api/admin/directions/{direction_id}` | Update Direction |
| admin | PATCH | `/api/admin/users/{user_id}` | Update User |
| admin | POST | `/api/admin/users` | Create User |
| auth | GET | `/api/auth/me` | Me |
| auth | POST | `/api/auth/login` | Login |
| auth | POST | `/api/auth/logout` | Logout |
| auth | POST | `/api/auth/ws-ticket` | Ws Ticket |
| courier | GET | `/api/courier/route` | My Route |
| courier | GET | `/api/courier/routes` | Routes |
| courier | POST | `/api/courier/stops/{stop_id}` | Finish Stop |
| courier | POST | `/api/courier/scan` | Skener spárovaný s dodávkou: pred odchodom naloží balík, potom vyberie zastávku (ADR-062) |
| dashboard | GET | `/api/alerts` | List Alerts |
| dashboard | GET | `/api/board` | Board |
| dashboard | GET | `/api/dashboard` | Dashboard |
| dashboard | POST | `/api/alerts/{alert_id}/ack` | Ack Alert |
| depots | GET | `/api/depots` | Depots |
| depots | GET | `/api/depots/{code}/state` | Depot State |
| depots | GET | `/api/layout` | Layout |
| fleet | GET | `/api/fleet/vehicles` | Vehicles |
| fleet | GET | `/api/fleet/vehicles/{plate}` | Vehicle Detail |
| fleet | GET | `/api/parcels` | Search Parcels |
| fleet | GET | `/api/parcels/{parcel_id}` | Parcel Detail |
| gate | POST | `/api/gate/detect` | Fotka → typ, ŠPZ, rozhodnutie pravidiel, prejazd (ADR-059, 061) |
| gate | GET | `/api/gate/queue` | Front rozhodnutí ochranky (zastavené vozidlá, kamióny na overenie) |
| gate | GET | `/api/gate/events` | Prejazdy dňa s rozhodnutím a auditom |
| gate | POST | `/api/gate/events/{event_id}/decision` | Ochranka: povoliť / zamietnuť (s dôvodom), overiť |
| gate | GET | `/api/gate/allowed-plates` | Povolené externé ŠPZ |
| gate | POST | `/api/gate/allowed-plates` | Pridať povolenú ŠPZ |
| gate | DELETE | `/api/gate/allowed-plates/{plate_id}` | Odobrať povolenú ŠPZ |
| internal | GET | `/internal/courier-routes` | Courier Plan |
| internal | GET | `/internal/manifest` | Get Manifest |
| internal | GET | `/internal/plan` | Get Plan |
| internal | POST | `/internal/alerts` | Post Alert |
| internal | POST | `/internal/days/{day}/reset` | Reset Day |
| internal | POST | `/internal/events/couriers` | Courier Events |
| internal | POST | `/internal/events/scans` | Scan Events |
| internal | POST | `/internal/events/trips` | Trip Events |
| loading | GET | `/api/loading/doors` | Doors |
| loading | GET | `/api/loading/doors/{code}` | Door View |
| loading | POST | `/api/loading/doors/{code}/scan` | Manual Scan |
| ml | GET | `/api/ml/delay/trips/{trip_id}` | Predict Trip Delay |
| ml | GET | `/api/ml/scanners` | Scanner Risks |
| ml | GET | `/api/ml/status` | Ml Status |
| shadow | GET | `/api/shadow/doors/{code}` | Dock Detail |
| shadow | GET | `/api/shadow/parcels/{barcode}` | Locate Parcel |
| shadow | GET | `/api/shadow/{depot}` | Shadow |
| system | GET | `/api/config` | Public Config |
| system | GET | `/api/health` | Health |
| system | GET | `/api/hello` | Hello |
| tracking | GET | `/api/track/{token}` | Track |

## Telematika (Node.js Fastify)

Základná adresa: `http://localhost:8080`. 27 ciest. WebSocket: `ws://localhost:8080/ws?ticket=…` (kanály clock, vehicles, devices, alerts).

| Skupina | Metóda | Cesta | Popis |
| --- | --- | --- | --- |
| devices | GET | `/devices` | Zariadenia so stavom a čítanosťou |
| devices | GET | `/devices/{code}/metrics` | Čítanosť zariadenia po 10 minútach (sparkline) |
| devices | POST | `/devices/{code}/heartbeat` | Heartbeat reálneho zariadenia |
| devices | POST | `/devices/{code}/scans` | Skeny z reálneho zariadenia (rovnaké spracovanie ako simulované) |
| internal | GET | `/internal/vehicles/{plate}` | Aktuálna poloha vozidla (volá app) |
| internal | POST | `/internal/broadcast` | Rozoslať udalosť klientom WebSocketu (volá app) |
| internal | POST | `/internal/devices/{code}/maintenance` | Zariadenie označené na údržbu vo WMS (volá app) |
| internal | POST | `/internal/events/gate` | Simulované prejazdy brány do app, rozhodnú ich pravidlá (ADR-061) |
| internal | POST | `/internal/gate/passages` | Prejazd z reálnej kamery brány (CV v app, ADR-059) |
| internal | POST | `/internal/plan/reload` | Plán sa zmenil (jazda na inú bránu): načítať ho znova (volá app) |
| simulation | GET | `/routes` | Trasy kamiónov po reálnych cestách (pre mapu) |
| simulation | GET | `/routes/vehicle/{plate}` | Zvyšná trasa dodávky kuriéra po uliciach (pre mapu) |
| simulation | GET | `/sim/clock` | Simulovaný čas (verejné) |
| simulation | GET | `/sim/scenario` | Prehľad scenára načítaných dní |
| simulation | GET | `/sim/seed` | Aktuálny seed |
| simulation | GET | `/sim/situations` | Pomenované situácie na demo a testy (seed, čas, prepínače scenára, ADR-054) |
| simulation | POST | `/sim/clock/jump` | Skok vpred na najbližší čas HH:MM. mode=skip preskočí úsek bez dát (ADR-025), mode=replay ho rýchlo dosimuluje so skenmi, prejazdmi a alarmami (ADR-053, admin) |
| simulation | POST | `/sim/clock/pause` | Pozastaviť hodiny (admin) |
| simulation | POST | `/sim/clock/resume` | Spustiť hodiny (admin) |
| simulation | POST | `/sim/clock/step` | Krok o N simulovaných minút s dátami, napr. +5 / +15 / +60 (rovnaký kód ako skok v režime replay, admin) |
| simulation | POST | `/sim/reset` | Čistý reset dňa: seed z .env, zapnuté zariadenia, bez údržby, presunov jázd a alarmov dňa, staršie alarmy uzavreté, deň od 15:00 (admin) |
| simulation | POST | `/sim/restart-day` | Prehrať aktuálny prevádzkový deň znova od 15:00 (admin) |
| simulation | POST | `/sim/situations/{id}` | Načítať situáciu: čistý reset s jej seedom a prepínačmi, potom pretočenie s dátami do jej času (admin) |
| simulation | POST | `/sim/what-if` | Scenár čo ak: KPI plán vs. scenár do konca prevádzkového dňa (dispečer) |
| simulation | PUT | `/sim/clock/speed` | Rýchlosť simulácie, násobok reálneho času (admin) |
| simulation | PUT | `/sim/devices/{code}` | Vypnúť/zapnúť zariadenie, opraviť degradovaný skener (admin) |
| simulation | PUT | `/sim/seed` | Zmena seedu – aktuálny prevádzkový deň začne znova od 15:00 (admin) |
| system | GET | `/health` | Liveness + db-telemetry ping |
| system | GET | `/hello` | Hello |
