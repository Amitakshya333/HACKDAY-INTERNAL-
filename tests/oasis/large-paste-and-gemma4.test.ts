import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { MaosTui } from '../../src/tui/maos-tui';
import {
  detectLocalModels,
  FALLBACK_MODELS,
  formatHeaderBadge,
  formatModelDisplayName,
} from '../../src/oasis/model-detector';

describe('Large Paste Handling & Gemma 4 E2B Suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maos-paste-gemma4-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // ── 1. Gemma 4 E2B Recognition & Cycling ─────────────────────────────────
  describe('Gemma 4 E2B Model Recognition & Formatting', () => {
    it('has gemma4:e2b in FALLBACK_MODELS with correct family and sizing', () => {
      const gemma4 = FALLBACK_MODELS.find((m) => m.id === 'gemma4:e2b');
      expect(gemma4).toBeDefined();
      expect(gemma4?.family).toBe('gemma4');
      expect(gemma4?.parameterSize).toBe('4.6B');
    });

    it('formats badges and labels cleanly for gemma4:e2b', () => {
      expect(formatHeaderBadge('gemma4:e2b')).toBe('GEMMA 4 E2B · LOCAL');
      expect(formatModelDisplayName('gemma4:e2b')).toContain('Gemma 4');
    });

    it('prioritizes Gemma 4 E2B and Gemma 2 models at top of detected models list', async () => {
      const models = await detectLocalModels();
      expect(models.length).toBeGreaterThanOrEqual(3);

      const topIds = models.slice(0, 3).map((m) => m.id.toLowerCase());
      // Gemma 4 and Gemma 2 models should be prioritized before disk models
      expect(topIds.some((id) => id.includes('gemma4:e2b'))).toBe(true);
      expect(topIds.some((id) => id.includes('gemma2:9b') || id.includes('gemma2:2b'))).toBe(true);
    });

    it('cycles models through gemma4:e2b and generates short badge "Gemma 4 E2B"', () => {
      const tui = new MaosTui(tmpDir);
      expect(tui.getModelBadgeShort('gemma4:e2b')).toBe('Gemma 4 E2B');
      expect(tui.getModelBadgeShort('gemma2:9b')).toBe('Gemma 2 9B');
      expect(tui.getModelBadgeShort('gemma2:2b')).toBe('Gemma 2 2B');

      // Cycle model
      (tui as any).selectedModel = 'gemma2:2b';
      tui.cycleModel();
      const models = (tui as any).detectedModels;
      expect(models.some((m: any) => m.id === 'gemma4:e2b')).toBe(true);
    });

    it('switches to gemma4:e2b via /model 4, /model e2b, and /model gemma4', async () => {
      const tui = new MaosTui(tmpDir);
      await (tui as any).executeCommandLine('/model 4');
      expect((tui as any).selectedModel).toBe('gemma4:e2b');

      await (tui as any).executeCommandLine('/model 9b');
      expect((tui as any).selectedModel).toBe('gemma2:9b');

      await (tui as any).executeCommandLine('/model e2b');
      expect((tui as any).selectedModel).toBe('gemma4:e2b');

      await (tui as any).executeCommandLine('/model 2b');
      expect((tui as any).selectedModel).toBe('gemma2:2b');

      await (tui as any).executeCommandLine('/model gemma4');
      expect((tui as any).selectedModel).toBe('gemma4:e2b');
    });
  });

  // ── 2. Large Text & Bracketed Paste Handling ───────────────────────────────
  describe('Large Text & Multi-Line Paste Handling', () => {
    it('handles bracketed paste (\\x1b[200~ ... \\x1b[201~) atomically without premature submission', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      (tui as any).activeTab = 1;
      (tui as any).modalInputText = '';

      const multilinePrompt = [
        '# TASK: Fix the Moon Jellyfish Simulation & Swarm Board in MAOS Oasis',
        'Please inspect the following files:',
        '- src/tui/maos-tui.ts',
        '- src/oasis/jellyfish-ascii.ts',
        'Ensure 24 FPS timing and zero lag.',
      ].join('\n');

      const bracketedPaste = `\x1b[200~${multilinePrompt}\x1b[201~`;
      process.stdin.emit('data', bracketedPaste);

      // The entire prompt must be present in modalInputText, with newlines normalized to spaces
      const inputVal = (tui as any).modalInputText;
      expect(inputVal).toContain('# TASK: Fix the Moon Jellyfish Simulation & Swarm Board in MAOS Oasis');
      expect(inputVal).toContain('Please inspect the following files:');
      expect(inputVal).toContain('- src/tui/maos-tui.ts');
      expect(inputVal).toContain('Ensure 24 FPS timing and zero lag.');

      // It must NOT have auto-submitted (transcript should not have executed commands)
      expect((tui as any).transcript.length).toBe(0);
      expect((tui as any).statusMessage).toContain('Pasted');

      (tui as any).cleanupKeyboard();
    });

    it('handles split bracketed paste chunks across multiple data packets', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      (tui as any).activeTab = 1;
      (tui as any).modalInputText = '';

      // Chunk 1: Start marker and first line
      process.stdin.emit('data', '\x1b[200~# SYSTEM SPEC: Sovereign local AI runtime\n');
      expect((tui as any).modalInputText).toBe(''); // Still buffering

      // Chunk 2: Middle lines
      process.stdin.emit('data', 'Memory: 8GB unified VRAM\nModel: gemma4:e2b\n');
      expect((tui as any).modalInputText).toBe(''); // Still buffering

      // Chunk 3: End line and closing marker
      process.stdin.emit('data', 'Zero cloud egress required.\x1b[201~');

      // Now paste is complete!
      const inputVal = (tui as any).modalInputText;
      expect(inputVal).toContain('SYSTEM SPEC: Sovereign local AI runtime');
      expect(inputVal).toContain('Memory: 8GB unified VRAM');
      expect(inputVal).toContain('Model: gemma4:e2b');
      expect(inputVal).toContain('Zero cloud egress required.');

      // Not auto-submitted
      expect((tui as any).transcript.length).toBe(0);

      (tui as any).cleanupKeyboard();
    });

    it('handles non-bracketed multi-line paste fallback without breaking into chunks', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      (tui as any).activeTab = 1;
      (tui as any).modalInputText = '';

      const multilineText = 'Line one of prompt\r\nLine two of prompt\r\nLine three of prompt';
      process.stdin.emit('data', multilineText);

      const inputVal = (tui as any).modalInputText;
      expect(inputVal).toBe('Line one of prompt Line two of prompt Line three of prompt');

      // Must not auto-submit
      expect((tui as any).transcript.length).toBe(0);

      (tui as any).cleanupKeyboard();
    });

    it('handles massive single paste (> 3000 characters) instantly without freezing', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      (tui as any).activeTab = 1;
      (tui as any).modalInputText = '';

      // Create a 4,000-character prompt block
      const paragraphs = Array.from(
        { length: 30 },
        (_, i) =>
          `Paragraph ${i + 1}: Detailed instructions for autonomous execution with Gemma local engine on loopback port 11434 with zero egress.`,
      );
      const massivePrompt = paragraphs.join('\n\n');
      expect(massivePrompt.length).toBeGreaterThan(3000);

      const t0 = performance.now();
      process.stdin.emit('data', `\x1b[200~${massivePrompt}\x1b[201~`);
      const elapsed = performance.now() - t0;

      // Processing must take less than 500ms
      expect(elapsed).toBeLessThan(500);

      const inputVal = (tui as any).modalInputText;
      expect(inputVal).toContain('Paragraph 1: Detailed instructions');
      expect(inputVal).toContain('Paragraph 15: Detailed instructions');
      expect((tui as any).statusMessage).toContain('Pasted');

      (tui as any).cleanupKeyboard();
    });

    it('pastes cleanly into chat tab (Tab 2) when activeTab === 2', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      (tui as any).activeTab = 2;
      (tui as any).chatInputText = '';

      const chatPrompt = 'Hello Gemma!\nCan you explain the difference between Gemma 2 and Gemma 4?';
      process.stdin.emit('data', `\x1b[200~${chatPrompt}\x1b[201~`);

      expect((tui as any).chatInputText).toContain('Hello Gemma! Can you explain');
      expect((tui as any).statusMessage).toContain('Pasted');
      expect((tui as any).chatMessages.length).toBe(0); // Not auto-submitted

      (tui as any).cleanupKeyboard();
    });
  });
});
