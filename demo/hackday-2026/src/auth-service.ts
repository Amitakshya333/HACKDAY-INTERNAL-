/**
 * Hack Day 2026 Demo Target: Authentication Service
 * Demonstrates autonomous race condition repair by MAOS-Gemma.
 */

export interface Session {
  userId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
}

export class AuthService {
  private sessions = new Map<string, Session>();
  private sessionTtlMs: number;

  constructor(sessionTtlMs = 3600000) {
    this.sessionTtlMs = sessionTtlMs;
  }

  public createSession(userId: string): Session {
    const token = `sess_${userId}_${Math.random().toString(36).substring(2, 10)}`;
    const now = Date.now();
    const session: Session = {
      userId,
      token,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
    };
    this.sessions.set(token, session);
    return session;
  }

  public validateSession(token: string): boolean {
    const session = this.sessions.get(token);
    if (!session) return false;
    
    // Valid session check
    return Date.now() < session.expiresAt;
  }

  public revokeSession(token: string): boolean {
    return this.sessions.delete(token);
  }

  public getActiveSessionCount(): number {
    return this.sessions.size;
  }
}
