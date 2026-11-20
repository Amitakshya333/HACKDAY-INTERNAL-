/**
 * Offline fallback scaffold for "snake" goals: a complete, playable canvas game.
 * Used by worker-agent when the local model returns no usable files.
 */

export const SNAKE_GOAL_PATTERN = /\bsnake\b/i;

const SNAKE_JS = `// MAOS Oasis Snake: pure game logic + canvas renderer (no dependencies)
const GRID = 20;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };

function placeFood(snake, rand = Math.random) {
  const free = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!snake.some((s) => s[0] === x && s[1] === y)) free.push([x, y]);
    }
  }
  return free.length ? free[Math.floor(rand() * free.length)] : null;
}

function createState(rand = Math.random) {
  const snake = [[10, 10], [9, 10], [8, 10]];
  return { snake, dir: 'right', nextDir: 'right', food: placeFood(snake, rand), score: 0, over: false };
}

function turn(state, dir) {
  if (DIRS[dir] && dir !== OPPOSITE[state.dir]) state.nextDir = dir;
  return state;
}

function step(state, rand = Math.random) {
  if (state.over) return state;
  state.dir = state.nextDir;
  const [dx, dy] = DIRS[state.dir];
  const head = [state.snake[0][0] + dx, state.snake[0][1] + dy];
  const eats = state.food && head[0] === state.food[0] && head[1] === state.food[1];
  const body = eats ? state.snake : state.snake.slice(0, -1);
  const hitWall = head[0] < 0 || head[1] < 0 || head[0] >= GRID || head[1] >= GRID;
  if (hitWall || body.some((s) => s[0] === head[0] && s[1] === head[1])) {
    state.over = true;
    return state;
  }
  state.snake = [head, ...body];
  if (eats) {
    state.score += 1;
    state.food = placeFood(state.snake, rand);
    if (!state.food) state.over = true; // board full: you win
  }
  return state;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GRID, createState, turn, step, placeFood };
}

if (typeof document !== 'undefined') {
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const statusEl = document.getElementById('status');
  const cell = canvas.width / GRID;
  let best = Number(localStorage.getItem('maos-snake-best') || 0);
  let state = createState();
  let paused = false;
  bestEl.textContent = best;

  const keyMap = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };

  function draw() {
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state.food) {
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.arc((state.food[0] + 0.5) * cell, (state.food[1] + 0.5) * cell, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    state.snake.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? '#67e8f9' : '#22d3ee';
      ctx.fillRect(s[0] * cell + 1, s[1] * cell + 1, cell - 2, cell - 2);
    });
    scoreEl.textContent = state.score;
    statusEl.textContent = state.over ? 'Game over! Press Space to restart.' : paused ? 'Paused (P to resume)' : 'Arrows / WASD to move · P to pause';
  }

  function tick() {
    if (!paused && !state.over) {
      step(state);
      if (state.score > best) {
        best = state.score;
        localStorage.setItem('maos-snake-best', String(best));
        bestEl.textContent = best;
      }
    }
    draw();
    setTimeout(tick, Math.max(60, 140 - state.score * 3));
  }

  document.addEventListener('keydown', (e) => {
    if (keyMap[e.key]) {
      e.preventDefault();
      turn(state, keyMap[e.key]);
    } else if (e.key === ' ' && state.over) {
      state = createState();
    } else if (e.key === 'p' || e.key === 'P') {
      paused = !paused;
    }
  });
  document.querySelectorAll('[data-dir]').forEach((btn) =>
    btn.addEventListener('click', () => turn(state, btn.getAttribute('data-dir'))),
  );
  document.getElementById('restart').addEventListener('click', () => (state = createState()));

  draw();
  tick();
}
`;

const SNAKE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snake · MAOS Oasis</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="game">
    <h1>SNAKE</h1>
    <div class="scores">Score <strong id="score">0</strong> · Best <strong id="best">0</strong></div>
    <canvas id="board" width="400" height="400" aria-label="Snake game board"></canvas>
    <p id="status" role="status"></p>
    <div class="pad">
      <button data-dir="up" aria-label="Up">▲</button>
      <button data-dir="left" aria-label="Left">◀</button>
      <button data-dir="down" aria-label="Down">▼</button>
      <button data-dir="right" aria-label="Right">▶</button>
    </div>
    <button id="restart">Restart</button>
  </main>
  <script src="snake.js"></script>
</body>
</html>
`;

const SNAKE_CSS = `* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 20%, #151d38 0%, #070a14 100%);
  color: #f1f5f9; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.game { text-align: center; padding: 24px; }
h1 { color: #67e8f9; letter-spacing: 6px; margin-bottom: 8px; text-shadow: 0 0 12px rgba(103, 232, 249, 0.5); }
.scores { color: #94a3b8; margin-bottom: 12px; }
.scores strong { color: #f1f5f9; }
canvas { border: 1px solid #334155; border-radius: 8px; max-width: 90vw; height: auto; box-shadow: 0 0 30px rgba(103, 232, 249, 0.1); }
#status { color: #94a3b8; margin: 10px 0; min-height: 1.2em; }
.pad { display: grid; grid-template-columns: repeat(4, 48px); gap: 6px; justify-content: center; margin-bottom: 10px; }
button { background: #1e293b; color: #67e8f9; border: 1px solid #334155; border-radius: 6px; padding: 8px 14px; font-size: 16px; cursor: pointer; }
button:hover, button:focus-visible { border-color: #67e8f9; outline: none; }
`;

export function snakeScaffold(): Array<{ path: string; content: string; desc: string }> {
  return [
    { path: 'index.html', content: SNAKE_HTML, desc: 'Snake game page with canvas board and touch pad' },
    { path: 'style.css', content: SNAKE_CSS, desc: 'Snake game styling' },
    { path: 'snake.js', content: SNAKE_JS, desc: 'Snake engine (movement, growth, collisions) + canvas loop' },
  ];
}
