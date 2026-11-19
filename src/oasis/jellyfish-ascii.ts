/**
 * Jellyfish ASCII Art & Mascot Generator for MAOS Oasis Swarm Board.
 *
 * Implements the mathematical moon jelly simulation:
 * - Graceful translucent bell umbrella dome with curved crown
 * - Four signature glowing horseshoe gonads (Aurelia aurita cloverleaf luminescence)
 * - Pulsing bell squeezing and relaxing (P = 2.2s stroke) with hydrodynamic lift
 * - Wavy scalloped rim margin with dynamic undulation
 * - Ribbon-like oral mouth arms frilled with ';'
 * - Staggered phase-lagged trailing marginal tentacles
 * - Ambient drifting ocean plankton specks ('·' and '.')
 * - Styled with MAOS Oasis cyberpunk palette:
 *   violet (#8B5CF6), cyan (#06B6D4), cyanBright (#38BDF8), emerald (#10B981), slate (#64748B)
 */

import chalk from 'chalk';

export interface JellyfishMeta {
  name: string;
  category: string;
  note: string;
  cols: number;
  rows: number;
  fps: number;
}

export const meta: JellyfishMeta = {
  name: 'jellyfish',
  category: 'creatures',
  note: 'a jellyfish pulsing upward, its tentacles trailing late',
  cols: 44,
  rows: 26,
  fps: 24,
};

const P = 2.2;
const SQ = 0.28;

const ease = (x: number): number => x * x * (3 - 2 * x);
const phase = (t: number): number => (((t % P) + P) % P) / P;

export const squeeze = (t: number): number => {
  const p = phase(t);
  return p < SQ ? ease(p / SQ) : 1 - ease((p - SQ) / (1 - SQ));
};

export const lift = (t: number): number => {
  const p = phase(t);
  return p < 0.4 ? ease(p / 0.4) : 1 - ease((p - 0.4) / 0.6);
};

export const rimAt = (
  t: number,
  totalCols: number = meta.cols,
  totalRows: number = meta.rows,
): { c: number; x: number; y: number; half: number } => {
  const c = squeeze(t);
  const scaleX = totalCols / meta.cols;
  const scaleY = totalRows / meta.rows;
  const x = totalCols / 2 + 1.2 * scaleX * Math.sin((2 * Math.PI * t) / (5 * P));
  const y = (11 - 1.0 * lift(t) - 0.7 * c) * scaleY;
  const half = (13.5 - 2.8 * c) * scaleX;
  return { c, x, y, half };
};

/**
 * Cyberpunk Palette
 */
const colorInstance = new chalk.Instance({ level: 3 });

export const palette = {
  violet: colorInstance.hex('#8B5CF6'),
  violetBright: colorInstance.hex('#A78BFA'),
  cyan: colorInstance.hex('#06B6D4'),
  cyanBright: colorInstance.hex('#38BDF8'),
  emerald: colorInstance.hex('#10B981'),
  amber: colorInstance.hex('#F59E0B'),
  slateMuted: colorInstance.hex('#64748B'),
  slateBorder: colorInstance.hex('#334155'),
  white: colorInstance.hex('#F8FAFC'),
  boldWhite: colorInstance.bold.hex('#FFFFFF'),
};

/**
 * Generates an uncolored raw compact moon jelly ASCII frame (e.g. 20x8)
 * maintaining authentic mathematical moon jelly geometry:
 * - Smooth arched crown apex
 * - Translucent umbrella dome with glowing horseshoe gonads (* / +)
 * - Signature wavy scalloped rim margin ('~' and "'")
 * - 4 spaced fluidly trailing marginal tentacles undulating with wave lag
 * - 2 central frilled oral mouth arms with ';'
 * - Fading tips with ':'
 */
export function generateCompactJellyfishRawFrame(t: number = 0, cols: number = 20, rows: number = 8): string {
  const c = squeeze(t);
  const drift = 0.4 * Math.sin((2 * Math.PI * t) / (5 * P));
  const cx = cols / 2 + drift;
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));

  const half = cols * 0.38 - 1.4 * c;
  const rimRow = Math.max(2, Math.min(rows - 3, 3));

  // Row 0: Smooth arched crown apex
  const w0 = Math.max(2, Math.round(half * 0.45));
  const cL = Math.round(cx - w0);
  const cR = Math.round(cx + w0);
  for (let x = cL; x <= cR; x++) {
    if (x >= 0 && x < cols) grid[0][x] = x === cL || x === cR ? '.' : '-';
  }

  // Row 1: Upper bell curve
  const w1 = Math.max(3, Math.round(half * 0.78));
  const uL = Math.round(cx - w1);
  const uR = Math.round(cx + w1);
  if (uL >= 0 && uL < cols) grid[1][uL] = '.';
  if (uL + 1 < cols) grid[1][uL + 1] = '-';
  if (uL + 2 < cols) grid[1][uL + 2] = "'";
  if (uR >= 0 && uR < cols) grid[1][uR] = '.';
  if (uR - 1 >= 0) grid[1][uR - 1] = '-';
  if (uR - 2 >= 0) grid[1][uR - 2] = "'";

  // Row 2: Mid bell with 4 cloverleaf horseshoe gonads
  const w2 = Math.max(4, Math.round(half * 0.95));
  const mL = Math.round(cx - w2);
  const mR = Math.round(cx + w2);
  if (mL >= 0 && mL < cols) grid[2][mL] = '(';
  if (mR >= 0 && mR < cols) grid[2][mR] = ')';

  // Horseshoe gonads: ( )  ( )
  const gOffset = Math.max(2, Math.round(w2 * 0.42));
  const gL = Math.round(cx - gOffset);
  const gR = Math.round(cx + gOffset);
  const glow = c > 0.6 ? '*' : '.';
  if (gL - 1 > mL) grid[2][gL - 1] = '(';
  if (gL > mL && gL < mR) grid[2][gL] = glow;
  if (gL + 1 < gR - 1) grid[2][gL + 1] = ')';

  if (gR - 1 > gL + 1) grid[2][gR - 1] = '(';
  if (gR > mL && gR < mR) grid[2][gR] = glow;
  if (gR + 1 < mR) grid[2][gR + 1] = ')';

  // Row 3: Scalloped wavy rim margin
  const rL = Math.round(cx - half);
  const rR = Math.round(cx + half);
  if (rL >= 0 && rL < cols) grid[rimRow][rL] = "'";
  if (rR >= 0 && rR < cols) grid[rimRow][rR] = "'";
  for (let x = rL + 1; x < rR; x++) {
    if (x >= 0 && x < cols) {
      grid[rimRow][x] = (x - rL) % 2 === 1 ? '~' : '-';
    }
  }

  // Row 4 to rows - 1: Trailing tentacles
  const tentU = [-0.85, -0.42, 0.42, 0.85];
  for (let i = 0; i < tentU.length; i++) {
    const u = tentU[i];
    let prevX = cx + u * half;
    for (let y = rimRow + 1; y < rows; y++) {
      const d = y - rimRow;
      const lagT = t - d * 0.12;
      const lagC = squeeze(lagT);
      const lagHalf = cols * 0.38 - 1.4 * lagC;
      const lagCx = cols / 2 + 0.4 * Math.sin((2 * Math.PI * lagT) / (5 * P));
      const wob = Math.sin(d * 0.8 - t * 3.0 + i * 1.5);
      const curX = Math.round(lagCx + u * lagHalf * (1 - d * 0.07) + (0.3 + d * 0.1) * wob);
      if (curX >= 0 && curX < cols) {
        let ch = '|';
        const dx = curX - prevX;
        if (d === rows - rimRow - 1) ch = ':';
        else if (dx > 0.4) ch = '\\';
        else if (dx < -0.4) ch = '/';
        else if (Math.abs(wob) > 0.65) ch = '~';
        grid[y][curX] = ch;
      }
      prevX = curX;
    }
  }

  // Central oral arms frilled with ';'
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    for (let y = rimRow + 1; y < rows; y++) {
      const d = y - rimRow;
      const lagT = t - d * 0.14;
      const lagCx = cols / 2 + 0.4 * Math.sin((2 * Math.PI * lagT) / (5 * P));
      const tw = Math.sin(d * 1.0 - t * 2.8 + i * 2.0);
      const curX = Math.round(lagCx + s * 1.0 + 0.4 * tw);
      if (curX >= 0 && curX < cols && grid[y][curX] === ' ') {
        grid[y][curX] = d === rows - rimRow - 1 ? ':' : ';';
      }
    }
  }

  return grid.map((r) => r.join('')).join('\n');
}

/**
 * Generates an uncolored raw mathematical ASCII frame (cols x rows) at time t.
 * Implements a crisp, unmistakable moon jellyfish with:
 * - Arched crown apex and smooth elliptical dome silhouette
 * - Translucent umbrella body with signature Aurelia aurita glowing horseshoe gonads
 * - Dynamic undulating scalloped rim margin
 * - Central cascading frilled oral arms
 * - Flowing trailing marginal tentacles with wave lag
 * - Ambient drifting water plankton specks
 */
export function generateJellyfishRawFrame(t: number = 0, cols: number = meta.cols, rows: number = meta.rows): string {
  if (cols < 36 || rows < 20) {
    return generateCompactJellyfishRawFrame(t, cols, rows);
  }

  const c = squeeze(t);
  const l = lift(t);
  const scaleX = cols / meta.cols;
  const scaleY = rows / meta.rows;

  const cx = cols / 2 + 1.0 * scaleX * Math.sin((2 * Math.PI * t) / (5 * P));
  const crownY = Math.max(2, Math.round((4 - 1.2 * l) * scaleY));
  const rimY = Math.max(crownY + 6, Math.round((11 - 1.0 * l - 0.7 * c) * scaleY));
  const domeHeight = rimY - crownY;
  const halfW = (14.5 - 2.8 * c) * scaleX;

  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));

  // Ambient plankton in open water (placed cleanly away from the jelly silhouette)
  let seed = 77;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const speckCount = Math.max(6, Math.round((18 * (cols * rows)) / (meta.cols * meta.rows)));
  for (let i = 0; i < speckCount; i++) {
    const sx = Math.floor(rnd() * cols);
    const sy = Math.floor((rnd() * rows + t * 0.6) % rows);
    if (Math.abs(sx - cx) > halfW + 3 || sy < crownY - 1) {
      if (grid[sy][sx] === ' ') grid[sy][sx] = i % 3 === 0 ? '·' : '.';
    }
  }

  // Bell Dome
  for (let y = crownY; y <= rimY; y++) {
    const prog = (y - crownY) / Math.max(1, domeHeight);
    const w = halfW * Math.sin((prog * Math.PI) / 2);
    const leftX = Math.round(cx - w);
    const rightX = Math.round(cx + w);

    if (y === crownY) {
      const topW = Math.max(2, Math.round(halfW * 0.38));
      const tL = Math.round(cx - topW);
      const tR = Math.round(cx + topW);
      for (let x = tL; x <= tR; x++) {
        if (x >= 0 && x < cols) grid[y][x] = x === tL || x === tR ? '.' : '-';
      }
    } else if (y === rimY) {
      const rL = Math.round(cx - halfW);
      const rR = Math.round(cx + halfW);
      for (let x = rL; x <= rR; x++) {
        if (x >= 0 && x < cols) {
          if (x === rL || x === rR) grid[y][x] = "'";
          else grid[y][x] = (x - rL) % 2 === 1 ? '~' : '-';
        }
      }
    } else {
      if (leftX >= 0 && leftX < cols) {
        grid[y][leftX] = prog < 0.25 ? '.' : prog < 0.6 ? '/' : '(';
      }
      if (rightX >= 0 && rightX < cols) {
        grid[y][rightX] = prog < 0.25 ? '.' : prog < 0.6 ? '\\' : ')';
      }

      for (let x = leftX + 1; x < rightX; x++) {
        const u = (x - cx) / Math.max(1, w);
        const absU = Math.abs(u);

        // Radial canals
        if (prog > 0.25 && prog < 0.85) {
          if (Math.abs(absU - 0.72) < 0.03 || Math.abs(absU - 0.2) < 0.03) {
            grid[y][x] = ':';
          }
        }

        // 4 Horseshoe Cloverleaf Gonads
        const inGonadRow = prog >= 0.38 && prog <= 0.75;
        if (inGonadRow) {
          const gCenterU = 0.44;
          const distToGonad = Math.abs(absU - gCenterU);
          if (distToGonad < 0.06) {
            grid[y][x] = c > 0.6 ? '*' : '+';
          } else if (distToGonad < 0.16) {
            const isLeftOfGonad = u < 0 ? absU > gCenterU : absU < gCenterU;
            grid[y][x] = isLeftOfGonad ? '(' : ')';
          }
        }
      }
    }
  }

  // Central cascading frilled oral arms
  for (let arm = 0; arm < 2; arm++) {
    const s = arm === 0 ? -1 : 1;
    for (let y = rimY + 1; y < Math.min(rows, rimY + 13); y++) {
      const d = y - rimY;
      const lagT = t - d * 0.12;
      const tw = Math.sin(d * 0.85 - lagT * 2.6 + arm * 1.8);
      const armX = Math.round(cx + s * (2.2 - d * 0.06) + 1.2 * tw);
      if (armX >= 0 && armX < cols) {
        grid[y][armX] = d > 10 ? ':' : ';';
        const frillX = armX + (tw > 0 ? 1 : -1);
        if (frillX >= 0 && frillX < cols && grid[y][frillX] === ' ') {
          grid[y][frillX] = '~';
        }
      }
    }
  }

  // Marginal tentacles (6 flowing outer tentacles)
  const tentU = [-0.92, -0.62, -0.32, 0.32, 0.62, 0.92];
  for (let i = 0; i < tentU.length; i++) {
    const u = tentU[i];
    let prevX = cx + u * halfW;
    const len = 13 + ((i * 3) % 4);
    for (let y = rimY + 1; y < Math.min(rows, rimY + len); y++) {
      const d = y - rimY;
      const lagT = t - d * 0.08;
      const lagC = squeeze(lagT);
      const lagW = (14.5 - 2.8 * lagC) * scaleX;
      const lagCx = cols / 2 + 1.0 * scaleX * Math.sin((2 * Math.PI * lagT) / (5 * P));
      const wob = Math.sin(d * 0.52 - t * 2.8 + i * 1.2);
      const tentX = Math.round(lagCx + u * lagW * (1 - d * 0.02) + (0.4 + d * 0.12) * wob);
      if (tentX >= 0 && tentX < cols && grid[y][tentX] === ' ') {
        let ch = '|';
        const dx = tentX - prevX;
        if (d >= len - 2) ch = '.';
        else if (d >= len - 4) ch = ':';
        else if (dx > 0.4) ch = '\\';
        else if (dx < -0.4) ch = '/';
        else if (Math.abs(wob) > 0.7) ch = '~';
        grid[y][tentX] = ch;
      }
      prevX = tentX;
    }
  }

  return grid.map((r) => r.join('')).join('\n');
}

/**
 * Colors an individual character of the jellyfish using MAOS cyberpunk palette.
 */
export function colorJellyfishChar(ch: string, rowIndex: number, rimRow: number): string {
  if (ch === ' ') return ' ';
  if (ch === '·') {
    return palette.slateMuted(ch); // Drifting plankton specks
  }
  if (ch === '~' || ch === "'") {
    return palette.cyan(ch); // Rim margin
  }
  if (ch === ';') {
    return palette.emerald(ch); // Oral mouth arms frills
  }
  if (rowIndex <= rimRow) {
    // Open water specks above bell in 44x26
    if (ch === '.' && rowIndex < 3) {
      return palette.slateMuted(ch);
    }
    // Bell body
    if (['@', '%', '#', '*'].includes(ch)) {
      return palette.cyanBright(ch); // Inner horseshoe luminescence
    }
    if (['+', '=', ':'].includes(ch)) {
      return palette.violetBright(ch);
    }
    return palette.violet(ch);
  }
  // Tentacles trailing behind
  if (['|', '/', '\\', '(', ')'].includes(ch)) {
    return palette.cyanBright(ch);
  }
  if ([':', '.'].includes(ch)) {
    return palette.slateMuted(ch); // Fading tentacle tips and drifting specks
  }
  return palette.cyan(ch);
}

/**
 * Returns the full mathematical jellyfish frame with cyberpunk ANSI colors.
 */
export function renderColoredJellyfish(t: number = 0, cols: number = meta.cols, rows: number = meta.rows): string[] {
  const rawText = generateJellyfishRawFrame(t, cols, rows);
  const rawLines = rawText.split('\n');
  const rimRow = Math.floor(rimAt(t, cols, rows).y);

  return rawLines.map((line, r) => {
    let out = '';
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      out += colorJellyfishChar(line[cIdx] || ' ', r, rimRow);
    }
    return out;
  });
}

/**
 * Compact Jellyfish Mascot (defaults to 8 rows x 20 cols) optimized for TUI Header & Cards.
 * Accurately renders the authentic mathematical moon jelly geometry from the core simulation:
 * recognizable bell dome, inner luminescence, wavy rim margin, frilled mouth arms,
 * trailing tentacles, and cyberpunk luminescence.
 */
export function renderJellyfishMascot(t: number = 0, cols: number = 20, rows: number = 8): string[] {
  const rawText =
    cols >= meta.cols && rows >= meta.rows
      ? generateJellyfishRawFrame(t, cols, rows)
      : generateCompactJellyfishRawFrame(t, cols, rows);
  const rawLines = rawText.split('\n');
  const rimRow = Math.max(2, Math.floor(rows * 0.45));

  return rawLines.map((line, r) => {
    let colored = '';
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const char = line[cIdx] || ' ';
      colored += colorJellyfishChar(char, r, rimRow);
    }
    return colored;
  });
}
