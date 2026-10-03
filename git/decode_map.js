const corruptedStrings = [
  'ðŸ›’',
  'ðŸ”„',
  'âœ–ï¸',
  'âŒ',
  'ðŸ“‹',
  'ðŸ›ï¸',
  'ðŸ§¾',
  'ðŸ§°',
  'ðŸ“Š',
  'ðŸŽ«',
  'ðŸ“¢',
  'âš™ï¸'
];

function decode(str) {
  const latin1Bytes = Buffer.from(str, 'latin1');
  return latin1Bytes.toString('utf8');
}

corruptedStrings.forEach(s => {
  const decoded = decode(s);
  console.log(`${JSON.stringify(s)} -> ${JSON.stringify(decoded)}`);
});