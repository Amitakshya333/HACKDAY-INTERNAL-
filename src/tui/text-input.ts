/**
 * Responsive Text Input State and Cursor Rendering Engine for MAOS TUI.
 *
 * Implements modern dev CLI input behaviors (OpenCode / Antigravity / Claude Code):
 * - Grapheme-aware full cursor navigation (Left, Right, Word jumps, Home, End)
 * - Editing at cursor (Insert, Backspace, Delete, Word delete, Line clear)
 * - Sleek visual styling with high-visibility cursor (inverse video / block cursor)
 * - Smooth horizontal viewport scrolling for long commands and dictations
 */

import chalk from 'chalk';

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function terminalCellWidth(str: string): number {
  if (!str) return 0;
  const stripped = str.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
  let width = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(stripped)) {
    const points = Array.from(segment, (c) => c.codePointAt(0)!);
    const point = points[0];
    if (point <= 0x1f || (point >= 0x7f && point <= 0x9f)) continue;
    const wide =
      points.length > 1 ||
      (point >= 0x1100 && point <= 0x115f) ||
      (point >= 0x2329 && point <= 0x232a) ||
      (point >= 0x2e80 && point <= 0x303e) ||
      (point >= 0x3040 && point <= 0xa4cf) ||
      (point >= 0xac00 && point <= 0xd7a3) ||
      (point >= 0xf900 && point <= 0xfaff) ||
      (point >= 0xfe30 && point <= 0xfe6f) ||
      (point >= 0xff00 && point <= 0xff60) ||
      (point >= 0xffe0 && point <= 0xffe6) ||
      (point >= 0x1f300 && point <= 0x1faff) ||
      (point >= 0x20000 && point <= 0x3fffd);
    const hasVS16 = points.includes(0xfe0f);
    const emojiPresentation =
      (hasVS16 && point !== 0x2713 && point !== 0x2714) ||
      points.includes(0x20e3) ||
      points.filter((value) => value >= 0x1f1e6 && value <= 0x1f1ff).length === 2 ||
      (point >= 0x1f300 && point <= 0x1faff) ||
      [0x2705, 0x2728, 0x274c, 0x274e, 0x2753, 0x2754, 0x2755, 0x2757, 0x2795, 0x2796, 0x2797, 0x27b0, 0x27bf].includes(
        point,
      ) ||
      (hasVS16 && [0x26a0, 0x2699, 0x26d4, 0x26a1, 0x267f].includes(point)) ||
      (!hasVS16 && [0x26a1, 0x26d4, 0x267f].includes(point));
    width += wide || emojiPresentation ? 2 : 1;
  }
  return width;
}

export class TextInputState {
  private text: string = '';
  private cursorPos: number = 0;

  constructor(initialText: string = '') {
    this.setText(initialText, true);
  }

  public getText(): string {
    return this.text;
  }

  public getCursor(): number {
    return this.cursorPos;
  }

  public setText(val: string, cursorAtEnd: boolean = true): void {
    this.text = val || '';
    this.cursorPos = cursorAtEnd ? this.text.length : Math.max(0, Math.min(this.text.length, this.cursorPos));
  }

  public setCursor(pos: number): void {
    this.cursorPos = Math.max(0, Math.min(this.text.length, pos));
  }

  /**
   * Inserts text at the current cursor position (handles typing, pasting, and voice dictation).
   */
  public insert(str: string): void {
    if (!str) return;
    const clean = str.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
    const before = this.text.slice(0, this.cursorPos);
    const after = this.text.slice(this.cursorPos);
    this.text = before + clean + after;
    this.cursorPos += clean.length;
  }

  /**
   * Deletes the grapheme/character immediately before the cursor (Backspace).
   */
  public deleteBackward(): boolean {
    if (this.cursorPos <= 0) return false;
    const chars = Array.from(GRAPHEME_SEGMENTER.segment(this.text), ({ segment }) => segment);
    let cumulative = 0;
    for (let i = 0; i < chars.length; i++) {
      cumulative += chars[i].length;
      if (cumulative >= this.cursorPos) {
        const removedLen = chars[i].length;
        chars.splice(i, 1);
        this.text = chars.join('');
        this.cursorPos = Math.max(0, this.cursorPos - removedLen);
        return true;
      }
    }
    this.text = this.text.slice(0, this.cursorPos - 1) + this.text.slice(this.cursorPos);
    this.cursorPos--;
    return true;
  }

  /**
   * Deletes the grapheme/character immediately under the cursor (Delete).
   */
  public deleteForward(): boolean {
    if (this.cursorPos >= this.text.length) return false;
    const chars = Array.from(GRAPHEME_SEGMENTER.segment(this.text), ({ segment }) => segment);
    let cumulative = 0;
    for (let i = 0; i < chars.length; i++) {
      if (cumulative === this.cursorPos) {
        chars.splice(i, 1);
        this.text = chars.join('');
        return true;
      }
      cumulative += chars[i].length;
    }
    this.text = this.text.slice(0, this.cursorPos) + this.text.slice(this.cursorPos + 1);
    return true;
  }

  /**
   * Moves cursor left by 1 character or word boundary.
   */
  public moveLeft(byWord: boolean = false): void {
    if (this.cursorPos <= 0) return;
    if (!byWord) {
      const chars = Array.from(GRAPHEME_SEGMENTER.segment(this.text), ({ segment }) => segment);
      let cumulative = 0;
      let prevCumulative = 0;
      for (const seg of chars) {
        cumulative += seg.length;
        if (cumulative >= this.cursorPos) {
          this.cursorPos = prevCumulative;
          return;
        }
        prevCumulative = cumulative;
      }
      this.cursorPos = Math.max(0, this.cursorPos - 1);
    } else {
      let pos = this.cursorPos;
      while (pos > 0 && /\s/.test(this.text[pos - 1])) pos--;
      while (pos > 0 && !/\s/.test(this.text[pos - 1])) pos--;
      this.cursorPos = Math.max(0, pos);
    }
  }

  /**
   * Moves cursor right by 1 character or word boundary.
   */
  public moveRight(byWord: boolean = false): void {
    if (this.cursorPos >= this.text.length) return;
    if (!byWord) {
      const chars = Array.from(GRAPHEME_SEGMENTER.segment(this.text), ({ segment }) => segment);
      let cumulative = 0;
      for (const seg of chars) {
        cumulative += seg.length;
        if (cumulative > this.cursorPos) {
          this.cursorPos = cumulative;
          return;
        }
      }
      this.cursorPos = Math.min(this.text.length, this.cursorPos + 1);
    } else {
      let pos = this.cursorPos;
      while (pos < this.text.length && !/\s/.test(this.text[pos])) pos++;
      while (pos < this.text.length && /\s/.test(this.text[pos])) pos++;
      this.cursorPos = Math.min(this.text.length, pos);
    }
  }

  public moveToStart(): void {
    this.cursorPos = 0;
  }

  public moveToEnd(): void {
    this.cursorPos = this.text.length;
  }

  /**
   * Deletes the word immediately before the cursor (Ctrl+W).
   */
  public deleteWordBackward(): boolean {
    if (this.cursorPos <= 0) return false;
    let pos = this.cursorPos;
    while (pos > 0 && /\s/.test(this.text[pos - 1])) pos--;
    while (pos > 0 && !/\s/.test(this.text[pos - 1])) pos--;
    const before = this.text.slice(0, pos);
    const after = this.text.slice(this.cursorPos);
    this.text = before + after;
    this.cursorPos = pos;
    return true;
  }

  public clearLine(): void {
    this.text = '';
    this.cursorPos = 0;
  }

  public clearToStart(): void {
    this.text = this.text.slice(this.cursorPos);
    this.cursorPos = 0;
  }

  public clearToEnd(): void {
    this.text = this.text.slice(0, this.cursorPos);
  }
}

/**
 * Renders the input text content with a high-visibility cursor and smooth horizontal viewport scrolling.
 * - When empty: displays block cursor followed by placeholder text.
 * - Inside text: displays inverse video block highlight on character at cursor index.
 * - At end: displays bold block cursor.
 * - When text exceeds width: centers/scrolls viewport smoothly around cursor with '…' indicators.
 */
export function renderInputContentWithCursor(
  text: string,
  cursor: number,
  width: number,
  placeholder: string = 'Type a goal or /help for commands',
  cursorColor: (s: string) => string = chalk.bold.hex('#FFFFFF'),
): string {
  if (width <= 0) return '';
  const colorInstance = new chalk.Instance({ level: 3 });

  const c = {
    white: colorInstance.hex('#F8FAFC'),
    slateMuted: colorInstance.hex('#64748B'),
    inverse: colorInstance.bgHex('#FFFFFF').hex('#0F172A').bold,
    cursor: colorInstance.bold.hex('#FFFFFF'),
  };

  if (!text) {
    const placeholderWidth = Math.max(0, width - 2);
    const clippedPlaceholder = placeholder.slice(0, placeholderWidth);
    return `${cursorColor('█')} ${c.slateMuted(clippedPlaceholder)}`;
  }

  const chars = Array.from(GRAPHEME_SEGMENTER.segment(text), ({ segment }) => segment);
  const totalGraphemes = chars.length;

  let graphemeCursor = totalGraphemes;
  let byteCount = 0;
  for (let i = 0; i < totalGraphemes; i++) {
    if (byteCount >= cursor) {
      graphemeCursor = i;
      break;
    }
    byteCount += chars[i].length;
  }
  if (cursor >= text.length) {
    graphemeCursor = totalGraphemes;
  }

  const graphemeCells = chars.map((ch) => terminalCellWidth(ch));
  const totalCells = graphemeCells.reduce((sum, w) => sum + w, 0) + 1; // +1 for cursor

  if (totalCells <= width) {
    let rendered = '';
    for (let i = 0; i < totalGraphemes; i++) {
      if (i === graphemeCursor) {
        rendered += c.inverse(chars[i]);
      } else {
        rendered += chars[i];
      }
    }
    if (graphemeCursor === totalGraphemes) {
      rendered += cursorColor('█');
    }
    return c.white(rendered);
  }

  // Text exceeds width: window around cursor
  const budget = Math.max(4, width - 2);
  let leftGrapheme = 0;
  let cellsBeforeCursor = 0;
  for (let i = 0; i < graphemeCursor; i++) {
    cellsBeforeCursor += graphemeCells[i] || 1;
  }

  if (cellsBeforeCursor > budget - 4) {
    let acc = 0;
    for (let i = graphemeCursor; i >= 0; i--) {
      acc += graphemeCells[i] || 1;
      if (acc >= budget - 4) {
        leftGrapheme = i;
        break;
      }
    }
  }

  let windowStr = '';
  if (leftGrapheme > 0) {
    windowStr += c.slateMuted('…');
  }

  let usedCells = leftGrapheme > 0 ? 1 : 0;
  for (let i = leftGrapheme; i < totalGraphemes; i++) {
    const cellW = graphemeCells[i] || 1;
    if (usedCells + cellW > width - 1) {
      windowStr += c.slateMuted('…');
      break;
    }
    if (i === graphemeCursor) {
      windowStr += c.inverse(chars[i]);
    } else {
      windowStr += chars[i];
    }
    usedCells += cellW;
  }

  if (graphemeCursor === totalGraphemes && usedCells < width) {
    windowStr += cursorColor('█');
  }

  return c.white(windowStr);
}
