const s = process.argv[2];
const latin1Bytes = Buffer.from(s, 'latin1');
const utf8String = latin1Bytes.toString('utf8');
console.log('Input:', s);
console.log('UTF-8 string:', utf8String);
console.log('Hex of UTF-8 string:', Buffer.from(utf8String, 'utf8').toString('hex'));
console.log('Expected hex for 🛒: f09f9b92');