// ⚡ Oasis Cyberpunk Tic-Tac-Toe Game Engine
// Supports 2-Player Local, Gemma AI Minimax, and Web Audio SFX

let board = ['', '', '', '', '', '', '', '', ''];
let currentPlayer = 'X';
let gameActive = true;
let gameMode = 'ai'; // 'ai' or 'pvp'
let difficulty = 'unbeatable'; // 'unbeatable' or 'casual'
let soundEnabled = true;

const scores = {
  X: 0,
  O: 0,
  ties: 0
};

const WIN_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // Columns
  [0, 4, 8], [2, 4, 6]             // Diagonals
];

// Audio Synthesizer via Web Audio API (zero external assets needed)
let audioCtx = null;
function playSound(freq, duration = 0.08, type = 'sine') {
  if (!soundEnabled || typeof window === 'undefined') return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    /* ignore audio error */
  }
}

function checkWinner(currentBoard = board) {
  for (const combo of WIN_COMBOS) {
    const [a, b, c] = combo;
    if (currentBoard[a] && currentBoard[a] === currentBoard[b] && currentBoard[a] === currentBoard[c]) {
      return { winner: currentBoard[a], combo };
    }
  }
  if (currentBoard.every(cell => cell !== '')) {
    return { winner: 'tie', combo: null };
  }
  return null;
}

function getAvailableMoves(currentBoard = board) {
  const moves = [];
  for (let i = 0; i < currentBoard.length; i++) {
    if (currentBoard[i] === '') moves.push(i);
  }
  return moves;
}

// Minimax algorithm for unbeatable Gemma AI
function minimax(newBoard, depth, isMaximizing) {
  const result = checkWinner(newBoard);
  if (result) {
    if (result.winner === 'O') return 10 - depth;
    if (result.winner === 'X') return depth - 10;
    if (result.winner === 'tie') return 0;
  }

  const availMoves = getAvailableMoves(newBoard);

  if (isMaximizing) {
    let bestScore = -Infinity;
    for (const move of availMoves) {
      newBoard[move] = 'O';
      const score = minimax(newBoard, depth + 1, false);
      newBoard[move] = '';
      bestScore = Math.max(score, bestScore);
    }
    return bestScore;
  } else {
    let bestScore = Infinity;
    for (const move of availMoves) {
      newBoard[move] = 'X';
      const score = minimax(newBoard, depth + 1, true);
      newBoard[move] = '';
      bestScore = Math.min(score, bestScore);
    }
    return bestScore;
  }
}

function getBestMove() {
  const availMoves = getAvailableMoves(board);
  if (availMoves.length === 0) return null;

  if (difficulty === 'casual' && Math.random() < 0.4) {
    // 40% chance to pick random move on casual
    const randomIdx = Math.floor(Math.random() * availMoves.length);
    return availMoves[randomIdx];
  }

  // Minimax optimal move
  let bestScore = -Infinity;
  let bestMove = availMoves[0];
  for (const move of availMoves) {
    board[move] = 'O';
    const score = minimax(board, 0, false);
    board[move] = '';
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function handleCellClick(index) {
  if (!gameActive || board[index] !== '') return false;

  board[index] = currentPlayer;
  playSound(currentPlayer === 'X' ? 440 : 550, 0.08, 'triangle');
  renderBoard();

  const outcome = checkWinner(board);
  if (outcome) {
    endGame(outcome);
    return true;
  }

  // Switch player
  currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
  updateStatus();

  // Trigger AI if in AI mode and it's O's turn
  if (gameMode === 'ai' && currentPlayer === 'O' && gameActive) {
    setTimeout(makeAiMove, 350);
  }
  return true;
}

function makeAiMove() {
  if (!gameActive) return;
  const bestMove = getBestMove();
  if (bestMove !== null) {
    handleCellClick(bestMove);
  }
}

function endGame(outcome) {
  gameActive = false;
  const statusEl = document.getElementById('game-status');

  if (outcome.winner === 'tie') {
    scores.ties++;
    if (statusEl) statusEl.textContent = '🤝 Game ended in a DRAW!';
    playSound(260, 0.25, 'sawtooth');
  } else {
    scores[outcome.winner]++;
    const winnerName = outcome.winner === 'X' ? 'PLAYER X' : (gameMode === 'ai' ? 'GEMMA AI' : 'PLAYER O');
    if (statusEl) statusEl.textContent = '🏆 ' + winnerName + ' WINS THE MATCH!';
    // Highlight winning cells
    if (outcome.combo) {
      outcome.combo.forEach(idx => {
        const cell = document.querySelector('.cell[data-index="' + idx + '"]');
        if (cell) cell.classList.add('win-cell');
      });
    }
    // Victory fanfare sound
    setTimeout(() => playSound(523.25, 0.1, 'sine'), 50);
    setTimeout(() => playSound(659.25, 0.1, 'sine'), 150);
    setTimeout(() => playSound(783.99, 0.25, 'sine'), 250);
  }
  updateScoreboard();
}

function updateStatus() {
  const currentEl = document.getElementById('current-player');
  const indicatorEl = document.getElementById('turn-indicator');
  const statusEl = document.getElementById('game-status');
  if (!currentEl || !indicatorEl) return;

  if (gameActive) {
    const isX = currentPlayer === 'X';
    currentEl.textContent = isX ? 'PLAYER X' : (gameMode === 'ai' ? 'GEMMA AI (O)' : 'PLAYER O');
    currentEl.className = isX ? 'player-x' : 'player-o';
    indicatorEl.className = 'turn-indicator ' + (isX ? 'x-turn' : 'o-turn');
    if (statusEl) statusEl.textContent = 'Match in progress...';
  }
}

function updateScoreboard() {
  const xEl = document.getElementById('score-x');
  const oEl = document.getElementById('score-o');
  const tieEl = document.getElementById('score-ties');
  if (xEl) xEl.textContent = scores.X;
  if (oEl) oEl.textContent = scores.O;
  if (tieEl) tieEl.textContent = scores.ties;
}

function renderBoard() {
  if (typeof document === 'undefined') return;
  board.forEach((val, idx) => {
    const cell = document.querySelector('.cell[data-index="' + idx + '"]');
    if (cell) {
      cell.textContent = val;
      cell.className = 'cell' + (val === 'X' ? ' x-cell' : val === 'O' ? ' o-cell' : '');
      if (val !== '' || !gameActive) {
        cell.disabled = true;
      } else {
        cell.disabled = false;
      }
    }
  });
}

function resetGame() {
  board = ['', '', '', '', '', '', '', '', ''];
  currentPlayer = 'X';
  gameActive = true;
  playSound(350, 0.05);
  renderBoard();
  updateStatus();
}

function resetScores() {
  scores.X = 0;
  scores.O = 0;
  scores.ties = 0;
  updateScoreboard();
  resetGame();
}

// Browser DOM Initialization
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(cell => {
      cell.addEventListener('click', (e) => {
        const idx = parseInt(cell.getAttribute('data-index'), 10);
        handleCellClick(idx);
      });
    });

    const restartBtn = document.getElementById('btn-restart');
    if (restartBtn) restartBtn.addEventListener('click', resetGame);

    const resetScoresBtn = document.getElementById('btn-reset-scores');
    if (resetScoresBtn) resetScoresBtn.addEventListener('click', resetScores);

    const btnAi = document.getElementById('btn-mode-ai');
    const btnPvp = document.getElementById('btn-mode-pvp');
    const labelO = document.getElementById('label-player-o');

    if (btnAi && btnPvp) {
      btnAi.addEventListener('click', () => {
        gameMode = 'ai';
        btnAi.classList.add('active');
        btnPvp.classList.remove('active');
        if (labelO) labelO.textContent = 'GEMMA AI (O)';
        resetGame();
      });
      btnPvp.addEventListener('click', () => {
        gameMode = 'pvp';
        btnPvp.classList.add('active');
        btnAi.classList.remove('active');
        if (labelO) labelO.textContent = 'PLAYER O';
        resetGame();
      });
    }

    const diffSelect = document.getElementById('difficulty');
    if (diffSelect) {
      diffSelect.addEventListener('change', (e) => {
        difficulty = e.target.value;
      });
    }

    const soundBtn = document.getElementById('btn-toggle-sound');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        soundBtn.textContent = soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
      });
    }

    renderBoard();
    updateStatus();
    updateScoreboard();
  });
}

// Node.js test exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    board,
    checkWinner,
    getAvailableMoves,
    minimax,
    handleCellClick,
    resetGame,
    scores,
    WIN_COMBOS
  };
}
