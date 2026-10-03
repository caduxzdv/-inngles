const fs = require('fs');
const path = require('path');
const { structuredClone } = require('util');

const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_DB = {
    version: 5,
    products: [],
    orders: [],
    coupons: [],
    payments: [],
    settings: {
        currency: 'BRL',
        storeName: 'CaduSallers',
        cartCategoryName: '🛒・carrinhos',
        // Efí configuration
        efi: {
            clientId: '',
            clientSecret: '',
            certificatePath: '',
            keyPath: '',
            pixKey: '',
            environment: 'homologacao' // homologacao or producao
        }
    }
};

function ensureDatabase() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(DEFAULT_DB, null, 2),
            'utf8'
        );
    }
}

function loadDatabase() {
    ensureDatabase();

    try {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

        return {
            ...DEFAULT_DB,
            ...parsed,
            version: 5,
            products: Array.isArray(parsed.products) ? parsed.products : [],
            orders: Array.isArray(parsed.orders) ? parsed.orders : [],
            coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
            payments: Array.isArray(parsed.payments) ? parsed.payments : [],
            settings: {
                ...DEFAULT_DB.settings,
                ...(parsed.settings || {})
            }
        };
    } catch (error) {
        console.error('⚠️ store.json inválido. Criando banco novo.', error);

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(DEFAULT_DB, null, 2),
            'utf8'
        );

        return structuredClone(DEFAULT_DB);
    }
}

function saveDatabase(db) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(db, null, 2),
        'utf8'
    );
}

function normalizeOrder(order) {
    // Ensure order has consistent structure
    const normalized = {
        ...order,
        id: order.id || makeId('PED'),
        userId: order.userId || '',
        productId: order.productId || (order.items && order.items[0] ? order.items[0].productId : ''),
        productName: order.productName || (order.items && order.items[0] ? order.items[0].name : ''),
        quantity: order.quantity || (order.items && order.items[0] ? order.items[0].quantity : 1),
        unitPrice: order.unitPrice || (order.items && order.items[0] ? order.items[0].unitPrice : 0),
        total: order.total || (order.items && order.items[0] ? order.items[0].unitPrice * (order.items && order.items[0].quantity || 1) : 0),
        status: order.status || 'Carrinho Aberto',
        payment: order.payment || 'Pendente',
        createdAt: order.createdAt || new Date().toISOString(),
        cartChannelId: order.cartChannelId || null,
        deliveredAt: order.deliveredAt || null,
        finalizedAt: order.finalizedAt || null,
        paymentId: order.paymentId || null,
        txid: order.txid || null,
        qrcode: order.qrcode || null,
        copiaCola: order.copiaCola || null,
        expirationDate: order.expirationDate || null
    };

    // Ensure items array exists for backward compatibility
    if (!normalized.items || !Array.isArray(normalized.items)) {
        normalized.items = [{
            productId: normalized.productId,
            name: normalized.productName,
            quantity: normalized.quantity,
            unitPrice: normalized.unitPrice
        }];
    }

    return normalized;
}

function makeId(prefix) {
    const random = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`;
}

module.exports = {
    loadDatabase,
    saveDatabase,
    normalizeOrder,
    makeId,
    DEFAULT_DB
};