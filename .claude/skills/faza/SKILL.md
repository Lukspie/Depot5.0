---
name: faza
description: Začiatok alebo koniec fázy projektu DepoTrack. Použi, keď používateľ chce začať novú fázu (napr. "/faza 5", "poďme na fázu 6") alebo fázu dokončiť a commitnúť ("/faza 5 koniec").
---

# Fáza projektu DepoTrack

Argumenty: `$ARGUMENTS` (číslo fázy, voliteľne slovo `koniec`).
Ak číslo chýba, zisti ďalšiu nehotovú fázu z `git log --oneline` a `docs/fazy/`.

## A. Začiatok fázy
1. Prečítaj:
   - časť zadania pre túto fázu v `docs/PROMPT.md` (§10 a sekciu, na ktorú odkazuje),
   - zodpovedajúcu časť `docs/plan-doplnky.md`,
   - súvisiace ADR v `docs/decisions.md`,
   - `CLAUDE.md` vrátane Lessons learned.
2. Pozri, čo už existuje (napr. zárodky stránok, endpointy, modely), aby si nestaval nanovo.
3. Navrhni plán:
   - čo vznikne v `app`, `telematics`, `frontend`, `ml`,
   - nové endpointy, tabuľky a migrácie,
   - testy,
   - otvorené otázky s navrhnutým defaultom.
4. **Zastav sa a počkaj na potvrdenie plánu.** Nezačni kódiť bez súhlasu.

## B. Počas práce
- Postupuj po malých krokoch. Hooks lintujú každú úpravu, pred koncom odpovede beží typecheck. Chyby oprav hneď.
- Každé nejasné rozhodnutie zapíš ako ADR (ďalšie voľné číslo, formát ako existujúce).

## C. Koniec fázy (`koniec`)
1. **Kontroly** (všetky musia prejsť):
   - `docker compose run --rm app ruff check src tests`
   - `docker compose run --rm app mypy src`
   - `docker compose run --rm app pytest`
   - `cd telematics && npm run lint && npm run typecheck && npm test`
   - `cd frontend && npm run lint && npm run typecheck`
   - `docker compose up --build -d`, všetky 4 služby `healthy` (`docker compose ps`)
   - Ak Docker nebeží, povedz to používateľovi. Neoznačuj fázu za hotovú.
2. **Screenshoty** hlavných nových obrazoviek (Playwright cez `npx playwright` alebo nástroj prehliadača):
   - šírky 1280, 1440 a 390 px, over, že stránka vodorovne nepreteká,
   - do commitu ulož 3–5 najlepších ako `docs/screenshots/faza-N/<poradie>-<popis>.png`.
3. **Dokumentácia:**
   - `docs/fazy/faza-N-<slug>.md` v štruktúre ako `faza-4-zakaznik-a-kurier.md`: „Pre koho“, Čo vzniklo, Ako to predviesť (2 minúty), Kde to je v kóde, Prečo je to tak navrhnuté, Možné otázky na obhajobe,
   - README (obrazovky, demo),
   - `docs/plan-doplnky.md` (označ *(hotové)*),
   - nové ADR.
4. **Review:** spusti subagenta `reviewer`. Blokujúce nálezy oprav a zopakuj kontroly. Odporúčané oprav, ak sú lacné, inak ich vypíš používateľovi.
5. **Lessons learned:** do `CLAUDE.md` pridaj nové poučenia z tejto fázy (z chýb, opráv používateľa a z návrhov reviewera). Zlúč duplicitné.
6. **Commit** v štýle repozitára:
   ```
   feat: phase N - <čo vzniklo, stručne>

   - app: …
   - telematics: …
   - frontend: …
   - docs: ADR-0xx..0yy, faza-N explainer, screenshots
   ```
   Necommituj `.env` ani `.claude/settings.local.json`.
7. **Zhrnutie pre používateľa:**
   - čo vzniklo,
   - ako to overiť (2–3 kroky),
   - čo reviewer našiel a čo ostalo otvorené.

   Potom sa zastav a počkaj.
