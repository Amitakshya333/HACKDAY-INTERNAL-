const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let board = ["  ", "  ", "  ",
            "  ", "  ", "  ",
            "  ", "  ", "  "];

function printBoard() {
  console.log(board[0] + " | " + board[1] + " | " + board[2]);
  console.log("--------- ");
  console.log(board[3] + " | " + board[4] + " | " + board[5]);
  console.log("--------- ");
  console.log(board[6] + " | " + board[7] + " | " + board[8]);
}

function checkWin() {
  // Check rows
  // Check columns
  // Check diagonals
}

function playerTurn() {
  rl.question("Enter your move (1-9): ", (move) => {
    // Validate move
    // Update board
    printBoard();
    // Check for win
  });
}

printBoard();
playerTurn();
