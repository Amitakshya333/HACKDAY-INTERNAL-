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
const ease = (x: number) => x * x * (3 - 2 * x);
const phase = (t: number) => (((t % P) + P) % P) / P;

export const squeeze = (t: number) => {
  const p = phase(t);
  return p < SQ ? ease(p / SQ) : 1 - ease((p - SQ) / (1 - SQ));
};

export const lift = (t: number) => {
  const p = phase(t);
  return p < 0.4 ? ease(p / 0.4) : 1 - ease((p - 0.4) / 0.6);
};

export const rimAt = (t: number, cols = meta.cols, _rows = meta.rows) => {
  const c = squeeze(t);
  return {
    c,
    x: cols / 2 + 1.5 * Math.sin((2 * Math.PI * t) / (5 * P)),
    y: 11 - 0.8 * c - 1.4 * lift(t),
    half: (13 - 2.6 * c) * (1 - 0.3 * c),
  };
};

const color = new chalk.Instance({ level: 3 });
export const palette = {
  violet: color.hex('#8B5CF6'),
  violetBright: color.hex('#A78BFA'),
  cyan: color.hex('#06B6D4'),
  cyanBright: color.hex('#67E8F9'),
  emerald: color.hex('#10B981'),
  amber: color.hex('#F59E0B'),
  slateMuted: color.hex('#334155'),
  slateBorder: color.hex('#334155'),
  white: color.hex('#F8FAFC'),
  boldWhite: color.bold.hex('#FFFFFF'),
};

function mirrorChar(ch: string): string {
  if (ch === '(') return ')';
  if (ch === ')') return '(';
  if (ch === '/') return '\\';
  if (ch === '\\') return '/';
  if (ch === '<') return '>';
  if (ch === '>') return '<';
  if (ch === '{') return '}';
  if (ch === '}') return '{';
  if (ch === '[') return ']';
  if (ch === ']') return '[';
  return ch;
}

// Compact Jellyfish Mascot dynamically simulated with Aurelia aurita physics:
// - Curved umbrella crown apex contracting and expanding symmetrically with squeeze(t)
// - Translucent bell canopy with horseshoe gonad arches
// - Signature cloverleaf horseshoe gonads glowing brightly during contraction stroke
// - Scalloped dynamic undulating rim margin with travelling sinusoidal phase wave
// - 4 trailing marginal tentacles with wave lag and 2 central frilled oral mouth arms
// - 100% mathematically and visually symmetrical across the central vertical axis
export function generateCompactJellyfishRawFrame(t = 0, cols = 20, rows = 8): string {
  const c = squeeze(t);
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(' '));
  const halfCols = Math.floor(cols / 2);
  const rimRow = Math.max(2, Math.min(rows - 3, 3));

  // Row 0: Smooth arched crown apex
  const apexIndent = c > 0.5 ? 5 : 4;
  grid[0][apexIndent] = '.';
  for (let x = apexIndent + 1; x < halfCols; x++) {
    grid[0][x] = '-';
  }

  // Row 1: Upper bell curve and horseshoe gonad lobes
  const bellIndent = c > 0.5 ? 3 : 2;
  grid[1][bellIndent] = '.';
  grid[1][bellIndent + 1] = '-';
  grid[1][bellIndent + 2] = "'";
  const glow = c > 0.6 ? '*' : c > 0.3 ? '+' : ':';
  const lobeStart = c > 0.5 ? 6 : 5;
  grid[1][lobeStart] = '(';
  grid[1][lobeStart + 1] = glow;
  grid[1][lobeStart + 2] = ')';

  // Row 2: Mid bell with cloverleaf horseshoe gonads
  const midIndent = c > 0.5 ? 2 : 1;
  grid[2][midIndent] = '(';
  const midLobeStart = 5;
  grid[2][midLobeStart] = '(';
  grid[2][midLobeStart + 1] = glow === '*' ? '*' : '+';
  grid[2][midLobeStart + 2] = ')';

  // Row 3: Scalloped dynamic undulating rim margin
  const rimIndent = c > 0.5 ? 2 : 1;
  grid[rimRow][rimIndent] = "'";
  for (let x = rimIndent + 1; x < halfCols; x++) {
    const wave = Math.sin((halfCols - x) * 1.3 + t * 3.5);
    grid[rimRow][x] = wave > 0.25 ? '~' : wave < -0.25 ? "'" : '-';
  }

  // Rows 4 to rows - 1: Trailing marginal tentacles and central frilled oral arms
  for (let y = rimRow + 1; y < rows; y++) {
    const d = y - rimRow;
    const lagT = t - d * 0.18;
    const wobO = Math.sin(d * 1.0 - lagT * 2.8);
    const wobI = Math.cos(d * 1.0 - lagT * 2.8);

    if (y === rows - 1) {
      // Tentacle tips trailing off
      grid[y][Math.min(halfCols - 1, 4)] = ':';
      grid[y][Math.min(halfCols - 1, 6)] = ':';
      grid[y][halfCols - 1] = ':';
    } else {
      // Outer tentacle
      const xOuter = Math.max(1, Math.min(halfCols - 4, Math.round(3 + (wobO > 0.25 ? 1 : wobO < -0.25 ? -1 : 0))));
      grid[y][xOuter] = wobO < -0.2 ? '/' : wobO > 0.2 ? '(' : '|';

      // Inner tentacle
      const xInner = Math.max(2, Math.min(halfCols - 2, Math.round(6 + (wobI > 0.25 ? 1 : wobI < -0.25 ? -1 : 0))));
      if (xInner !== xOuter) {
        grid[y][xInner] = wobI < -0.2 ? '/' : wobI > 0.2 ? '(' : '|';
      }

      // Central frilled oral arms
      const oralCol = d === 1 ? 8 : d === 2 ? 8 : 9;
      grid[y][oralCol] = ';';
      if (d === 2) grid[y][oralCol + 1] = ';';
    }
  }

  // Perfect mathematical reflection of left half across the central vertical axis
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < halfCols; x++) {
      const oppX = cols - 1 - x;
      grid[y][oppX] = mirrorChar(grid[y][x]);
    }
  }

  return grid.map((r) => r.join('').padEnd(cols).slice(0, cols)).join('\n');
}

export function generateJellyfishRawFrame(t = 0, cols = meta.cols, rows = meta.rows): string {
  if (cols !== meta.cols || rows !== meta.rows) return generateCompactJellyfishRawFrame(t, cols, rows);
  const { cols: width, rows: height } = meta;
  let seed = 7;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const specks = Array.from({ length: 30 }, () => ({
    x: rnd() * width,
    y: rnd() * height,
    z: 0.4 + rnd() * 0.6,
    w: rnd() * 6.3,
  }));
  const grid = new Array<string>(width * height);
  const put = (x: number, y: number, ch: string) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < width && y >= 0 && y < height) grid[y * width + x] = ch;
  };
  const travel = (time: number) => {
    const k = Math.floor(time / P),
      p = phase(time);
    return 0.9 * time + 2.4 * (k + (p < SQ ? 0.8 * ease(p / SQ) : 0.8 + (0.2 * (p - SQ)) / (1 - SQ)));
  };

  grid.fill(' ');
  const D = travel(t);
  for (const s of specks) {
    const y = Math.floor((((s.y + D * s.z) % height) + height) % height);
    put(s.x + 0.6 * Math.sin(t * 0.5 + s.w), y, s.z > 0.8 ? '' : '.');
  }
  const now = rimAt(t),
    { c } = now;
  const a = 13 - 2.6 * c,
    b = 13 + 2 * c;
  const rim = Math.floor(now.y);
  const trail = (d: number, lagPer: number) => {
    const was = rimAt(t - d * lagPer);
    return { x: was.x, y: rim + d + Math.max(0, was.y - now.y) * 0.8, half: was.half };
  };
  const cx = now.x;
  const strand = (
    len: number,
    lag: number,
    xAt: (d: number, at: ReturnType<typeof trail>) => number,
    mark: (x: number, y: number, dx: number, bow: number, d: number, f: number) => void,
  ) => {
    let d = 1,
      px = xAt(1, trail(1, lag)),
      pdx = 0;
    for (let y = rim + 1; y < height; y++) {
      while (d < len && trail(d, lag).y < y) d += 0.25;
      if (d >= len) break;
      const x = xAt(d, trail(d, lag)),
        dx = x - px;
      mark(x, y, dx, dx - pdx, d, d / len);
      px = x;
      pdx = dx;
    }
  };
  for (let i = 0; i < 8; i++) {
    const u = -0.92 + (1.84 * i) / 7;
    const wob = (d: number) => Math.sin(d * 0.5 - t * 3 + i * 1.9);
    const len = 8.5 + 3.2 * (1 - Math.abs(u)) + ((i * 3) % 5) * 0.8;
    strand(
      len,
      0.06,
      (d, at) => at.x + u * at.half * (1 - 0.01 * d) + (0.05 + d * 0.013) * d * wob(d),
      (x, y, dx, bow, _d, f) => {
        put(
          x,
          y,
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
                      : '|',
        );
      },
    );
  }
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    strand(
      10,
      0.09,
      (d, at) => at.x + s * 2 * (1 - d * 0.06) * (at.half / 10) + 0.9 * Math.sin(d * 0.6 - t * 2.2 + i * 2.5),
      (x, y, _dx, _bow, d, f) => {
        const tw = Math.cos(d * 1.1 + i * 1.3 - t * 1.6);
        if (f > 0.8) return put(x, y, f > 0.9 ? '.' : ':');
        if (Math.abs(tw) < 0.35) return put(x, y, ':');
        put(x, y, ';');
        if (tw > 0.5) put(x + s, y, s > 0 ? ')' : '(');
      },
    );
  }
  const widthAt = (s: number) => a * Math.sqrt(1 - s * s) * (1 - 0.3 * c * (1 - s) ** 2);
  const inside = (X: number, yy: number) => {
    const s = ((now.y - yy) * 2) / b;
    return s >= 0 && s < 1 && Math.abs(X) < widthAt(s);
  };
  for (let x = 0; x < width; x++) {
    const u = (x + 0.5 - cx) / widthAt(0);
    if (Math.abs(u) < 1) grid[rim * width + x] = Math.abs(u) > 0.93 ? "'" : x & 1 ? '~' : "'";
  }
  for (let r = 0; r < rim; r++) {
    for (let x = 0; x < width; x++) {
      let n = 0,
        sx = 0,
        sy = 0;
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 3; i++) {
          if (inside(x + (i + 0.5) / 3 - cx, r + (j + 0.5) / 4)) {
            n++;
            sx += i - 1;
            sy += (j - 1.5) / 1.5;
          }
        }
      if (!n) continue;
      const k = r * width + x;
      if (n < 10) {
        const ux = sx / n,
          uy = sy / n;
        if (uy > Math.abs(ux) * 1.2) grid[k] = n < 5 ? '_' : '-';
        else if (Math.abs(ux) > uy * 1.5) grid[k] = ux > 0 ? '(' : ')';
        else grid[k] = n < 4 ? '.' : ux > 0 ? '/' : '\\';
        continue;
      }
      const s = Math.max(0, ((now.y - r - 0.5) * 2) / b);
      const u = Math.max(-0.999, Math.min(0.999, (x + 0.5 - cx) / widthAt(s)));
      const nz = Math.sqrt(1 - u * u) * Math.sqrt(1 - s * s);
      const ph = Math.asin(u),
        g = Math.min(Math.abs(ph - 0.6), Math.abs(ph + 0.6));
      const ring = Math.max(0, 1 - Math.abs(Math.hypot(g / 0.36, (s - 0.45) / 0.26) - 1) * 3.5);
      const crown = 1 - 0.6 * ease(Math.max(0, (s - 0.62) / 0.38));
      const v = Math.min(1, (0.16 + 0.07 * s + 0.6 * (1 - nz) ** 2) * crown + 0.55 * ring);
      grid[k] = RAMP[Math.max(1, Math.round(v * (RAMP.length - 1)))];
    }
  }
  return Array.from({ length: height }, (_, r) =>
    grid
      .slice(r * width, (r + 1) * width)
      .map((cell) => cell || ' ')
      .join(''),
  ).join('\n');
}

export function colorJellyfishChar(ch: string, rowIndex: number, rimRow: number): string {
  if (ch === ' ') return ch;
  if (ch === '·') return palette.slateMuted(ch);
  if (ch === '.' || ch === ':')
    return rowIndex <= rimRow && (ch !== '.' || rowIndex >= 3) ? color.hex('#38BDF8')(ch) : palette.slateMuted(ch);
  if (ch === ';') return palette.emerald(ch);
  if (ch === '|' || ch === '/' || ch === '\\') return palette.cyan(ch);
  if (ch === '(' || ch === ')') return rowIndex <= rimRow ? palette.violetBright(ch) : palette.cyanBright(ch);
  if (ch === '~' || ch === "'") return palette.cyanBright(ch);
  if (ch === '-' || ch === '_') return rowIndex < rimRow ? palette.violet(ch) : palette.cyanBright(ch);
  if (ch === '+' || ch === '=') return palette.cyan(ch);
  if (ch === '*' || ch === '#' || ch === '@' || ch === '%') return palette.boldWhite(ch);
  return rowIndex <= rimRow ? color.hex('#0EA5E9')(ch) : palette.cyan(ch);
}

export function renderColoredJellyfish(t = 0, cols = meta.cols, rows = meta.rows): string[] {
  const lines = generateJellyfishRawFrame(t, cols, rows).split('\n');
  const rim = Math.floor(rimAt(t, cols, rows).y);
  return lines.map((line, r) =>
    Array.from({ length: cols }, (_, x) => colorJellyfishChar(line[x] || ' ', r, rim)).join(''),
  );
}

export function renderJellyfishMascot(t = 0, cols = 20, rows = 8): string[] {
  return generateCompactJellyfishRawFrame(t, cols, rows)
    .split('\n')
    .map((line, r) => Array.from({ length: cols }, (_, x) => colorJellyfishChar(line[x] || ' ', r, 3)).join(''));
}
