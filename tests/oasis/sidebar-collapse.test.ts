import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { MaosTui } from '../../src/tui/maos-tui';

describe('Collapsible Sidebar & Refined Aesthetics Suite', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maos-sidebar-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Sidebar State Machine & Width Dimensions', () => {
    it('initializes with sidebar expanded by default (sidebarCollapsed === false)', () => {
      const tui = new MaosTui(tmpDir);
      expect(tui.isSidebarCollapsed()).toBe(false);
    });

    it('toggles sidebar state back and forth cleanly and returns new state', () => {
      const tui = new MaosTui(tmpDir);
      expect(tui.isSidebarCollapsed()).toBe(false);

      const collapsed = tui.toggleSidebar();
      expect(collapsed).toBe(true);
      expect(tui.isSidebarCollapsed()).toBe(true);
      expect((tui as any).statusMessage).toContain('minimized');

      const expanded = tui.toggleSidebar();
      expect(expanded).toBe(false);
      expect(tui.isSidebarCollapsed()).toBe(false);
      expect((tui as any).statusMessage).toContain('expanded');
    });

    it('allows explicitly setting sidebar collapsed state', () => {
      const tui = new MaosTui(tmpDir);
      tui.setSidebarCollapsed(true);
      expect(tui.isSidebarCollapsed()).toBe(true);

      tui.setSidebarCollapsed(true); // idempotency
      expect(tui.isSidebarCollapsed()).toBe(true);

      tui.setSidebarCollapsed(false);
      expect(tui.isSidebarCollapsed()).toBe(false);
    });

    it('calculates rail width dynamically based on expanded vs collapsed state', () => {
      const tui = new MaosTui(tmpDir);

      // On standard width (120 cols):
      // Expanded: 20 cols
      expect(tui.isSidebarCollapsed()).toBe(false);
      expect(tui.getRailWidth(120)).toBe(20);

      // Collapsed: 5 cols (mini-rail)
      tui.toggleSidebar();
      expect(tui.isSidebarCollapsed()).toBe(true);
      expect(tui.getRailWidth(120)).toBe(5);

      // On small terminal (e.g. 50 cols):
      // Collapsed: 5 cols
      expect(tui.getRailWidth(50)).toBe(5);
      // Expanded on small terminal falls back to mini-rail (5 cols) to protect workspace
      tui.toggleSidebar();
      expect(tui.getRailWidth(50)).toBe(5);

      // On ultra-narrow terminal (< 40 cols): rail hides
      expect(tui.getRailWidth(30)).toBe(0);
    });

    it('dynamically expands mainW to reclaim horizontal screen space when collapsed', () => {
      const tui = new MaosTui(tmpDir);
      const W = 118; // standard 120-col terminal minus margins

      // Expanded
      const expandedRailW = tui.getRailWidth(W);
      expect(expandedRailW).toBe(20);
      const expandedMainW = W - expandedRailW - (expandedRailW ? 3 : 0);
      expect(expandedMainW).toBe(95);

      // Collapsed
      tui.setSidebarCollapsed(true);
      const collapsedRailW = tui.getRailWidth(W);
      expect(collapsedRailW).toBe(5);
      const collapsedMainW = W - collapsedRailW - (collapsedRailW ? 3 : 0);
      expect(collapsedMainW).toBe(110);

      // Reclaims 15 columns for main content!
      expect(collapsedMainW - expandedMainW).toBe(15);
    });
  });

  describe('Visual Aesthetics & Icon Glyphs', () => {
    it('renders expanded sidebar with » minimize chevron, refined icons, full titles and badges', () => {
      const tui = new MaosTui(tmpDir);
      tui.setSidebarCollapsed(false);

      (tui as any).lastRenderedFrame = [];
      (tui as any).renderInternal();

      const frame = ((tui as any).lastRenderedFrame as string[]).join('\n');
      const plain = frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');

      // Rail is on the right edge: collapsing pushes it right, so the chevron points right
      expect(plain).toContain('» Collapse (F2)');
      expect(plain).not.toContain('« Collapse');

      // Refined icons and titles
      expect(frame).toContain('⌂');
      expect(frame).toContain('Dashboard');
      expect(frame).toContain('◈');
      expect(frame).not.toContain('💬');
      expect(frame).not.toContain('✉');
      expect(frame).toContain('Chat');
      expect(frame).toContain('❖');
      expect(frame).toContain('Swarm');
      expect(frame).toContain('▥');
      expect(frame).toContain('Telemetry');
      expect(frame).toContain('☰');
      expect(frame).toContain('Event Log');
      expect(frame).toContain('⚙');
      expect(frame).toContain('Settings');
    });

    it('renders collapsed sidebar with » expand button and only crisp icons in mini-rail', () => {
      const tui = new MaosTui(tmpDir);
      tui.setSidebarCollapsed(true);

      (tui as any).lastRenderedFrame = [];
      (tui as any).renderInternal();

      const frame = ((tui as any).lastRenderedFrame as string[]).join('\n');

      // Top expand indicator « (expanding pulls the right-edge rail leftward)
      const plain = frame.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
      expect(plain).toMatch(/│\s*«\s*$/m);

      // Mini-rail icons must be present
      expect(frame).toContain('⌂');
      expect(frame).toContain('◈');
      expect(frame).toContain('❖');
      expect(frame).toContain('▥');
      expect(frame).toContain('☰');
      expect(frame).toContain('⚙');

      // Mini-rail rows should display the icons cleanly
      const rows = (tui as any).lastRenderedFrame as string[];
      expect(rows.length).toBeGreaterThan(0);

      // Verify at least one row contains the rail separator with only the mini icon
      const hasMiniIcon = rows.some((row) => /│\s*⌂\s*$/.test(row.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')));
      expect(hasMiniIcon).toBe(true);
    });

    it('highlights the active tab with selection styling in both modes', () => {
      const tui = new MaosTui(tmpDir);

      // Test activeTab 1 (Dashboard)
      tui.setActiveTab(1);
      tui.setSidebarCollapsed(true);
      (tui as any).lastRenderedFrame = [];
      (tui as any).renderInternal();
      expect(tui.getActiveTab()).toBe(1);

      // Switch to activeTab 2 (Chat)
      tui.setActiveTab(2);
      (tui as any).lastRenderedFrame = [];
      (tui as any).renderInternal();
      expect(tui.getActiveTab()).toBe(2);

      // Switch to activeTab 3 (Swarm)
      tui.setActiveTab(3);
      (tui as any).lastRenderedFrame = [];
      (tui as any).renderInternal();
      expect(tui.getActiveTab()).toBe(3);

      // Switch to activeTab 0 (Settings)
      tui.setActiveTab(0);
      (tui as any).lastRenderedFrame = [];
      (tui as any).renderInternal();
      expect(tui.getActiveTab()).toBe(0);
    });

    it('renders mini-rail without truncated text on narrow terminals (< 80 cols) even when expanded', () => {
      const tui = new MaosTui(tmpDir);
      tui.setSidebarCollapsed(false);

      const origColumns = process.stdout.columns;
      try {
        Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true });
        (tui as any).lastRenderedFrame = [];
        (tui as any).renderInternal();

        const frame = ((tui as any).lastRenderedFrame as string[]).join('\n');
        // Must NOT contain truncated "« Co…" or "  ⌂…"
        expect(frame).not.toContain('« Co…');
        expect(frame).not.toContain('» Co…');
        expect(frame).not.toContain('⌂…');
        // Must contain crisp icons
        expect(frame).toContain('⌂');
      } finally {
        Object.defineProperty(process.stdout, 'columns', { value: origColumns, configurable: true });
      }
    });
  });

  describe('Hotkeys, Prefix Mode & Slash Commands', () => {
    it('toggles sidebar with Ctrl+\\ (str === "\\x1c")', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      try {
        expect(tui.isSidebarCollapsed()).toBe(false);

        // Simulate Ctrl+\ keypress event
        const keyHandler = (tui as any).keypressHandler;
        expect(keyHandler).toBeDefined();

        keyHandler('\x1c', { name: '\\', ctrl: true, meta: false, shift: false });
        expect(tui.isSidebarCollapsed()).toBe(true);

        keyHandler('\x1c', { name: '\\', ctrl: true, meta: false, shift: false });
        expect(tui.isSidebarCollapsed()).toBe(false);
      } finally {
        (tui as any).cleanupKeyboard();
      }
    });

    it('toggles sidebar with Ctrl+\\ with backslash key name', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      try {
        expect(tui.isSidebarCollapsed()).toBe(false);

        const keyHandler = (tui as any).keypressHandler;
        keyHandler(undefined, { name: 'backslash', ctrl: true, meta: false, shift: false });
        expect(tui.isSidebarCollapsed()).toBe(true);

        keyHandler(undefined, { name: 'backslash', ctrl: true, meta: false, shift: false });
        expect(tui.isSidebarCollapsed()).toBe(false);
      } finally {
        (tui as any).cleanupKeyboard();
      }
    });

    it('toggles sidebar in Prefix mode with Ctrl+B then s', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      try {
        expect(tui.isSidebarCollapsed()).toBe(false);
        const keyHandler = (tui as any).keypressHandler;

        // Press Ctrl+B to activate prefix mode
        keyHandler('\x02', { name: 'b', ctrl: true, meta: false, shift: false });
        expect((tui as any).prefixActive).toBe(true);

        // Press 's' to toggle sidebar
        keyHandler('s', { name: 's', ctrl: false, meta: false, shift: false });
        expect(tui.isSidebarCollapsed()).toBe(true);
        expect((tui as any).prefixActive).toBe(false);

        // Press Ctrl+B then 's' again to expand
        keyHandler('\x02', { name: 'b', ctrl: true, meta: false, shift: false });
        keyHandler('s', { name: 's', ctrl: false, meta: false, shift: false });
        expect(tui.isSidebarCollapsed()).toBe(false);
      } finally {
        (tui as any).cleanupKeyboard();
      }
    });

    it('supports /sidebar, /collapse, /minimize, and /maximize slash commands', async () => {
      const tui = new MaosTui(tmpDir);
      expect(tui.isSidebarCollapsed()).toBe(false);

      await (tui as any).executeCommandLine('/sidebar');
      expect(tui.isSidebarCollapsed()).toBe(true);

      await (tui as any).executeCommandLine('/collapse');
      expect(tui.isSidebarCollapsed()).toBe(false);

      await (tui as any).executeCommandLine('/minimize');
      expect(tui.isSidebarCollapsed()).toBe(true);

      await (tui as any).executeCommandLine('/maximize');
      expect(tui.isSidebarCollapsed()).toBe(false);

      await (tui as any).executeCommandLine('/expand');
      expect(tui.isSidebarCollapsed()).toBe(true);
    });

    it('toggles sidebar and switches tabs via handleMouseClick', () => {
      const tui = new MaosTui(tmpDir);
      expect(tui.isSidebarCollapsed()).toBe(false);

      // Click on chevron (row 3, col 110 on 120-col terminal)
      const handled = tui.handleMouseClick(110, 3);
      expect(handled).toBe(true);
      expect(tui.isSidebarCollapsed()).toBe(true);

      // Click chevron again to expand
      tui.handleMouseClick(110, 3);
      expect(tui.isSidebarCollapsed()).toBe(false);

      // Click on Chat tab (row 8)
      tui.handleMouseClick(110, 8);
      expect(tui.getActiveTab()).toBe(2);

      // Click on Swarm tab (row 10)
      tui.handleMouseClick(110, 10);
      expect(tui.getActiveTab()).toBe(3);

      // Click on Telemetry tab (row 12)
      tui.handleMouseClick(110, 12);
      expect(tui.getActiveTab()).toBe(4);

      // Click on Event Log tab (row 14)
      tui.handleMouseClick(110, 14);
      expect(tui.getActiveTab()).toBe(5);

      // Click on Settings tab (row 34)
      tui.handleMouseClick(110, 34);
      expect(tui.getActiveTab()).toBe(0);

      // Click back on Dashboard tab (row 6)
      tui.handleMouseClick(110, 6);
      expect(tui.getActiveTab()).toBe(1);

      // Click outside the rail (col 10)
      const outsideHandled = tui.handleMouseClick(10, 3);
      expect(outsideHandled).toBe(false);
    });

    it('handles raw SGR mouse click sequence via stdin stream buffering', () => {
      const tui = new MaosTui(tmpDir);
      (tui as any).setupKeyboard();
      try {
        expect(tui.isSidebarCollapsed()).toBe(false);

        // Inject raw SGR left click on row 3 (chevron)
        process.stdin.emit('data', '\x1b[<0;110;3M');
        expect(tui.isSidebarCollapsed()).toBe(true);

        // Inject raw SGR left click on row 3 again to expand
        process.stdin.emit('data', '\x1b[<0;110;3M');
        expect(tui.isSidebarCollapsed()).toBe(false);
      } finally {
        (tui as any).cleanupKeyboard();
      }
    });

    it('advertises Ctrl+\\ in footer hotkey hints and S in prefix banner', () => {
      const tui = new MaosTui(tmpDir);

      (tui as any).lastRenderedFrame = [];
      (tui as any).renderInternal();

      const frame = ((tui as any).lastRenderedFrame as string[]).join('\n');
      // Footer contains Ctrl+\
      expect(frame).toContain('Ctrl+\\');
      expect(frame).toMatch(/Sidebar|Toggle Sidebar/);

      // Activate prefix mode and verify banner includes S Sidebar
      (tui as any).prefixActive = true;
      (tui as any).lastRenderedFrame = [];
      (tui as any).renderInternal();

      const prefixFrame = ((tui as any).lastRenderedFrame as string[]).join('\n');
      expect(prefixFrame).toContain('Sidebar');
    });
  });
});
