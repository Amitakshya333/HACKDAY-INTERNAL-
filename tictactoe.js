const board = [ 
  ['', '', ''],
  ['', '', ''],
  ['', '', '']
];

function printBoard() {
  console.log(board.map(row => row.join(' | ')).join('
---
'));
}

printBoard();