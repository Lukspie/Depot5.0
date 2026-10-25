# Fáza 0 – kostra projektu

> Pre koho: členovia tímu a príprava na obhajobu. Čo vzniklo, kde to nájdeš a prečo je to tak.

## Čo vzniklo

Zatiaľ len „potrubie“ bez obchodnej logiky: štyri kontajnery, ktoré sa spustia, navzájom sa nájdu a hlásia, že sú zdravé. Frontend ukazuje stránku **Stav systému** a údaje na nej berie **z oboch backendov naraz**.

```
prehliadač ── http://localhost:8000 ──► app (Python FastAPI) ──► db-wms (PostgreSQL)
          └── http://localhost:8080 ──► telematics (Node.js TS) ──► db-telemetry (PostgreSQL)
```

| Kontajner | Čo robí teraz | Port |
| --- | --- | --- |
| `db-wms` | prázdna PostgreSQL 16 pre obchodné dáta | 127.0.0.1:5433 |
| `db-telemetry` | prázdna PostgreSQL 16 pre telemetriu | 127.0.0.1:5434 |
| `app` | `/api/health`, `/api/hello`, `/api/config` a servírovanie frontendu | 8000 |
| `telematics` | `/health`, `/hello`, Swagger na `/docs` | 8080 |

## Kde to je v kóde

| Čo | Súbor |
| --- | --- |
| Definícia 4 kontajnerov, healthchecky, poradie štartu | [docker-compose.yml](../../docker-compose.yml) |
| Premenné prostredia (vzor) | [.env.example](../../.env.example) |
| Build frontendu + Python runtime v jednom image | [app/Dockerfile](../../app/Dockerfile) |
| Nastavenia `app` z env | [app/src/depotrack/core/config.py](../../app/src/depotrack/core/config.py) |
| Pripojenie na db-wms | [app/src/depotrack/core/db.py](../../app/src/depotrack/core/db.py) |
| Servírovanie React aplikácie z FastAPI | [app/src/depotrack/core/spa.py](../../app/src/depotrack/core/spa.py) |
| Endpointy health/hello/config | [app/src/depotrack/api/system.py](../../app/src/depotrack/api/system.py) |
| Fastify aplikácia telematiky | [telematics/src/app.ts](../../telematics/src/app.ts), [telematics/src/api/health.ts](../../telematics/src/api/health.ts) |
| Stránka, ktorá volá oba backendy | [frontend/src/pages/StatusPage.tsx](../../frontend/src/pages/StatusPage.tsx), [frontend/src/api/system.ts](../../frontend/src/api/system.ts) |
| Farby a téma | [frontend/src/index.css](../../frontend/src/index.css) |

## Prečo je to tak navrhnuté

- **Prečo práve 4 kontajnery a kde je frontend?** Zadanie povoľuje presne štyri. Frontend preto nemá vlastný kontajner (napr. Nginx). V `app/Dockerfile` je **multi-stage build**: prvá fáza v Node zostaví React do statických súborov a druhá fáza ich skopíruje do Python image. FastAPI ich potom servíruje na rovnakej adrese ako API.
- **Ako frontend „spája oba backendy“?** Prehliadač sa najprv opýta `app` na `/api/config`, kde sa dozvie adresu telematiky. Potom volá **priamo** `telematics` na porte 8080, bez prechodu cez `app`. Adresa nie je zapečená v builde, takže ten istý build funguje lokálne aj na inom serveri (ADR-004).
- **Prečo CORS?** Telematika beží na inom origine (iný port). Prehliadač by jej odpovede bez povolenia zahodil. Telematika preto povoľuje len originy z `.env`. Pre WebSocket (Fáza 2) pribudne kontrola hlavičky `Origin` a ticketu.
- **Healthchecky a poradie štartu.** Databázy sa kontrolujú cez `pg_isready`. Backendy majú vlastný `/health`, ktorý reálne skúsi `SELECT 1` na svoju DB a pri chybe vráti 503. Compose spustí backend až keď je jeho DB `healthy`. `app` čaká aj na telematiku, lebo od nej neskôr berie simulovaný čas.
- **SPA fallback.** React Router rieši cesty ako `/fleet` v prehliadači. Server preto na každú neznámu cestu mimo `/api` vráti `index.html`. Neznáme `/api/...` cesty naopak vrátia 404, aby sa chyby v API neskryli. Fallback je chránený proti path traversal (`../`).
- **Tajomstvá.** V repozitári je len `.env.example`. Compose odmietne štart, ak chýba heslo k DB (ADR-002).
- **Typy a lint.** Python: mypy v strict režime a ruff. TypeScript: `strict` vrátane `noUncheckedIndexedAccess` a typovo informovaný ESLint. Chyby sa tak ukážu už pri builde, nie až za behu.

## Ako to overiť

```bash
cp .env.example .env
docker compose up --build -d --wait
docker compose ps                       # 4× healthy
```
- http://localhost:8000: stránka Stav systému, obe karty zelené
- http://localhost:8000/api/docs: OpenAPI hlavného backendu
- http://localhost:8080/docs: Swagger telematiky
- `docker compose stop telematics`: pravá karta do 10 s zčervenie, ľavá zostane zelená

Testy:
```bash
docker compose run --rm app pytest                 # Python (potrebuje db-wms)
cd telematics && npm ci && npm test                # Node
cd frontend && npm ci && npm run lint && npm run build
```

## Možné otázky na obhajobe

- *Prečo FastAPI?* Automatické OpenAPI, typy cez Pydantic a dobrá podpora ML knižníc v Pythone.
- *Prečo druhý backend v Node.js?* Simulátor posiela veľa malých udalostí cez WebSocket. Event loop v Node je na takú I/O prácu vhodný a zároveň tak spĺňame podmienku „iný jazyk“.
- *Prečo dve databázy?* Obchodné dáta (balíky, jazdy) a telemetria (GPS, skeny zariadení) majú iný charakter. Telemetrie je veľa, pribúda neustále a maže sa podľa GDPR. Oddelenie je aj podmienka zadania.
