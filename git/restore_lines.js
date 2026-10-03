const fs = require('fs');

const backupPath = 'index.js.pre-correcao-609';
const currentPath = 'index.js';
const outputPath = 'index.js';

// List of line numbers (1-indexed) from the grep output for "ðŸ" and other patterns we want to restore
const lineNumbers = [
  62, 168, 251, 276, 315, 567, 569, 571, 580, 586, 591, 596, 603, 608, 626, 642, 646, 647, 651, 656, 661, 686, 696, 714, 736, 739, 744, 749, 754, 759, 764, 790, 799, 808, 834, 840, 846, 852, 858, 864, 870, 876, 884, 1076, 1129, 1137, 1138, 1141, 1166, 1174, 1260, 1282, 1286, 1291, 1306, 1331, 1371, 1764, 1916, 1926, 1960, 2062, 2181, 2186, 2191, 2196, 2263, 2272, 2313, 2345, 2351, 2356, 2360, 2364, 2390, 2497, 2504, 2513, 2552, 2558, 2567, 2668, 2677, 2754, 2799, 2807, 2808, 2811, 2839, 2847, 2917, 2998
];

// Read files
const backupLines = fs.readFileSync(backupPath, 'utf8').split('\n');
const currentLines = fs.readFileSync(currentPath, 'utf8').split('\n');

// Process each line number
lineNumbers.forEach(lineNum => {
  const idx = lineNum - 1; // convert to 0-indexed
  if (idx < backupLines.length && idx < currentLines.length) {
    // Only replace if the lines are different
    if (backupLines[idx] !== currentLines[idx]) {
      console.log(`Replacing line ${lineNum}`);
      console.log(`  Backup: ${backupLines[idx]}`);
      console.log(`  Current: ${currentLines[idx]}`);
      currentLines[idx] = backupLines[idx];
    }
  } else {
    console.log(`Line ${lineNum} out of range in backup or current`);
  }
});

// Write the current file
fs.writeFileSync(outputPath, currentLines.join('\n'), 'utf8');
console.log('Done.');