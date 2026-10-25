# OSM dáta pre DepoTrack (cestná sieť a adresy)

Jednorazový krok, ktorého výsledky **sú v gite**. Za behu systém nič zo siete nesťahuje (ADR-038):

| Výstup | Použitie |
| --- | --- |
| `telematics/data/roads.json.gz` (~1 MB) | cestný graf pre trasy kamiónov a kuriérov (A* v telematike) |
| `app/src/depotrack/seed/data/addresses.json.gz` (~0,6 MB) | reálne adresné body pre balíky (seed ich vyberá podľa seedu) |

## Ako dáta znova vyrobiť

```bash
# 1) výrez Slovenska z Geofabrik (~350 MB, ukladá sa mimo gitu)
curl -L -o tools/osm/cache/slovakia-latest.osm.pbf https://download.geofabrik.de/europe/slovakia-latest.osm.pbf

# 2) spracovanie v kontajneri (pyosmium), ~3 minúty
docker run --rm -v "$PWD:/repo" -w /repo python:3.12-slim sh -c \
  "apt-get update -qq && apt-get install -y -qq libexpat1 && pip install -q 'osmium>=4' && \
   python tools/osm/build_osm_data.py tools/osm/cache/slovakia-latest.osm.pbf"
```

Skript vypíše aj najväčšie sklady v okolí Budimíra. Podľa nich bola zvolená poloha depa (ADR-039).

## Čo graf obsahuje

- **celé Slovensko:** diaľnice, rýchlostné cesty, cesty I. a II. triedy (+ nájazdy),
- **okolie Košíc a Budimíra** (48,60–48,86 s. š., 21,10–21,42 v. d.): všetky prejazdné ulice vrátane obslužných komunikácií, ktoré potrebujú kuriéri vo Fáze 4,
- jednosmerky, kruhové objazdy a diaľnice ako jednosmerné vetvy,
- cesty sú rozdelené na úseky medzi križovatkami. Geometria úseku je zjednodušená (Douglas–Peucker, 8 m).

Rýchlosti kamióna podľa triedy cesty (km/h): diaľnica 85, rýchlostná 75, I. trieda 65, II. trieda 55, III. trieda 45, ulica 30, obslužná 20.

## Licencia

Dáta © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), licencia **ODbL 1.0**. Odvodené súbory sa šíria pod rovnakou licenciou. Atribúcia je v UI mapy aj v README.
