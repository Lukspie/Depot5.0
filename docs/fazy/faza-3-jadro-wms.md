# Fáza 3 – design systém a jadro WMS

> Pre koho: členovia tímu a príprava na obhajobu. Čo vzniklo, kde to nájdeš a prečo je to tak.

## Čo vzniklo

### 1. Design systém a témy
- Komponenty vo [frontend/src/components/ui](../../frontend/src/components/ui): `Badge`, `StatusDot`, `DataTable`, `Card`, `KpiCard`, `SidePanel` + `KeyValue`, `PageHeader`, `EmptyState`, `Spinner`, `Tabs`, `Progress`, `Button`, `Logo`. Popis a pravidlá sú v [docs/design/komponenty.md](../design/komponenty.md).
- **Dve témy**: **Oranžová** (pred Fázou 5 „SPS“; oranžová, čierna, sivá; predvolená) a **Modrá** podľa referencie. Prepínač je v hornej lište vedľa „Live“ simulovaného času.
- Opravené chyby v `/admin`: zalomený štítok roly, bodka a „Aktívny“ na dvoch riadkoch a zalamujúce sa „(vy)“. Každá obrazovka je skontrolovaná screenshotmi pri 1280, 1440 a 390 px, pričom skript overí aj to, že stránka vodorovne nepreteká.

### 2. Jadro WMS

| Obrazovka | Rola | Čo ukazuje |
| --- | --- | --- |
| `/` **Dispečing** | dispečer, admin | KPI (balíky dňa, naložené, pri bránach, čítanosť, alarmy), jazdy dňa s naplnenosťou a meškaním, balíky podľa smerov, alarmy s potvrdením, vyhľadanie balíka |
| `/loading` **Nakládka** | operátor, admin | výber brány, kamión pri bráne, počítadlá (spočítané / prečítané / neidentifikované / zlý smer), **červený alarm pri zlom smere**, ručný skener, živý feed skenov, chýbajúce balíky |
| `/fleet` **Flotila** | dispečer, admin | mapa Leaflet so živými polohami, po kliknutí panel s nákladom (kg aj kusy voči kapacite), meškanie a zoznam balíkov |
| `/board?key=…` **Tabuľa ETA** | verejná (kľúč v URL) | príchody a odchody, meškania, kaskádové varovania, stav linky; veľké písmo, obnova každých 10 s |
| `/parcels/:id` **Detail balíka** | dispečer, admin | údaje, vodorovná časová os, všetky udalosti so zdrojom (IoT / ručne / systém), skeny pri nakládke |
| `/admin` → **Smery, Zariadenia, Simulácia** | admin | časy odchodov a uzávierok; vypnutie, zapnutie a oprava zariadení; ovládanie hodín (pauza, rýchlosť, skok na 15:30 / 01:00 / 06:00), seed a deň znova |

### 3. Senica
Smer Senica je potvrdený (ADR-008). Jazda trvá ~6 h, preto ho obsluhujú **dva kamióny, ktoré sa striedajú** (ADR-031). Test overuje, že žiadny kamión nemá dve jazdy naraz.

## Ako tečie sken (hlavný príbeh obhajoby)

```
IoT kamera pri bráne LD-02 (telematika)
   │ sken: brána, čas, čiarový kód alebo null (štítok nečitateľný)
   ▼ POST /internal/events/scans  (dávka každú sekundu, najprv stavy jázd, potom skeny)
app: services/loading.py
   ├─ ktorý kamión nakladá pri LD-02?   → najskoršia neodídená jazda s door = LD-02
   ├─ štítok neprečítaný / neznámy kód  → unidentified (položka spočítaná, balík neurčený)
   ├─ balík už v tomto kamióne          → duplicate
   ├─ balík iného smeru                 → wrong_direction + KRITICKÝ ALARM „vyložiť“
   └─ inak                              → ok: balík „loaded“ + udalosť (brána, jazda, zdroj iot)
   ▼ POST /internal/broadcast (telematika) → WebSocket „devices“ a „alerts“
prehliadač /loading: feed, počítadlá a červený banner do ~1 s
```

Ručný skener na obrazovke Nakládka ide **tou istou funkciou** (`process_scan`), len so zdrojom `manual` a menom operátora.

## Kde to je v kóde

| Čo | Súbor |
| --- | --- |
| Kontrola skenu, počítadlá, chýbajúce balíky | [app/.../services/loading.py](../../app/src/depotrack/services/loading.py) |
| Vlny (uzavretie večernej vlny o 22:00) | [services/waves.py](../../app/src/depotrack/services/waves.py) |
| Balíky dňa, nočné balíky | [services/parcels.py](../../app/src/depotrack/services/parcels.py) |
| Plán jázd, striedanie Senice | [services/trip_plan.py](../../app/src/depotrack/services/trip_plan.py) |
| Plán dňa, seed, reset dňa | [services/operating_day.py](../../app/src/depotrack/services/operating_day.py) |
| API: nakládka / dispečing + tabuľa / flotila + balíky / smery | [api/loading.py](../../app/src/depotrack/api/loading.py), [api/dashboard.py](../../app/src/depotrack/api/dashboard.py), [api/fleet.py](../../app/src/depotrack/api/fleet.py), [api/admin_directions.py](../../app/src/depotrack/api/admin_directions.py) |
| Interné API (skeny, reset dňa) | [api/internal.py](../../app/src/depotrack/api/internal.py) |
| Telematika: posielanie skenov, nočné balíky až po príchode kamióna | [telematics/src/simulator/engine.ts](../../telematics/src/simulator/engine.ts), [scanners.ts](../../telematics/src/simulator/scanners.ts) |
| Obrazovky | [frontend/src/pages/](../../frontend/src/pages/) (`DashboardPage`, `LoadingPage`, `FleetPage`, `BoardPage`, `ParcelPage`), [components/admin/SimulationTabs.tsx](../../frontend/src/components/admin/SimulationTabs.tsx) |
| Slovenské popisy stavov, formát času | [frontend/src/domain/labels.ts](../../frontend/src/domain/labels.ts) |

## Prečo je to tak navrhnuté

- **Prečo app, a nie telematika rozhoduje o „zlom smere“?** App je zdroj pravdy pre balíky a jazdy. Telematika vie len to, čo kamera videla (kód alebo nič), a nevie, kam balík patrí. Preto sa dá rovnakou cestou napojiť aj reálny skener z Fázy 6.
- **Prečo „spočítané“ a „prečítané“ zvlášť?** To je jadro problému z praxe: kamera balík vždy spočíta, štítok však neprečíta vždy. Operátor vidí napr. „spočítané 144, prečítané 130, neidentifikované 14“ a v zozname chýbajúcich práve tie balíky, ktoré treba doskenovať ručne.
- **Prečo alarm „zlý smer“ jeden na balík?** Ak ho kamera uvidí opakovane, nevzniká lavína alarmov. Dispečer ho potvrdí v zozname a operátor na bráne klikne na „Vyriešené“.
- **Prečo sa večer regionálne balíky „odstavia“?** Taký je reálny proces. Kamióny do regiónov idú až ráno, takže po večernej vlne balíky čakajú na odstavných plochách. Diaľkové balíky, ktoré nestihli kamión, sú *chýbajúce* a dispečing ich vidí v stĺpci „Chýba“.
- **Prečo nočné balíky „čakajú na svoj kamión“?** Keď nočný kamión z Bratislavy príde o 4 hodiny neskôr (porucha), prídu neskôr aj jeho balíky. Simulátor ich preto nenaskenuje skôr, ako kamión príde. Ranný prechod do Michaloviec naozaj čaká, čo je kaskáda z Fázy 2 v dátach.
- **Prečo je tabuľa bez WebSocketu?** Nemá prihlásenie, takže nemá ticket. Pre obrazovku s obnovou každých 10 s stačí jednoduchý polling.
- **Prečo reset dňa aj v app?** Inak by sa deň po zmene seedu odohral s balíkmi už „naloženými“ z minulého behu (ADR-033).

## Ako to overiť

1. Prihlás sa ako `admin`. V Administrácii → Simulácia nastav ×300.
2. Na **Dispečingu** sledovanie rastúcich počtov „Naložené“ a alarmov.
3. **Nakládka** (napr. ako `operator`): vyber bránu so zelenou bodkou a sleduj feed. Do ručného skenera zadaj kód balíka z iného smeru (nájdeš ho cez hľadanie na Dispečingu) a zobrazí sa červený alarm.
4. **Flotila**: klikni na kamión na ceste a pozri náklad voči kapacite.
5. **Tabuľa**: http://localhost:8000/board?key=tabula-demo-2026 (kľúč `BOARD_KEY` v `.env`). Po 23:47 tam bude kaskádové varovanie.
6. Testy: `docker compose run --rm app pytest` (73) a `cd telematics && npm test` (57).

## Možné otázky na obhajobe

- *Čo keď kamera prečíta kód balíka, ktorý v systéme neexistuje?* Výsledok je `unidentified`. Položka sa započíta, ale nič sa nenaloží a nevznikne ani alarm.
- *Ako zistíte, ktoré balíky chýbajú v kamióne?* Balíky smeru a dňa, ktoré nemajú stav `loaded`. Po odchode kamióna ich dispečing vidí v stĺpci „Chýba“.
- *Ako by ste napojili skutočný ručný skener?* Ručný skener je čítačka čiarových kódov, ktorá sa správa ako klávesnica. Pole na obrazovke Nakládka má fokus, takže sken „napíše“ kód a odošle ho Enterom.
- *Prečo sú dve témy?* Systém je pripravený pre firemné farby prepravcu (téma Oranžová), modrá ukazuje štýl referencie. Vďaka tokenom ide o zmenu niekoľkých premenných, nie o prepisovanie obrazoviek.
