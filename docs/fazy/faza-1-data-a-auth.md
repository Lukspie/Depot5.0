# Fáza 1 – dáta a prihlasovanie

> Pre koho: členovia tímu a príprava na obhajobu. Čo vzniklo, kde to nájdeš a prečo je to tak.

## Čo vzniklo

1. **Schémy oboch databáz.**
   - db-wms má 16 tabuliek: 13 zo zadania plus `alerts`, `customer_notifications` a `seed_meta`.
   - db-telemetry má 7 tabuliek pre zariadenia, skeny, GPS, bránu a senzory.
2. **Migrácie.** Alembic pre db-wms a malý vlastný runner v telematike pre db-telemetry. Obe sa spustia automaticky pri štarte kontajnera.
3. **Seed** (pri prvom štarte):
   - 12 používateľov (admin, dispečer, operátor, ochranka, 8 kuriérov),
   - 16 smerov, 17 brán/plôch, 20 vozidiel,
   - 1 500 balíkov na dnešný deň,
   - 2 vlny, 13 zariadení.
4. **Prihlásenie a odhlásenie so sessions** uloženými na serveri. Session platí 8 hodín, teda jednu smenu.
5. **RBAC:** 5 rolí a kontrola prístupu na každom endpointe.
6. **Frontend:** prihlasovacia stránka, menu podľa roly, stránka „Nemáte oprávnenie“ a **/admin → Používatelia** (pridanie, úprava, zmena roly, deaktivácia, reset hesla).

## Kde to je v kóde

| Čo | Súbor |
| --- | --- |
| Tabuľky db-wms (SQLAlchemy) | [app/src/depotrack/models/](../../app/src/depotrack/models/) |
| Migrácia db-wms | [app/alembic/versions/](../../app/alembic/versions/) |
| Tabuľky db-telemetry | [telematics/sql/001_init.sql](../../telematics/sql/001_init.sql) |
| Zariadenia | [telematics/sql/002_seed_devices.sql](../../telematics/sql/002_seed_devices.sql) |
| Migračný runner telematiky | [telematics/src/db/migrate.ts](../../telematics/src/db/migrate.ts) |
| Seed: referenčné dáta (smery, brány, vozidlá, ľudia) | [app/src/depotrack/seed/reference.py](../../app/src/depotrack/seed/reference.py) |
| Seed: generátor balíkov | [app/src/depotrack/seed/generator.py](../../app/src/depotrack/seed/generator.py) |
| Hashovanie hesiel, tokeny | [app/src/depotrack/core/security.py](../../app/src/depotrack/core/security.py) |
| Sessions | [app/src/depotrack/core/sessions.py](../../app/src/depotrack/core/sessions.py) |
| `require_role(...)` | [app/src/depotrack/core/rbac.py](../../app/src/depotrack/core/rbac.py) |
| Ochrana proti CSRF (Origin) | [app/src/depotrack/core/csrf.py](../../app/src/depotrack/core/csrf.py) |
| Endpointy login/logout/me | [app/src/depotrack/api/auth.py](../../app/src/depotrack/api/auth.py) |
| Správa používateľov | [app/src/depotrack/api/admin_users.py](../../app/src/depotrack/api/admin_users.py) |
| Frontend: login, ochrana ciest, roly | [LoginPage.tsx](../../frontend/src/pages/LoginPage.tsx), [RequireAuth.tsx](../../frontend/src/auth/RequireAuth.tsx), [roles.ts](../../frontend/src/auth/roles.ts) |
| Frontend: admin | [AdminPage.tsx](../../frontend/src/pages/AdminPage.tsx), [admin/](../../frontend/src/components/admin/) |
| Testy | [app/tests/](../../app/tests/), [telematics/tests/migrate.test.ts](../../telematics/tests/migrate.test.ts) |

## Ako funguje prihlásenie (krok za krokom)

```
prehliadač                         app                                db-wms
   │ POST /api/auth/login {meno, heslo}                                 │
   │──────────────────────────────►│ nájdi používateľa                  │
   │                               │ argon2: over heslo                 │
   │                               │ token = 32 náhodných bajtov        │
   │                               │ INSERT sessions(id = SHA-256(token))──►
   │◄── Set-Cookie: depotrack_session=token; HttpOnly; SameSite=Strict; Max-Age=8h
   │
   │ GET /api/admin/users  (cookie ide automaticky)                     │
   │──────────────────────────────►│ SHA-256(cookie) → nájdi session    │
   │                               │ platná? účet aktívny? rola admin?  │
   │◄── 200 / 401 / 403 ───────────│                                    │
   │
   │ POST /api/auth/logout ───────►│ DELETE session ───────────────────►│
```

## Prečo je to tak navrhnuté

- **Prečo sessions v databáze a nie JWT?** Zadanie výslovne chce server-side sessions. Výhoda: odhlásenie, deaktivácia účtu aj zmena roly platia **okamžite**, lebo stačí zmazať riadok. JWT by zostal platný až do expirácie.
- **Prečo je v DB len hash tokenu?** Keby niekto ukradol zálohu databázy, platné cookies z nej nezíska. Overenie je jednoduché: SHA-256 z cookie sa porovná s `sessions.id`.
- **HttpOnly, SameSite=Strict.** JavaScript na stránke cookie neprečíta, takže ho XSS neukradne. Prehliadač cookie nepošle pri požiadavke z cudzej stránky, čo chráni pred CSRF. Ako druhá vrstva `app` odmietne POST/PATCH/DELETE s cudzou hlavičkou `Origin` (ADR-014).
- **argon2.** Moderný algoritmus na heslá. Je zámerne pomalý a náročný na pamäť, takže hádanie hesiel z uniknutých hashov je drahé.
- **Rovnaká odpoveď pre zlé meno aj zlé heslo.** Útočník tak nezistí, ktoré mená existujú. Aj pri neexistujúcom mene sa počíta argon2 hash, aby sa to nedalo poznať ani podľa času odpovede.
- **Rate limit na login** (10 pokusov za minútu na IP). Brzdí skúšanie hesiel hrubou silou.
- **Admin sa nemôže zamknúť.** Vlastný účet nemôže deaktivovať ani mu zobrať rolu admin.
- **Prečo `require_role` ako FastAPI dependency?** Kontrola je deklaratívna priamo pri endpointe, takže sa nedá zabudnúť niekde v tele funkcie. Frontend menu iba skrýva. Rozhoduje backend (ADR-017).
- **Prečo idempotentný seed?** Beží pri každom štarte kontajnera. Každý krok si poznačí, že už prebehol, takže reštart nič nezduplikuje a neprepíše zmeny z adminu (ADR-018).
- **Prečo vlastný migračný runner v telematike?** Init skripty Postgresu sa spustia len raz pri prázdnej DB. Runner aplikuje nové očíslované `.sql` súbory aj neskôr, každý v transakcii (ADR-012).
- **Rajóny KE-01 až KE-08** sú kompasové výseky okolo centra Košíc (sever, severovýchod, …). Je to jednoduché, deterministické a dá sa to otestovať: z polohy vždy vyjde ten istý rajón.

## Prihlasovacie údaje (demo)

Mená sú v [README](../../README.md#prihlasovacie-údaje), heslá v `.env` (premenné `SEED_*_PASSWORD`).

## Ako to overiť

```bash
docker compose down -v && docker compose up --build -d --wait   # čistý štart vrátane seedu
docker compose run --rm app pytest                               # 36 testov (auth, RBAC, seed, migrácie)
cd telematics && npm test                                        # runner migrácií + health
```
V prehliadači:
- http://localhost:8000 presmeruje na prihlásenie.
- Prihlás sa ako `admin` a otvor Administrácia → Používatelia.
- Prihlás sa ako `kurier01` a skús `/admin`: zobrazí sa „Nemáte oprávnenie“.

V DBeaveri: `localhost:5433` (db-wms) a `localhost:5434` (db-telemetry).

## Možné otázky na obhajobe

- *Čo sa stane, keď admin deaktivuje prihláseného používateľa?* Jeho sessions sa zmažú a ďalšia požiadavka dostane 401. Frontend ho presmeruje na prihlásenie.
- *Ako je zabezpečené, že kuriér nezavolá admin API priamo, napr. cez curl?* Backend overuje rolu na každom endpointe a vráti 403. Menu vo frontende je len pohodlie, nie bezpečnosť.
- *Prečo sú dve databázy bez cudzích kľúčov medzi sebou?* Sú to samostatné služby, každá vlastní svoje dáta. Väzby idú cez kódy (`door_code`, ŠPZ) a ich konzistenciu riešia API, nie databáza.
- *Ako by ste schému zmenili neskôr?* db-wms: upraviť model a spustiť `alembic revision --autogenerate`. db-telemetry: pridať súbor `sql/003_*.sql`.
