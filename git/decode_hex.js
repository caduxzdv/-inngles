function decodeHex(str) {
  const latin1Bytes = Buffer.from(str, 'latin1');
  const utf8String = latin1Bytes.toString('utf8');
  const hex = Buffer.from(utf8String, 'utf8').toString('hex');
  return { utf8String, hex };
}

const testCases = [
  'ðŸ›’',
  'ãƒ»',
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

testCases.forEach(str => {
  const { utf8String, hex } = decodeHex(str);
  console.log(`${JSON.stringify(str)} -> ${JSON.stringify(utf8String)} (hex: ${hex})`);
});