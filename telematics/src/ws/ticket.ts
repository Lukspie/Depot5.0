/**
 * Verification of tickets issued by the app (POST /api/auth/ws-ticket): JWT HS256 signed with the
 * shared WS_TICKET_SECRET, issuer "depotrack-app", audience "telematics", valid 60 s.
 * For WebSocket connections a ticket is single-use (its jti is remembered until it expires), so
 * a ticket leaked e.g. from a proxy log cannot be replayed.
 */

import { errors, jwtVerify, type JWTPayload } from "jose";

export type Role = "admin" | "dispatcher" | "operator" | "security" | "courier";
const ROLES: readonly string[] = ["admin", "dispatcher", "operator", "security", "courier"];

export interface TicketClaims {
  userId: string;
  name: string;
  role: Role;
}

export class TicketError extends Error {}

export class TicketVerifier {
  private readonly key: Uint8Array;
  private readonly usedJti = new Map<string, number>();

  constructor(
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async verify(token: string, opts: { consume: boolean }): Promise<TicketClaims> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        issuer: "depotrack-app",
        audience: "telematics",
        currentDate: new Date(this.now()),
        clockTolerance: 5,
        requiredClaims: ["exp", "jti", "sub"],
      }));
    } catch (err) {
      const reason = err instanceof errors.JWTExpired ? "ticket expired" : "invalid ticket";
      throw new TicketError(reason);
    }
    const role: unknown = payload.role;
    if (typeof role !== "string" || !ROLES.includes(role)) throw new TicketError("invalid role");
    if (opts.consume) {
      this.forgetExpired();
      const jti = String(payload.jti);
      if (this.usedJti.has(jti)) throw new TicketError("ticket already used");
      this.usedJti.set(jti, (payload.exp ?? 0) * 1000 + 5000);
    }
    const name = typeof payload.name === "string" ? payload.name : "";
    return { userId: String(payload.sub), name, role: role as Role };
  }

  private forgetExpired(): void {
    const now = this.now();
    for (const [jti, until] of this.usedJti) if (until < now) this.usedJti.delete(jti);
  }
}
