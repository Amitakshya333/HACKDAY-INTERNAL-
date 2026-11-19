import { describe, it, expect } from 'vitest';
import { TextInputState, renderInputContentWithCursor, terminalCellWidth } from '../../src/tui/text-input';

describe('TextInputState & Cursor Navigation Suite', () => {
  it('initializes with empty text and cursor at 0', () => {
    const input = new TextInputState();
    expect(input.getText()).toBe('');
    expect(input.getCursor()).toBe(0);
  });

  it('inserts text at cursor and advances cursor', () => {
    const input = new TextInputState();
    input.insert('hello');
    expect(input.getText()).toBe('hello');
    expect(input.getCursor()).toBe(5);

    input.insert(' world');
    expect(input.getText()).toBe('hello world');
    expect(input.getCursor()).toBe(11);
  });

  it('inserts multi-character chunks (voice dictation / paste) in the middle', () => {
    const input = new TextInputState('deploy app');
    input.setCursor(7); // before 'app'
    input.insert('3d canva ');
    expect(input.getText()).toBe('deploy 3d canva app');
    expect(input.getCursor()).toBe(16);
  });

  it('navigates cursor left and right by character', () => {
    const input = new TextInputState('hello');
    expect(input.getCursor()).toBe(5);

    input.moveLeft();
    expect(input.getCursor()).toBe(4);

    input.moveLeft();
    expect(input.getCursor()).toBe(3);

    input.moveRight();
    expect(input.getCursor()).toBe(4);

    input.moveRight();
    input.moveRight(); // clamped to length
    expect(input.getCursor()).toBe(5);

    input.moveToStart();
    expect(input.getCursor()).toBe(0);
    input.moveLeft(); // clamped to 0
    expect(input.getCursor()).toBe(0);
  });

  it('jumps cursor by word boundaries (Ctrl+Left / Ctrl+Right)', () => {
    const input = new TextInputState('build and deploy canva 3d');
    expect(input.getCursor()).toBe(25);

    // Jump left by word: to '3d', then 'canva', then 'deploy', then 'and', then 'build'
    input.moveLeft(true);
    expect(input.getCursor()).toBe(23); // start of '3d'

    input.moveLeft(true);
    expect(input.getCursor()).toBe(17); // start of 'canva'

    input.moveLeft(true);
    expect(input.getCursor()).toBe(10); // start of 'deploy'

    input.moveLeft(true);
    expect(input.getCursor()).toBe(6); // start of 'and'

    input.moveLeft(true);
    expect(input.getCursor()).toBe(0); // start of 'build'

    // Jump right by word
    input.moveRight(true);
    expect(input.getCursor()).toBe(6); // start of 'and'

    input.moveRight(true);
    expect(input.getCursor()).toBe(10); // start of 'deploy'

    input.moveToEnd();
    expect(input.getCursor()).toBe(25);
  });

  it('handles backspace at cursor (deleting character before cursor)', () => {
    const input = new TextInputState('cat');
    expect(input.deleteBackward()).toBe(true);
    expect(input.getText()).toBe('ca');
    expect(input.getCursor()).toBe(2);

    input.setCursor(1);
    expect(input.deleteBackward()).toBe(true);
    expect(input.getText()).toBe('a');
    expect(input.getCursor()).toBe(0);

    // Backspace at position 0 does nothing and returns false
    expect(input.deleteBackward()).toBe(false);
    expect(input.getText()).toBe('a');
    expect(input.getCursor()).toBe(0);
  });

  it('handles delete at cursor (deleting character under cursor)', () => {
    const input = new TextInputState('hello');
    input.setCursor(0);
    expect(input.deleteForward()).toBe(true);
    expect(input.getText()).toBe('ello');
    expect(input.getCursor()).toBe(0);

    input.setCursor(4); // at end
    expect(input.deleteForward()).toBe(false);
    expect(input.getText()).toBe('ello');
  });

  it('deletes previous word on Ctrl+W', () => {
    const input = new TextInputState('git push origin main');
    expect(input.deleteWordBackward()).toBe(true);
    expect(input.getText()).toBe('git push origin ');
    expect(input.getCursor()).toBe(16);

    expect(input.deleteWordBackward()).toBe(true);
    expect(input.getText()).toBe('git push ');
    expect(input.getCursor()).toBe(9);
  });

  it('clears line on Ctrl+U', () => {
    const input = new TextInputState('deploy full swarm');
    input.clearLine();
    expect(input.getText()).toBe('');
    expect(input.getCursor()).toBe(0);
  });

  it('renders input box with placeholder when empty', () => {
    const rendered = renderInputContentWithCursor('', 0, 40, 'Type a goal or /help');
    expect(rendered).toContain('█');
    expect(rendered).toContain('Type a goal or /help');
  });

  it('renders cursor at end of text with █', () => {
    const rendered = renderInputContentWithCursor('build', 5, 40);
    expect(rendered).toContain('build');
    expect(rendered).toContain('█');
  });

  it('renders inverse video highlight on character at cursor position in middle of text', () => {
    const rendered = renderInputContentWithCursor('build', 2, 40); // cursor on 'i'
    expect(rendered).toContain('bu');
    // contains ANSI inverse or highlight code around 'i'
    expect(rendered).toContain('\u001b[');
    expect(rendered).toContain('ld');
  });

  it('scrolls horizontally smoothly when text exceeds width', () => {
    const longText = 'This is a very long goal that exceeds the terminal input box width by a significant amount';
    const rendered = renderInputContentWithCursor(longText, longText.length, 30);
    expect(rendered).toContain('…');
    expect(rendered).toContain('█');
  });
});
