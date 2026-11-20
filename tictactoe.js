// Tic Tac Toe Game Logic
const board = ['', '', '', '', '', '', '', '', ''];
let currentPlayer = 'X';
let gameOver = false;

const winningCombinations = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function checkWinner() {
  for (const combo of winningCombinations) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  if (board.every((cell) => cell !== '')) {
    return 'tie';
  }
  return null;
}

function handleCellClick(index) {
  if (gameOver || board[index] !== '') return;

  board[index] = currentPlayer;
  const winner = checkWinner();

  if (winner) {
    gameOver = true;
    renderBoard();
    setTimeout(() => {
      if (winner === 'tie') {
        alert("It's a draw!");
      } else {
        alert(`Player ${winner} wins!`);
      }
    }, 10);
    return;
  }

  currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
  renderBoard();
}

function renderBoard() {
  const container = document.getElementById('board') || document.querySelector('.board');
  if (!container) return;

  container.innerHTML = '';
  board.forEach((val, idx) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.textContent = val;
    cell.addEventListener('click', () => handleCellClick(idx));
    container.appendChild(cell);
  });
}

function resetGame() {
  for (let i = 0; i < board.length; i++) board[i] = '';
  currentPlayer = 'X';
  gameOver = false;
  renderBoard();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', renderBoard);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    renderBoard();
  }
}

if (typeof module !== 'undefined') {
  module.exports = { board, handleCellClick, checkWinner, resetGame };
}
