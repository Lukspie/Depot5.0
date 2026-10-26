import { useMe } from "../api/auth";
import { isApiError } from "../api/client";

/** Dispatchers (and admin) decide; security only looks (ADR-045, ADR-048). */
export function useCanAct(): boolean {
  const role = useMe().data?.role;
  return role === "dispatcher" || role === "admin";
}

/** API errors are in English (ADR-019): the UI says what happened in Slovak. */
export function actionError(err: unknown): string {
  if (isApiError(err, 409)) return "Brána je v tom čase obsadená inou jazdou, alebo jazda už nakladá či odišla.";
  if (isApiError(err, 422)) return "Toto nie je nakladacia brána tohto depa.";
  if (isApiError(err, 403)) return "Na túto akciu nemáte oprávnenie.";
  if (isApiError(err, 404)) return "Objekt sa nenašiel.";
  if (isApiError(err, 400)) return "Neplatný scenár (neznáma jazda, brána alebo zariadenie).";
  if (isApiError(err, 503)) return "Telematika je práve nedostupná, skúste to o chvíľu.";
  return "Akcia zlyhala.";
}
