const fs = require('fs');

const filePath = 'index.js';
let content = fs.readFileSync(filePath, 'utf8');

// Replace the function productActions with the correct version
const correctFunction = "function productActions(productId) {\n    return new ActionRowBuilder().addComponents(\n        new ButtonBuilder()\n            .setCustomId(`buy:${productId}`)\n            .setLabel('Comprar')\n            .setEmoji('🛒')\n            .setStyle(ButtonStyle.Success)\n    );\n}";

// We'll replace from the start of the function to the end of the function.
// We'll use a regex to match the function.
const regex = /function productActions\(productId\) \{[\s\S]*?\}\s*/;
const newContent = content.replace(regex, correctFunction + '\n');

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Fixed function productActions');