# Demo na obhajobe

> Pre koho: kto bude prezentovať. Scenár krok za krokom (~15 min) so situáciami, ktoré dajú vždy rovnaké čísla. Heslá sú v `.env` (`SEED_*_PASSWORD`), mená používateľov v README.

## Príprava (deň vopred a 10 min pred obhajobou)

1. `docker compose up -d --build`. Na http://localhost:8000/system musia byť obe služby *OK*, databáza telemetrie *Azure Database for PostgreSQL · TLS* a ML modely *načítaný*.
   - Bez internetu: v `.env` daj `COMPOSE_PROFILES=local` a `TELEMETRY_DATABASE_URL=` (prázdne), potom `docker compose up -d`. Mapový podklad potrebuje internet, scéna tieňa nie.
   - Azure server po obhajobe zastav: `az postgres flexible-server stop …` (README, časť Azure).
2. Na notebooku, na ktorom sa prezentuje, over fps tieňa: `/shadow?depot=BUD&fps=stress`, cieľ 60 fps (faza-5).
3. Pre IoT skener: `pip install -r ml/requirements-host.txt`, webkamera, 4–6 krabíc. V `.env` daj `SIM_EXTERNAL_DEVICES=DOCK-SCN-06` a reštartuj telematiku.
4. Štítky: v situácii `morning-departures` spusti `python ml/labels.py --door LD-06 --count 8` a vytlač `labels.pdf`.
5. Otvor si karty v prehliadači (prihlásenie ako admin a v anonymnom okne ďalšie roly).

## Scenár

| # | Čo ukázať | Ako | Na čo upozorniť |
| --- | --- | --- | --- |
| 1 | **Architektúra** | [docs/architektura.md](architektura.md), `/system` | 2 backendy v rôznych jazykoch, db-wms lokálne, **db-telemetry v Azure** (TLS, latencia), frontend servíruje app |
| 2 | **Večerná špička** | admin: http://localhost:8000/?situation=evening-peak (alebo *Administrácia → Simulácia → Situácie*) | Situácia je čistý reset a pretočenie dňa s dátami do 18:30 za ~4 s. Rovnaká situácia dá vždy rovnaké čísla |
| 3 | **Dispečing** | `/` ako dispečer | KPI dňa, jazdy, ETA, alarmy. Počet alarmov je len za aktuálny deň |
| 4 | **Nakládka** | `/loading` ako operátor, brána LD-02 (BA) | sken balíka, zlý smer (veľký červený alarm), čítanosť |
| 5 | **Digitálny tieň** | `/shadow?depot=BUD` ako dispečer | Scéna zrkadlí realitu, piny zariadení, kamióny pri bránach. Klik na kamión: naplnenosť, chýbajúce balíky. Tieň ≠ dvojča (ADR-045) |
| 6 | **Prediktívna údržba (ML)** | v tieni klik na pin **DOCK-SCN-02** | „Riziko poruchy (ML)“ rastie, lebo skener BA sa od 15:30 špiní. Admin: *Simulácia → Skočiť 21:10, Pretočiť s dátami*, potom riziko 100 % a alarm „Skener brány LD-02 – klesajúca čítanosť, skontrolovať optiku“. Akcia „Označiť na údržbu“ |
| 7 | **Scenár „čo ak“** | admin: situácia `calm-night` (23:30), v tieni *Scenár* → Meškanie jazdy → ← Bratislava → 240 min | v pláne 0 kaskád, v scenári vzniknú kaskádové varovania a meškanie prechodov. Živé dáta sa nemenia |
| 8 | **Nočná kaskáda a ML ETA** | situácia `night-cascade` (02:10), dispečing a tabuľa `/board?key=…` | Porucha kamióna BA ohrozí ranné prechody. Pred odjazdom dáva ETA nočných kamiónov model (HistGradientBoosting, MAE 6 min oproti 7 min pri baseline), počas jazdy telematika z polohy |
| 9 | **Kuriér – mobilná appka** | situácia `couriers-morning` (06:55, nakládka od 6:30, dodávky stoja v areáli v tieni aj vo Flotile, odchod ~7:30), `/courier` ako `kurier01` na telefóne (postup nižšie) alebo na PC v ráme telefónu, odkaz zo SMS v *Administrácia → Notifikácie* | Nakládka pri SB-01 (x / 75 v dodávke). *Skener* (spárovaný s KE-301KR): sken naloží balík a zákazník dostane SMS. Po odchode sken balíka vyberie zastávku a ukáže ju na mape. Typ doručenia (osobné s oknom, schránka, box) a „stihneš / nestihneš okno“ (ADR-062). Sledovanie zásielky bez osobných údajov |
| 10 | **Brána (CV)** | `/gate` ako ochranka, nahrať fotku vozidla alebo tabuľky ŠPZ (napr. vytlačenú `KE-102LH`), prípadne `python ml/gate_video.py video.mp4` | Model určí typ a ŠPZ, pravidlá rozhodnú (ADR-061): vozidlo flotily alebo povolená ŠPZ prejde (vytlačená tabuľka bez vozidla nie, čaká na ochranku), kamión s neznámou ŠPZ prejde s príznakom „overiť“, neznáme auto čaká vo fronte „Čaká na ochranku“. Povoliť / zamietnuť s dôvodom, klik na prejazd ukáže audit. Prejazd je aj v dvore tieňa |
| 11 | **IoT skener** | situácia `morning-departures`, `SERVICE_TOKEN=… python ml/dock_scanner.py --device DOCK-SCN-06 --camera 0 --show`, krabice so štítkami cez čiaru | Krabice sa spočítajú a kódy prečítajú. Na `/loading` pri LD-06 ubúda „chýba naložiť“, krabica bez štítku je nečitateľná |
| 12 | **Sklady** | `/fleet` → *Celé Slovensko*, potom *Žilina*. Situácia `couriers-morning`, `/shadow` → rozbaľovací zoznam *Žilina*, *Ivanka pri Dunaji*, *Dunajská Streda* | Layout haly a areálu z OSM (ADR-064). Žilina a Ivanka majú vlastných kuriérov a bránu (`kurierza01`, `kurierba01`, `/gate` s filtrom skladu). Dunajská Streda a Trenčín sú len layout so zaparkovanými dodávkami. Budimír sa nezmenil (golden test) |
| 13 | **Bezpečnosť a roly** | ochranka nevidí Scenár ani akcie. `/admin` len admin. `SIM_CONTROLS_ENABLED=false` | O prístupe rozhoduje backend (403), frontend len skrýva |

## Kuriérska appka na telefóne (rovnaká Wi-Fi)

1. Zisti IP počítača v sieti: `ipconfig` (Windows), riadok *IPv4 Address* Wi-Fi adaptéra, napr. `192.168.1.47`.
2. Port 8000 musí byť dostupný z Wi-Fi. Docker Desktop ho publikuje na všetkých rozhraniach. Ak sa Windows Firewall spýta, povoľ súkromnú sieť, prípadne pridaj pravidlo pre TCP 8000 (len *Private*).
3. Na telefóne otvor `http://192.168.1.47:8000/courier` a prihlás sa ako `kurier01`.
   - **Cookies a CSRF:** app pustí zmenovú požiadavku, keď `Origin` je zo zoznamu `APP_ALLOWED_ORIGINS`, alebo keď sa rovná adrese, z ktorej bola stránka načítaná (scheme + Host). IP telefónu ani PC preto netreba nikam písať. Cudzí web sa za túto adresu vydávať nevie (test `test_same_origin_from_the_lan_is_allowed`).
   - Session cookie je `SameSite=Strict`, bez `Secure` (HTTP v lokálnej sieti), takže funguje aj na IP adrese.
   - Mapa potrebuje internet (dlaždice OpenFreeMap).
   - Po HTTP idú heslo aj cookie v sieti nešifrovane. Je to len na demo v dôveryhodnej sieti, ostrá prevádzka patrí za HTTPS (`SESSION_COOKIE_SECURE=true`).
4. Kuriérska appka volá len app, nie telematiku. Ak chceš z telefónu aj obrazovky so živými dátami z telematiky (dispečing, tieň), v `.env` nastav `TELEMATICS_PUBLIC_URL=http://192.168.1.47:8080` a pridaj `http://192.168.1.47:8000` do `TELEMATICS_ALLOWED_ORIGINS`. Potom `docker compose up -d`.

## Keď niečo nevyjde

- **Divný stav dňa:** *Administrácia → Simulácia → Čistý reset dňa* alebo znova načítať situáciu.
- **Azure nedostupný:** prepnúť na `COMPOSE_PROFILES=local` (README). Situácia pripraví dáta za pár sekúnd.
- **Webkamera nečíta kódy:** priblížiť krabicu (QR aspoň ~80 px) alebo spustiť `dock_scanner.py video.mp4 --dry-run` s pripraveným videom.
- **Model nedostupný** na `/system`: chýba artefakt v `ml/artifacts`, pretrénovať podľa [ml/README.md](../ml/README.md) a `docker compose build app`.
