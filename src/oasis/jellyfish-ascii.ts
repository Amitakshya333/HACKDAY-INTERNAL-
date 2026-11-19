/**
 * Jellyfish ASCII Art & Mascot Generator for MAOS Oasis Swarm Board.
 *
 * Implements the mathematical moon jelly simulation:
 * - Pulsing bell squeezing and relaxing (P = 2.2s stroke)
 * - Trailing tentacles with staggered phase lags
 * - Frilled oral mouth arms twisting with sinusoids
 * - Ambient drifting plankton specks
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

const RAMP = ' .::=+*#%@';
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
  const x = totalCols / 2 + 1.5 * scaleX * Math.sin((2 * Math.PI * t) / (5 * P));
  const y = (11 - 0.8 * c - 1.4 * lift(t)) * scaleY;
  const half = (13 - 2.6 * c) * (1 - 0.3 * c) * scaleX;
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
 * - 3-row arched bell dome with curved crown and inner horseshoe luminescence (* / #)
 * - Signature wavy rim margin ('~'~'~'~') modulating with stroke squeeze
 * - 4 spaced trailing tentacles that undulate with wave lag, bowing with ( ) / \ |
 * - 2 central frilled oral mouth arms with ';'
 * - Fading tips with ':' and '.'
 */
export function generateCompactJellyfishRawFrame(t: number = 0, cols: number = 20, rows: number = 8): string {
  const c = squeeze(t);
  const cx = cols / 2 + 0.8 * Math.sin((2 * Math.PI * t) / (5 * P));
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));

  const rimRow = Math.max(2, Math.floor(rows * 0.45));
  const domeRows = rimRow;
  const half = (cols * 0.38 - 1.8 * c) * (1 - 0.15 * c);

  // Bell dome rows: 0 to rimRow - 1
  for (let r = 0; r < domeRows; r++) {
    const s = (domeRows - r - 0.5) / domeRows; // 1 at top, ~0 near rim
    const w = Math.max(2, Math.round(half * Math.sqrt(Math.max(0.1, 1 - s * s * 0.8))));
    const left = Math.round(cx - w);
    const right = Math.round(cx + w);
    for (let x = left; x <= right; x++) {
      if (x >= 0 && x < cols) {
        if (r === 0) {
          grid[r][x] = x === left || x === right ? '.' : '-';
        } else if (r === domeRows - 1) {
          if (x === left) grid[r][x] = '(';
          else if (x === right) grid[r][x] = ')';
          else {
            const u = (x - cx) / w;
            const g = Math.abs(Math.abs(u) - 0.55);
            if (g < 0.18) grid[r][x] = c > 0.5 ? '*' : '+';
            else if (Math.abs(u) < 0.22) grid[r][x] = ':';
            else grid[r][x] = '=';
          }
        } else {
          if (x === left || x === right) grid[r][x] = '_';
          else {
            const u = (x - cx) / w;
            const g = Math.abs(Math.abs(u) - 0.52);
            grid[r][x] = g < 0.18 ? (c > 0.6 ? '#' : '*') : ':';
          }
        }
      }
    }
  }

  // Rim Row (signature wavy moon jelly rim margin)
  const rimW = Math.max(3, Math.round(half + 0.5));
  const rimLeft = Math.round(cx - rimW);
  const rimRight = Math.round(cx + rimW);
  for (let x = rimLeft; x <= rimRight; x++) {
    if (x >= 0 && x < cols) {
      grid[rimRow][x] = x === rimLeft || x === rimRight ? "'" : (x - rimLeft) % 2 === 1 ? '~' : "'";
    }
  }

  // 4 Spaced Trailing Tentacles (outer left, inner left, inner right, outer right)
  const tentU = [-0.85, -0.42, 0.42, 0.85];
  for (let i = 0; i < tentU.length; i++) {
    const u = tentU[i];
    let prevX = cx + u * half;
    for (let y = rimRow + 1; y < rows; y++) {
      const d = y - rimRow;
      const lagT = t - d * 0.08;
      const lagC = squeeze(lagT);
      const lagHalf = (cols * 0.38 - 1.8 * lagC) * (1 - 0.15 * lagC);
      const lagCx = cols / 2 + 0.8 * Math.sin((2 * Math.PI * lagT) / (5 * P));
      const wob = Math.sin(d * 0.7 - t * 3.0 + i * 1.5);
      const curX = Math.round(lagCx + u * lagHalf + (0.15 + d * 0.08) * wob);
      const dx = curX - prevX;
      prevX = curX;
      if (curX >= 0 && curX < cols) {
        let ch = '|';
        if (d >= rows - rimRow - 1) ch = ':';
        else if (dx > 0.4) ch = '\\';
        else if (dx < -0.4) ch = '/';
        else if (wob > 0.25) ch = ')';
        else if (wob < -0.25) ch = '(';
        grid[y][curX] = ch;
      }
    }
  }

  // 2 Central Frilled Oral Mouth Arms with ';'
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    for (let y = rimRow + 1; y < rows; y++) {
      const d = y - rimRow;
      const lagT = t - d * 0.1;
      const lagCx = cols / 2 + 0.8 * Math.sin((2 * Math.PI * lagT) / (5 * P));
      const tw = Math.sin(d * 0.9 - t * 2.5 + i * 2.0);
      const curX = Math.round(lagCx + s * (1.2 - d * 0.15) + 0.6 * tw);
      if (curX >= 0 && curX < cols) {
        grid[y][curX] = d >= rows - rimRow - 1 ? ':' : ';';
      }
    }
  }

  return grid.map((r) => r.join('')).join('\n');
}

/**
 * Generates an uncolored raw mathematical ASCII frame (cols x rows) at time t.
 */
export function generateJellyfishRawFrame(t: number = 0, cols: number = meta.cols, rows: number = meta.rows): string {
  if (cols < 36 || rows < 20) {
    return generateCompactJellyfishRawFrame(t, cols, rows);
  }

  let seed = 7;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };

  const isStandard = cols === meta.cols && rows === meta.rows;
  const speckCount = isStandard ? 30 : Math.max(2, Math.round((30 * (cols * rows)) / (meta.cols * meta.rows)));

  const specks = Array.from({ length: speckCount }, () => ({
    x: rnd() * cols,
    y: rnd() * rows,
    z: 0.4 + rnd() * 0.6,
    w: rnd() * 6.3,
  }));

  const grid: string[] = new Array(cols * rows);
  const put = (x: number, y: number, ch: string) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx >= 0 && rx < cols && ry >= 0 && ry < rows) grid[ry * cols + rx] = ch;
  };

  const travel = (time: number) => {
    const k = Math.floor(time / P);
    const p = phase(time);
    return 0.9 * time + 2.4 * (k + (p < SQ ? 0.8 * ease(p / SQ) : 0.8 + (0.2 * (p - SQ)) / (1 - SQ)));
  };

  grid.fill(' ');
  const D = travel(t);
  for (const s of specks) {
    const y = Math.floor((((s.y + D * s.z) % rows) + rows) % rows);
    put(s.x + 0.6 * Math.sin(t * 0.5 + s.w), y, s.z > 0.8 ? '·' : '.');
  }

  const scaleX = cols / meta.cols;
  const scaleY = rows / meta.rows;
  const now = rimAt(t, cols, rows);
  const { c } = now;
  const a = (13 - 2.6 * c) * scaleX;
  const b = (13 + 2 * c) * scaleY;
  const rim = Math.floor(now.y);

  const trail = (d: number, lagPer: number) => {
    const was = rimAt(t - (d / scaleY) * lagPer, cols, rows);
    return { x: was.x, y: rim + d + Math.max(0, was.y - now.y) * 0.8, half: was.half };
  };
  const cx = now.x;

  const strand = (
    len: number,
    lag: number,
    xAt: (d: number, at: ReturnType<typeof trail>) => number,
    mark: (x: number, y: number, dx: number, bow: number, d: number, f: number) => void,
  ) => {
    let d = 1;
    let px = xAt(1, trail(1, lag));
    let pdx = 0;
    for (let y = rim + 1; y < rows; y++) {
      while (d < len && trail(d, lag).y < y) d += 0.25;
      if (d >= len) break;
      const x = xAt(d, trail(d, lag));
      const dx = x - px;
      mark(x, y, dx, dx - pdx, d, d / len);
      px = x;
      pdx = dx;
    }
  };

  for (let i = 0; i < 8; i++) {
    const u = -0.92 + (1.84 * i) / 7;
    const wob = (d: number) => Math.sin((d / scaleY) * 0.5 - t * 3 + i * 1.9);
    const len = (8.5 + 3.2 * (1 - Math.abs(u)) + ((i * 3) % 5) * 0.8) * scaleY;
    strand(
      len,
      0.06,
      (d, at) => at.x + u * at.half * (1 - 0.01 * (d / scaleY)) + (0.05 + (d / scaleY) * 0.013) * d * wob(d),
      (x, y, dx, bow, _d, f) => {
        const ch =
          f > 0.9
            ? '.'
            : f > 0.8
              ? ':'
              : dx > 0.6
                ? '\\'
                : dx < -0.6
                  ? '/'
                  : bow > 0.22
                    ? '('
                    : bow < -0.22
                      ? ')'
                      : '|';
        put(x, y, ch);
      },
    );
  }

  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    strand(
      10 * scaleY,
      0.09,
      (d, at) =>
        at.x +
        s * 2 * scaleX * (1 - (d / scaleY) * 0.06) * (at.half / Math.max(0.1, 10 * scaleX)) +
        0.9 * scaleX * Math.sin((d / scaleY) * 0.6 - t * 2.2 + i * 2.5),
      (x, y, _dx, _bow, d, f) => {
        const tw = Math.cos((d / scaleY) * 1.1 + i * 1.3 - t * 1.6);
        if (f > 0.8) return put(x, y, f > 0.9 ? '.' : ':');
        if (Math.abs(tw) < 0.35) return put(x, y, ':');
        put(x, y, ';');
        if (tw > 0.5) put(x + s, y, s > 0 ? ')' : '(');
      },
    );
  }

  const width = (s: number) => a * Math.sqrt(Math.max(0, 1 - s * s)) * (1 - 0.3 * c * (1 - s) ** 2);
  const inside = (X: number, yy: number) => {
    const s = ((now.y - yy) * 2) / b;
    return s >= 0 && s < 1 && Math.abs(X) < width(s);
  };

  for (let x = 0; x < cols; x++) {
    const u = (x + 0.5 - cx) / Math.max(0.1, width(0));
    if (Math.abs(u) < 1) grid[rim * cols + x] = Math.abs(u) > 0.93 ? "'" : x & 1 ? '~' : "'";
  }

  const edgeThreshold = isStandard
    ? 10
    : Math.max(5, Math.min(10, Math.round(10 * Math.min(1, Math.max(0.5, (scaleX + scaleY) / 2)))));

  for (let r = 0; r < rim; r++) {
    for (let x = 0; x < cols; x++) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 3; i++) {
          if (inside(x + (i + 0.5) / 3 - cx, r + (j + 0.5) / 4)) {
            n++;
            sx += i - 1;
            sy += (j - 1.5) / 1.5;
          }
        }
      }
      if (!n) continue;
      const k = r * cols + x;
      if (n < edgeThreshold) {
        const ux = sx / n;
        const uy = sy / n;
        if (uy > Math.abs(ux) * 1.2) grid[k] = n < Math.round(edgeThreshold * 0.5) ? '_' : '-';
        else if (Math.abs(ux) > uy * 1.5) grid[k] = ux > 0 ? '(' : ')';
        else grid[k] = n < Math.round(edgeThreshold * 0.4) ? '.' : ux > 0 ? '/' : '\\';
        continue;
      }
      const s = Math.max(0, ((now.y - r - 0.5) * 2) / b);
      const u = Math.max(-0.999, Math.min(0.999, (x + 0.5 - cx) / Math.max(0.1, width(s))));
      const nz = Math.sqrt(1 - u * u) * Math.sqrt(1 - s * s);
      const ph = Math.asin(u);
      const g = Math.min(Math.abs(ph - 0.6), Math.abs(ph + 0.6));
      const ring = Math.max(0, 1 - Math.abs(Math.hypot(g / 0.36, (s - 0.45) / 0.26) - 1) * 3.5);
      const crown = 1 - 0.6 * ease(Math.max(0, (s - 0.62) / 0.38));
      const v = Math.min(1, (0.16 + 0.07 * s + 0.6 * (1 - nz) ** 2) * crown + 0.55 * ring);
      grid[k] = RAMP[Math.max(1, Math.round(v * (RAMP.length - 1)))];
    }
  }

  const lines: string[] = [];
  for (let r = 0; r < rows; r++) lines.push(grid.slice(r * cols, (r + 1) * cols).join(''));
  return lines.join('\n');
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
    return palette.emerald(ch); // Oral mouth arms
  }
  if (rowIndex <= rimRow) {
    // Open water specks above bell in 44x26
    if (ch === '.' && rowIndex < 2 && rimRow > 5) {
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
