import { describe, it, expect } from 'vitest';
import { AuthService } from '../demo/hackday-2026/src/auth-service';

describe('AuthService (Hack Day 2026 Target)', () => {
  it('creates and validates a new session', () => {
    const auth = new AuthService();
    const session = auth.createSession('user_123');

    expect(session.userId).toBe('user_123');
    expect(session.token).toMatch(/^sess_user_123_/);
    expect(auth.validateSession(session.token)).toBe(true);
  });

  it('rejects invalid or non-existent tokens', () => {
    const auth = new AuthService();
    expect(auth.validateSession('sess_fake_token')).toBe(false);
  });

  it('correctly revokes active sessions', () => {
    const auth = new AuthService();
    const session = auth.createSession('user_456');

    expect(auth.validateSession(session.token)).toBe(true);
    auth.revokeSession(session.token);
    expect(auth.validateSession(session.token)).toBe(false);
  });
});
