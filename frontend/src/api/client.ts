/** Small fetch wrapper shared by all API calls. */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Služba je nedostupná");
  }
  if (!res.ok) {
    throw new ApiError(res.status, `Chyba ${res.status}`);
  }
  return (await res.json()) as T;
}
