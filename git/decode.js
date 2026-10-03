const s = process.argv[2];
const latin1Bytes = Buffer.from(s, 'latin1');
const utf8String = latin1Bytes.toString('utf8');
console.log(utf8String);