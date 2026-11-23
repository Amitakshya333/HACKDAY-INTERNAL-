import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { resolvePreviewTarget, startPreviewServer, PREVIEW_ERROR_OVERLAY } from '../../src/oasis/preview-server';
import { createSession, saveSession } from '../../src/oasis/session-manager';

describe('MAOS Oasis Preview Server & Resolver (tests/oasis/preview-server.test.ts)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oasis-preview-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. Target Resolution ──────────────────────────────────────────
  describe('resolvePreviewTarget', () => {
    it('returns null entrypoint when workspace has no artifacts', () => {
      const target = resolvePreviewTarget(tmpDir);
      expect(target.entrypoint).toBeNull();
      expect(target.relPath).toBe('');
      expect(target.filesCount).toBe(0);
    });

    it('resolves output/index.html when present', () => {
      const outDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'index.html'), '<html><body>Output App</body></html>', 'utf-8');

      const target = resolvePreviewTarget(tmpDir);
      expect(target.entrypoint).toBe(path.join(outDir, 'index.html'));
      expect(target.relPath).toBe('output/index.html');
    });

    it('resolves dist-preview/index.html when output/ is absent', () => {
      const distDir = path.join(tmpDir, 'dist-preview');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>Dist App</body></html>', 'utf-8');

      const target = resolvePreviewTarget(tmpDir);
      expect(target.entrypoint).toBe(path.join(distDir, 'index.html'));
      expect(target.relPath).toBe('dist-preview/index.html');
    });

    it('resolves active session previewEntry from session manifest', () => {
      const session = createSession(tmpDir, 'Cyberpunk Snake Game');
      const customAppDir = path.join(tmpDir, 'output', 'games', 'snake');
      fs.mkdirSync(customAppDir, { recursive: true });
      const customHtml = path.join(customAppDir, 'index.html');
      fs.writeFileSync(customHtml, '<html><body>Snake 2026</body></html>', 'utf-8');

      session.tasks.push({
        taskId: 'task_001',
        prompt: 'Build snake',
        createdAt: new Date().toISOString(),
        outputDir: 'output/games/snake',
        previewEntry: 'output/games/snake/index.html',
        filesWritten: ['output/games/snake/index.html', 'output/games/snake/game.js'],
        status: 'completed',
      });
      saveSession(tmpDir, session);

      const target = resolvePreviewTarget(tmpDir);
      expect(target.entrypoint).toBe(customHtml);
      expect(target.relPath).toBe('output/games/snake/index.html');
      expect(target.filesCount).toBe(2);
    });
  });

  // ── 2. Local Loopback Server & Error Overlay ───────────────────────
  describe('startPreviewServer', () => {
    it('starts loopback server, injects runtime error overlay, and serves HTML', async () => {
      const outDir = path.join(tmpDir, 'output');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, 'index.html'),
        '<!DOCTYPE html><html><head><title>App</title></head><body><h1>Hello Oasis</h1></body></html>',
        'utf-8',
      );

      const instance = await startPreviewServer(tmpDir, 3080);
      expect(instance.port).toBeGreaterThanOrEqual(3080);
      expect(instance.url).toContain(`http://localhost:${instance.port}/output/index.html`);

      try {
        const resBody = await new Promise<string>((resolve, reject) => {
          http.get(`http://127.0.0.1:${instance.port}/output/index.html`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
            res.on('error', reject);
          });
        });

        expect(resBody).toContain('Hello Oasis');
        expect(resBody).toContain("id='maos-preview-error'");
      } finally {
        await instance.close();
      }
    });

    it('returns 404 for non-existent files', async () => {
      const instance = await startPreviewServer(tmpDir, 3090);

      try {
        const statusCode = await new Promise<number>((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${instance.port}/non-existent.html`, (res) => {
            res.resume();
            resolve(res.statusCode || 0);
          });
          req.on('error', reject);
        });

        expect(statusCode).toBe(404);
      } finally {
        await instance.close();
      }
    });
  });
});
