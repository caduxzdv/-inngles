require('dotenv').config();
const axios = require('axios');
const express = require('express');

const fs = require('fs');
const path = require('path');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    PermissionFlagsBits,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error('âŒ DISCORD_TOKEN nÃ£o encontrado no .env');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ============================================================
// CaduSallers v4
// Fluxo principal:
// /setup -> painel pÃºblico -> Comprar -> canal privado do carrinho
// -> entrega manual -> botÃ£o Entregue -> contagem 10..0 -> apaga canal.
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const DEFAULT_DB = {
    version: 5, // Incremented version for payment system
    products: [],
    orders: [],
    coupons: [],
    payments: [], // New: Store EfÃ­ payment records
    tickets: [], // New: Support tickets system
    announcements: [], // New: System announcements
    settings: {
        currency: 'BRL',
        storeName: 'CaduSallers',
        cartCategoryName: '🛒・carrinhos',
        // EfÃ­ configuration
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
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

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

        // Create backup of current database before loading
        createBackup();

        return {
            ...DEFAULT_DB,
            ...parsed,
            version: 5,
            products: Array.isArray(parsed.products) ? parsed.products : [],
            orders: Array.isArray(parsed.orders) ? parsed.orders : [],
            coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
            payments: Array.isArray(parsed.payments) ? parsed.payments : [],
            tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
            announcements: Array.isArray(parsed.announcements) ? parsed.announcements : [],
            settings: {
                ...DEFAULT_DB.settings,
                ...(parsed.settings || {})
            }
        };
    } catch (error) {
        console.error('âš ï¸ store.json invÃ¡lido. Criando banco novo.', error);

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(DEFAULT_DB, null, 2),
            'utf8'
        );

        return structuredClone(DEFAULT_DB);
    }
}

// Create automatic backup of database
function createBackup() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(BACKUP_DIR, `store-backup-${timestamp}.json`);
            fs.copyFileSync(DATA_FILE, backupFile);

            // Keep only last 10 backups
            const backups = fs.readdirSync(BACKUP_DIR)
                .filter(file => file.startsWith('store-backup-') && file.endsWith('.json'))
                .sort()
                .reverse();

            for (let i = 10; i < backups.length; i++) {
                fs.unlinkSync(path.join(BACKUP_DIR, backups[i]));
            }
        }
    } catch (error) {
        console.error('âš ï¸ Failed to create backup:', error);
    }
}

let db = loadDatabase();

function saveDatabase() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(db, null, 2),
        'utf8'
    );
}

// ============================================================
// WEBHOOK SERVER FOR EFÃ CALLBACKS
// ============================================================

const app = express();
app.use(express.json());

// Webhook endpoint for EfÃ­ Pix notifications
app.post('/webhook/efi', async (req, res) => {
    try {
        console.log('🔔 Received Efí webhook:', req.body);

        // EfÃ­ webhook validation (basic)
        if (!req.body || !req.body.pix) {
            console.warn('âš ï¸ Invalid webhook payload');
            return res.status(400).send('Invalid payload');
        }

        const pixData = req.body.pix;
        const txid = pixData.txid;

        if (!txid) {
            console.warn('âš ï¸ No txid in webhook payload');
            return res.status(400).send('Missing txid');
        }

        // Find order by txid
        const order = db.orders.find(o => o.txid === txid);
        if (!order) {
            console.warn(`âš ï¸ No order found for txid: ${txid}`);
            return res.status(404).send('Order not found');
        }

        // Prevent duplicate processing using a simple in-memory cache
        // In production, you might want to use Redis or a database table
        const webhookId = `${txid}-${pixData.status}-${pixData.horario || Date.now()}`;
        if (global.processedWebhooks && global.processedWebhooks.has(webhookId)) {
            console.log(`â„¹ï¸ Duplicate webhook ignored for txid: ${txid}`);
            return res.status(200).send('OK');
        }

        // Initialize webhook cache if not exists
        if (!global.processedWebhooks) {
            global.processedWebhooks = new Set();
        }

        // Add to processed webhooks (keep only last 1000 to prevent memory growth)
        global.processedWebhooks.add(webhookId);
        if (global.processedWebhooks.size > 1000) {
            const arr = Array.from(global.processedWebhooks);
            global.processedWebhooks = new Set(arr.slice(-1000));
        }

        let statusChanged = false;

        // Update order based on webhook data
        if (pixData.status === 'CONCLUIDA' && order.payment !== 'Confirmado') {
            order.payment = 'Confirmado';
            order.status = 'Pago';
            statusChanged = true;
            console.log(`âœ… Payment confirmed for order ${order.id}`);
        } else if ((pixData.status === 'REMOVIDA_PELO_USUARIO_AGENTE' ||
                   pixData.status === 'REMOVIDA_PELO_USUARIO') &&
                   order.payment !== 'Cancelado') {
            order.payment = 'Cancelado';
            order.status = 'Cancelado';
            statusChanged = true;
            console.log(`âŒ Payment cancelled for order ${order.id}`);
        } else if (pixData.status === 'EXPIRADA' && order.payment !== 'Expirado') {
            order.payment = 'Expirado';
            order.status = 'Expirado';
            statusChanged = true;
            console.log(`â° Payment expired for order ${order.id}`);
        }

        if (statusChanged) {
            saveDatabase();

            // Send notification to order channel if it exists
            if (order.cartChannelId) {
                const channel = client.channels.cache.get(order.cartChannelId);
                if (channel && channel.isTextBased()) {
                    const statusMessage = pixData.status === 'CONCLUIDA'
                        ? 'âœ… Pagamento confirmado! Aguarde a entrega.'
                        : pixData.status === 'EXPIRADA'
                            ? 'â° Pagamento expirado. VocÃª pode criar um novo pedido.'
                            : 'âŒ Pagamento cancelado.';

                    channel.send({
                        content: `<@${order.userId}>`,
                        embeds: [
                            new EmbedBuilder()
                                .setColor(pixData.status === 'CONCLUIDA' ? SUCCESS : DANGER)
                                .setTitle('💰 Atualização de Pagamento')
                                .setDescription(statusMessage)
                                .setTimestamp()
                        ]
                    }).catch(console.error);
                }
            }
        }

        // Return success to EfÃ­
        return res.status(200).send('OK');
    } catch (error) {
        console.error('âŒ Error processing EfÃ­ webhook:', error);
        return res.status(500).send('Internal server error');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('CaduSallers bot is running');
});

// Start webhook server
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3000;
app.listen(WEBHOOK_PORT, () => {
    console.log(`🌐 Webhook server listening on port ${WEBHOOK_PORT}`);
});

const BRAND = 0x5865F2;
const SUCCESS = 0x57F287;
const WARNING = 0xFEE75C;
const DANGER = 0xED4245;
const DARK = 0x2B2D31;

const closingCarts = new Set();

function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

// Helper functions for status text and colors
function getStatusColor(paymentStatus, orderStatus) {
    if (orderStatus === 'Finalizado') return SUCCESS;
    if (orderStatus === 'Cancelado' || orderStatus === 'Expirado') return DANGER;
    if (paymentStatus === 'Confirmado') return SUCCESS;
    if (paymentStatus === 'Cancelado' || paymentStatus === 'Expirado') return DANGER;
    return BRAND;
}

function getPaymentStatusText(paymentStatus) {
    switch (paymentStatus) {
        case 'Confirmado': return 'âœ… Confirmado';
        case 'Cancelado': return 'âŒ Cancelado';
        case 'Expirado': return 'â° Expirado';
        default: return 'â³ Aguardando pagamento';
    }
}

function getDeliveryStatusText(orderStatus) {
    switch (orderStatus) {
        case 'Finalizado': return 'âœ… Entregue';
        case 'Pago': return '💳 Pago - aguardando entrega';
        case 'Cancelado': return 'âŒ Cancelado';
        case 'Expirado': return 'â° Expirado';
        default: return 'â³ Aguardando atendimento';
    }
}

function getCartInstructions(paymentStatus, orderStatus) {
    if (orderStatus === 'Finalizado') {
        return 'Produto entregue! O canal serÃ¡ fechado automaticamente.';
    }
    if (orderStatus === 'Cancelado' || orderStatus === 'Expirado') {
        return 'Pedido cancelado ou expirado. O canal serÃ¡ fechado em breve.';
    }
    if (paymentStatus === 'Confirmado') {
        return 'Aguarde o atendimento do vendedor para receber seu produto.';
    }
    return 'Aguarde o atendimento do vendedor neste canal. Depois que o produto for entregue, um administrador poderÃ¡ clicar em **Entregue**. ApÃ³s isso o canal farÃ¡ uma contagem de 10 segundos e serÃ¡ excluÃ­do automaticamente.';
}

function isAdmin(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
}

function makeId(prefix) {
    const random = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`;
}

/**
 * Check product stock status and return appropriate message
 * @param {Object} product - Product object
 * @returns {Object} Stock status with canPurchase boolean and message
 */
function checkProductStock(product) {
    const stock = Number(product.stock || 0);
    if (stock <= 0) {
        return {
            canPurchase: false,
            message: 'âŒ Esse produto estÃ¡ sem estoque.'
        };
    }

    if (stock < 3) {
        return {
            canPurchase: true,
            message: `âš ï¸ AtenÃ§Ã£o: apenas ${stock} unidade(s) em estoque!`
        };
    }

    return {
        canPurchase: true,
        message: ''
    };
}

function sanitizeChannelName(input) {
    return String(input || 'cliente')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'cliente';
}

// ============================================================
// EF\u00cd PAYMENT SERVICE
// ============================================================

class EfiService {
    constructor() {
        this.clientId = db.settings.efi.clientId;
        this.clientSecret = db.settings.efi.clientSecret;
        this.certificatePath = db.settings.efi.certificatePath;
        this.keyPath = db.settings.efi.keyPath;
        this.pixKey = db.settings.efi.pixKey;
        this.environment = db.settings.efi.environment || 'homologacao';

        // Ef\u00ed API endpoints
        this.baseUrl = this.environment === 'producao'
            ? 'https://api.efipay.com.br'
            : 'https://sandbox.efipay.com.br';
    }

    /**
     * Get access token from Ef\u00ed API
     */
    async getAccessToken() {
        try {
            const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

            const response = await axios.post(
                `${this.baseUrl}/oauth/token`,
                'grant_type=client_credentials',
                {
                    headers: {
                        'Authorization': `Basic ${auth}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            return response.data.access_token;
        } catch (error) {
            console.error('\u274c Ef\u00ed authentication error:', error.response?.data || error.message);
            throw new Error('Falha ao autenticar com a Ef\u00ed');
        }
    }

    /**
     * Create a Pix charge (cobran\u00e7a imediata)
     * @param {Object} chargeData - Charge information
     * @returns {Object} Created charge data
     */
    async createCharge(chargeData) {
        try {
            const accessToken = await this.getAccessToken();

            const response = await axios.post(
                `${this.baseUrl}/v2/cob`,
                chargeData,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('\u274c Ef\u00ed charge creation error:', error.response?.data || error.message);
            throw new Error('Falha ao criar cobran\u00e7a Pix');
        }
    }

    /**
     * Get charge details by txid
     * @param {string} txid - Transaction ID
     * @returns {Object} Charge details
     */
    async getCharge(txid) {
        try {
            const accessToken = await this.getAccessToken();

            const response = await axios.get(
                `${this.baseUrl}/v2/cob/${txid}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('\u274c Ef\u00ed get charge error:', error.response?.data || error.message);
            throw new Error('Falha ao consultar cobran\u00e7a');
        }
    }

    /**
     * Get Pix QR Code and copia e cola
     * @param {string} txid - Transaction ID
     * @returns {Object} QR Code and copia e cola data
     */
    async getPixQRCode(txid) {
        try {
            const accessToken = await this.getAccessToken();

            const response = await axios.get(
                `${this.baseUrl}/v2/cob/${txid}/qrcode`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('\u274c Ef\u00ed QR code error:', error.response?.data || error.message);
            throw new Error('Falha ao gerar QR Code Pix');
        }
    }

    /**
     * Cancel a charge (if possible)
     * @param {string} txid - Transaction ID
     * @returns {Object} Cancellation result
     */
    async cancelCharge(txid) {
        try {
            const accessToken = await this.getAccessToken();

            const response = await axios.delete(
                `${this.baseUrl}/v2/cob/${txid}`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error('\u274c Ef\u00ed cancel charge error:', error.response?.data || error.message);
            // Some charges cannot be cancelled (already paid, etc.)
            throw new Error('Falha ao cancelar cobran\u00e7a');
        }
    }
}

// Initialize Ef\u00ed service
const efiService = new EfiService();

function getProduct(productId) {
    return db.products.find(p => p.id === productId);
}

function totalStock() {
    return db.products.reduce(
        (sum, product) => sum + Number(product.stock || 0),
        0
    );
}

function paidRevenue() {
    return db.orders
        .filter(order => order.status === 'Finalizado')
        .reduce((sum, order) => sum + Number(order.total || 0), 0);
}

function getActiveOrderForUser(userId) {
    return db.orders.find(
        order =>
            order.userId === userId &&
            order.status === 'Carrinho Aberto'
    );
}

function getOrder(orderId) {
    return db.orders.find(order => order.id === orderId);
}

function productDetail(product) {
    // Determine stock status for visual indicator
    const stock = Number(product.stock || 0);
    let stockStatus = '🟢 Em estoque';
    if (stock === 0) {
        stockStatus = '🔴 Esgotado';
    } else if (stock < 3) {
        stockStatus = `🟡 Pouco em estoque (${stock})`;
    }

    return new EmbedBuilder()
        .setColor(product.stock > 0 ? BRAND : DANGER)
        .setAuthor({
            name: db.settings.storeName || 'CaduSallers',
            iconURL: client.user.displayAvatarURL()
        })
        .setTitle(`${product.emoji || '📦'} ${product.name}`)
        .setDescription(
            product.description || 'Sem descriÃ§Ã£o disponÃ­vel.'
        )
        .addFields(
            {
                name: '💰 Preço',
                value: money(product.price),
                inline: true
            },
            {
                name: '📦 Status do Estoque',
                value: stockStatus,
                inline: true
            },
            {
                name: '🗂️ Categoria',
                value: product.category || 'Geral',
                inline: true
            }
        )
        .addFields(
            {
                name: '📋 ID do Produto',
                value: `\`${product.id}\``,
                inline: true
            },
            {
                name: '📅 Adicionado em',
                value: `${new Date(product.createdAt).toLocaleDateString('pt-BR')} Ã s ${new Date(product.createdAt).toLocaleTimeString('pt-BR')}`,
                inline: true
            }
        )
        .setFooter({
            text: 'CaduSallers â€¢ Loja Oficial',
            iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp()
        .setThumbnail('https://cdn.discordapp.com/emojis/1070528071710826506.png'); // Package emoji (placeholder)
}

function productActions(productId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`buy:${productId}`)
            .setLabel('Comprar')
    return new ActionRowBuilder().addComponents(
            .setStyle(ButtonStyle.Success)
    );
}

function storeEmbed() {
    const products = db.products.filter(
        product => Number(product.stock || 0) > 0
    );

    return new EmbedBuilder()
        .setColor(BRAND)
        .setAuthor({
            name: db.settings.storeName || 'CaduSallers',
            iconURL: client.user.displayAvatarURL()
        })
        .setAuthor({
        .setDescription(
            products.length
                ? 'Bem-vindo Ã  nossa loja! Selecione um produto abaixo para ver os detalhes e realizar sua compra.\n\n' +
        .setTitle('🛍️ Loja CaduSallers')
        .setDescription(
        )
        .addFields(
            {
                : '🚫 A loja está temporariamente sem produtos disponíveis. Volte mais tarde ou entre em contato com o suporte.'
                value: String(products.length),
                inline: true
            },
            {
                value: String(products.length),
                value: String(totalStock()),
                inline: true
            },
            {
                value: String(totalStock()),
                value: db.settings.currency || 'BRL',
                inline: true
            }
        )
        .setFooter({
            text: 'CaduSallers â€¢ Atendimento personalizado via carrinho privado',
            iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp()
        .setThumbnail('https://cdn.discordapp.com/emojis/1070532790384754708.png'); // Shopping bag emoji (placeholder)
}

function productMenu() {
    const options = db.products
        .filter(product => Number(product.stock || 0) > 0)
        .slice(0, 25)
        .map(product => ({
            label: String(product.name).slice(0, 100),
            description:
                `${money(product.price)} â€¢ ${product.stock} em estoque`.slice(
                    0,
                    100
                ),
            value: product.id,
                    0,
        }));

    if (!options.length) {
        return null;
    }

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('product_select')

            .addOptions(options)
    );
}

function storeComponents() {
    const components = [];
    const menu = productMenu();

    if (menu) {
        components.push(menu);
    }

    components.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('store_refresh')
                .setLabel('Atualizar')
        new ActionRowBuilder().addComponents(
                .setStyle(ButtonStyle.Secondary)
        )
    );

    return components;
}

function panelEmbed() {
    const categories = new Set(
        db.products.map(product => product.category || 'Geral')
    );
    const paidOrders = db.orders.filter(order => order.status === 'Finalizado');
    const pendingPayments = db.orders.filter(order => order.payment === 'Pendente' && order.status === 'Pago');
    const canceledOrders = db.orders.filter(order => order.status === 'Cancelado' || order.status === 'Expirado');

    return new EmbedBuilder()
        .setColor(BRAND)
        .setAuthor({
            name: db.settings.storeName || 'CaduSallers',
            iconURL: client.user.displayAvatarURL()
        })
        .setAuthor({
        .setDescription(
            'Gerencie toda sua operaÃ§Ã£o de vendas pelo Discord de forma profissional e eficiente.\n\n' +
        })
            'â€¢ Gerenciamento completo de produtos e estoque\nâ€¢ Sistema de carrinhos privados com pagamento Pix\nâ€¢ Painel pÃºblico da loja com comando **/setup**\nâ€¢ Sistema de tickets para suporte ao cliente\nâ€¢ GestÃ£o de anÃºncios e cupons de desconto\nâ€¢ RelatÃ³rios de vendas e mÃ©tricas de desempenho'
        )
        .addFields(
            {
            '• Gerenciamento completo de produtos e estoque\n• Sistema de carrinhos privados com pagamento Pix\n• Painel público da loja com comando **/setup**\n• Sistema de tickets para suporte ao cliente\n• Gestão de anúncios e cupons de desconto\n• Relatórios de vendas e métricas de desempenho'
                value: String(db.products.length),
                inline: true
            },
            {
                value: String(db.products.length),
                value: String(totalStock()),
                inline: true
            },
            {
                value: String(totalStock()),
                value: String(categories.size),
                inline: true
            },
            {
                value: String(categories.size),
                value: money(paidRevenue()),
                inline: true
            },
            {
                value: money(paidRevenue()),
                value: String(
                    db.orders.filter(order => {
                        const today = new Date();
                        const orderDate = new Date(order.createdAt);
                        return orderDate.toDateString() === today.toDateString();
                    }).length
                ),
                inline: true
            },
            {
                name: 'âœ… Pedidos Finalizados',
                value: String(paidOrders.length),
                inline: true
            },
            {
                name: 'â³ Pagamentos Pendentes',
                value: String(pendingPayments.length),
                inline: true
            },
            {
                name: 'âŒ Pedidos Cancelados',
                value: String(canceledOrders.length),
                inline: true
            },
            {
                value: String(canceledOrders.length),
                value: String(
                    db.orders.filter(
                        order => order.status === 'Carrinho Aberto'
                    ).length
                ),
                inline: true
            },
            {
                ),
                value: String(
                    db.tickets.filter(
                        ticket => ticket.status === 'Aberto'
                    ).length
                ),
                inline: true
            },
            {
                ),
                value: String(
                    db.announcements.filter(a => a.active).length
                ),
                inline: true
            }
        )
        .setFooter({
            text: 'CaduSallers â€¢ Sistema de Vendas Profissional para Discord',
            iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp()
        .setThumbnail('https://cdn.discordapp.com/emojis/1070525961842884708.png'); // Chart emoji (placeholder)
}

function panelComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('panel_section')
                .setPlaceholder('Selecione um mÃ³dulo')
                .addOptions(
                    {
                        label: 'Loja',
                        description: 'Ver produtos',
                        value: 'store',
                    {
                    },
                    {
                        label: 'Carrinhos',
                        description: 'Pedidos em atendimento',
                        value: 'carts',
                    {
                    },
                    {
                        label: 'Compras',
                        description: 'HistÃ³rico de pedidos',
                        value: 'purchases',
                    {
                    },
                    {
                        label: 'Ferramentas',
                        description: 'Produtos e estoque',
                        value: 'tools',
                    {
                    },
                    {
                        label: 'MÃ©tricas',
                        description: 'Indicadores da loja',
                        value: 'metrics',
                    {
                    },
                    {
                        label: 'Tiketes',
                        description: 'Sistema de atendimento',
                        value: 'tickets',
                    {
                    },
                    {
                        label: 'AnÃºncios',
                        description: 'ComunicaÃ§Ãµes da loja',
                        value: 'announcements',
                    {
                    },
                    {
                        label: 'ConfiguraÃ§Ãµes',
                        description: 'ConfiguraÃ§Ãµes da loja',
                        value: 'settings',
                    {
                    }
                )
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('panel_refresh')
                .setLabel('Atualizar')
        new ActionRowBuilder().addComponents(
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_close')
                .setLabel('Fechar')
                .setEmoji('âœ–ï¸')
                .setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildNewProductModal() {
    return new ModalBuilder()
        .setCustomId('new_product_modal')
        .setTitle('Criar produto')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('product_name')
                    .setLabel('Nome')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(80)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('product_price')
                    .setLabel('PreÃ§o (ex.: 19.90)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('product_stock')
                    .setLabel('Estoque inicial')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('product_category')
                    .setLabel('Categoria')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('product_description')
                    .setLabel('DescriÃ§Ã£o')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(700)
            )
        );
}

function createOrder(userId, product) {
    const order = {
        id: makeId('PED'),
        userId,
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: Number(product.price),
        total: Number(product.price),
        status: 'Carrinho Aberto',
        payment: 'Pendente',
        createdAt: new Date().toISOString(),
        cartChannelId: null,
        deliveredAt: null,
        finalizedAt: null,
        paymentId: null,
        txid: null,
        qrcode: null,
        copiaCola: null,
        expirationDate: null
    };

    db.orders.push(order);
    saveDatabase();

    return order;
}

async function getOrCreateCartCategory(guild) {
    let category = guild.channels.cache.find(
        channel =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === db.settings.cartCategoryName
    );

    if (category) {
        return category;
    }

    category = await guild.channels.create({
        name: db.settings.cartCategoryName,
        type: ChannelType.GuildCategory,
        reason: 'Categoria de carrinhos do CaduSallers'
    });

    return category;
}

function getAdministratorRoleOverwrites(guild) {
    const overwrites = [];

    const adminRoles = guild.roles.cache.filter(
        role =>
            role.id !== guild.id &&
            role.permissions.has(PermissionFlagsBits.Administrator)
    );

    for (const role of adminRoles.values()) {
        overwrites.push({
            id: role.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        });
    }

    return overwrites;
}

async function createCartChannel(interaction, product) {
    const existing = getActiveOrderForUser(interaction.user.id);

    if (existing) {
        const existingChannel = interaction.guild.channels.cache.get(
            existing.cartChannelId
        );

        if (existingChannel) {
            return {
                existing: true,
                order: existing,
                channel: existingChannel
            };
        }

        existing.status = 'Cancelado';
        saveDatabase();
    }

    const stockCheck = checkProductStock(product);
    if (!stockCheck.canPurchase) {
        throw new Error(stockCheck.message);
    }

    const category = await getOrCreateCartCategory(interaction.guild);
    const order = createOrder(interaction.user.id, product);

    // Generate EfÃ­ Pix charge
    try {
        const chargeData = {
            calendario: {
                expiracao: 1800 // 30 minutes
            },
            valor: {
                original: order.total.toString()
            },
            chave: db.settings.efi.pixKey,
            solicitacaoPagador: `Pedido ${order.id} - ${product.name}`
        };

        const chargeResponse = await efiService.createCharge(chargeData);

        // Update order with payment information
        order.paymentId = chargeResponse.txid;
        order.txid = chargeResponse.txid;
        if (chargeResponse.qrcode && chargeResponse.qrcode.imagemQrcode) {
            order.qrcode = chargeResponse.qrcode.imagemQrcode;
        }
        if (chargeResponse.qrcode && chargeResponse.qrcode.qrcode) {
            order.copiaCola = chargeResponse.qrcode.qrcode;
        }
        order.expirationDate = new Date(Date.now() + 1800 * 1000).toISOString(); // 30 minutes from now

        saveDatabase();
    } catch (error) {
        console.error('âŒ Failed to create EfÃ­ charge:', error);
        // Continue with order creation even if payment fails initially
        // User can retry payment later
    }

    const userPart = sanitizeChannelName(
        interaction.member?.displayName || interaction.user.username
    );

    const userPart = sanitizeChannelName(
        .toString(36)
        .slice(-5)}`.slice(0, 95);

    const everyoneRole = interaction.guild.roles.everyone;

    const permissionOverwrites = [
        {
            id: everyoneRole.id,
            deny: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },
        {
            id: interaction.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        },
        ...getAdministratorRoleOverwrites(interaction.guild),
        {
            id: client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.EmbedLinks
            ]
        }
    ];

    const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites,
        topic: `Pedido ${order.id} â€¢ ${interaction.user.id}`,
        reason: `Carrinho criado para ${interaction.user.tag}`
    });

    order.cartChannelId = channel.id;
    saveDatabase();

    const cartEmbed = new EmbedBuilder()
        .setColor(BRAND)
    saveDatabase();
        .setDescription(
            `OlÃ¡ <@${interaction.user.id}>!\n\n` +
            `Seu pedido foi aberto neste canal privado.\n\n` +
            `**Produto:** ${product.name}\n` +
            `**Quantidade:** 1\n` +
            `**Valor:** ${money(product.price)}\n` +
            `**Pedido:** \`${order.id}\`\n\n` +
            `**Produto:** ${product.name}\n` +
            `**Quantidade:** 1\n` +
        )
        .addFields({
            `💳 **Pagamento:** ${order.payment}\n` +
            value:
                'Aguarde o atendimento do vendedor neste canal. ' +
                'Depois que o produto for entregue, um administrador poderÃ¡ clicar em **Entregue**. ' +
                'ApÃ³s isso o canal farÃ¡ uma contagem de 10 segundos e serÃ¡ excluÃ­do automaticamente.'
        })
        .setFooter({
            text: 'CaduSallers â€¢ Carrinho privado'
        })
        .setTimestamp();

    // Add payment verification button if we have a txid
    const actionComponents = [
        new ButtonBuilder()
            .setCustomId(`cancel_cart:${order.id}`)
            .setLabel('Cancelar')
            .setEmoji('âŒ')
            .setStyle(ButtonStyle.Danger)
    ];

    if (order.txid) {
        actionComponents.push(
            new ButtonBuilder()
                .setCustomId(`verify_payment:${order.id}`)
                .setLabel('Verificar pagamento')
        actionComponents.push(
                .setStyle(ButtonStyle.Primary)
        );

        actionComponents.push(
            new ButtonBuilder()
                .setCustomId(`copy_pix:${order.id}`)
                .setLabel('Copiar Pix')
        actionComponents.push(
                .setStyle(ButtonStyle.Secondary)
        );
    }

    const actions = new ActionRowBuilder().addComponents(actionComponents);

    await channel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [cartEmbed],
        components: [actions]
    });

    return {
        existing: false,
        order,
        channel
    };
}

async function finalizeCart(interaction, order) {
    if (!isAdmin(interaction)) {
        await interaction.reply({
            content: 'âŒ Somente administradores podem marcar o pedido como entregue.',
            ephemeral: true
        });
        return;
    }

    if (closingCarts.has(order.id)) {
        return;
    }

    // Check if payment is confirmed
    if (order.payment !== 'Confirmado') {
        await interaction.reply({
            content: 'âŒ O pagamento precisa ser confirmado antes de marcar o pedido como entregue.',
            ephemeral: true
        });
        return;
    }

    if (order.status !== 'Carrinho Aberto' && order.status !== 'Pago') {
        await interaction.reply({
            content: `â„¹ï¸ Esse pedido jÃ¡ estÃ¡ com status **${order.status}**.`,
            ephemeral: true
        });
        return;
    }

    closingCarts.add(order.id);

    order.status = 'Finalizado';
    order.deliveredAt = new Date().toISOString();
    order.finalizedAt = new Date().toISOString();

    // Baixar estoque quando a entrega Ã© concluÃ­da
    const product = getProduct(order.productId);
    if (product) {
        product.stock = Math.max(
            0,
            Number(product.stock || 0) - Number(order.quantity || 1)
        );

        // For digital products with delivery items, mark items as delivered
        if (product.deliveryItems && product.deliveryItems.length > 0) {
            // In a real implementation, we would track which specific items were delivered
            // For now, we'll just note that delivery occurred
            // We could implement a simple FIFO system for digital items
            const deliveredItems = product.deliveryItems.slice(0, order.quantity);
            // In a full implementation, we would mark these as delivered
            // For now, we just reduce the stock count
        }
    }

    saveDatabase();

    // Notify customer about delivery
    try {
        const channel = interaction.channel;
        if (channel && channel.isTextBased()) {
            channel.send({
                content: `<@${order.userId}>`,
                embeds: [
                    new EmbedBuilder()
                        .setColor(SUCCESS)
                content: `<@${order.userId}>`,
                        .setDescription(
                            `Seu pedido \`${order.id}\` foi marcado como **ENTREGUE** pelo nosso staff.\n\n` +
                            `O produto/serviÃ§o estÃ¡ disponÃ­vel para vocÃª.\n\n` +
                            `Este canal serÃ¡ excluÃ­do automaticamente em 10 segundos.`
                        )
                        .setTimestamp()
                ]
            }).catch(console.error);
        }
    } catch (error) {
        console.error('âš ï¸ Failed to send delivery notification:', error);
    }

    const seconds = 10;

    const countdownEmbed = () =>
        new EmbedBuilder()
            .setColor(SUCCESS)
            .setTitle('âœ… Pedido entregue')
            .setDescription(
                `O pedido \`${order.id}\` foi marcado como **ENTREGUE**.\n\n` +
            .setColor(SUCCESS)
            )
            .addFields(
                {
                `🗑️ Este canal será apagado em **CONTAGEM** segundos.`
                    value: order.productName,
                    inline: true
                },
                {
                    value: order.productName,
                    value: money(order.total),
                    inline: true
                }
            )
            .setFooter({
                text: 'Obrigado pela compra!'
            });

    const message = interaction.message;

    try {
        await interaction.update({
            embeds: [countdownEmbed().setDescription(
                `O pedido \`${order.id}\` foi marcado como **ENTREGUE**.\n\n` +
    try {
            )],
            components: []
        });

        for (let remaining = seconds - 1; remaining >= 0; remaining--) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const channel = interaction.channel;

            if (!channel || !channel.isTextBased()) {
                break;
            }

            if (remaining === 0) {
                await channel.delete(
                    `Pedido ${order.id} finalizado apÃ³s entrega`
                );
                break;
            }

            await message.edit({
                embeds: [
                    countdownEmbed().setDescription(
                        `O pedido \`${order.id}\` foi marcado como **ENTREGUE**.\n\n` +
            await message.edit({
                    )
                ],
                components: []
            });
        }
    } catch (error) {
        console.error('âŒ Erro na finalizaÃ§Ã£o do carrinho:', error);
    } finally {
        closingCarts.delete(order.id);
    }
}

async function cancelCart(interaction, order) {
    if (!isAdmin(interaction) && interaction.user.id !== order.userId) {
        await interaction.reply({
            content: 'âŒ VocÃª nÃ£o pode cancelar este carrinho.',
            ephemeral: true
        });
        return;
    }

    if (closingCarts.has(order.id)) {
        return;
    }

    closingCarts.add(order.id);

    order.status = 'Cancelado';
    saveDatabase();

    // Notify customer about cancellation
    try {
        const channel = interaction.channel;
        if (channel && channel.isTextBased()) {
            channel.send({
                content: `<@${order.userId}>`,
                embeds: [
                    new EmbedBuilder()
                        .setColor(DANGER)
                content: `<@${order.userId}>`,
                        .setDescription(
                            `Seu pedido \`${order.id}\` foi cancelado.\n\n` +
                            `Este canal serÃ¡ excluÃ­do automaticamente em 3 segundos.`
                        )
                        .setTimestamp()
                ]
            }).catch(console.error);
        }
    } catch (error) {
        console.error('âš ï¸ Failed to send cancellation notification:', error);
    }

    try {
        await interaction.reply({
            content: 'âŒ Carrinho cancelado. Este canal serÃ¡ apagado em 3 segundos.'
        });

        await new Promise(resolve => setTimeout(resolve, 3000));

        if (interaction.channel) {
            await interaction.channel.delete(
                `Carrinho ${order.id} cancelado`
            );
        }
    } catch (error) {
        console.error('âŒ Erro cancelando carrinho:', error);
    } finally {
        closingCarts.delete(order.id);
    }
}

// ============================================================
// COMANDOS
// ============================================================

const manageProduct = new SlashCommandBuilder()
    .setName('manage_product')
    .setDescription('Gerencia produtos')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub
            .setName('listar')
            .setDescription('Lista os produtos')
    )
    .addSubcommand(sub =>
        sub
            .setName('remover')
            .setDescription('Remove um produto')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do produto')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub
            .setName('preco')
            .setDescription('Altera o preÃ§o')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do produto')
                    .setRequired(true)
            )
            .addNumberOption(o =>
                o
                    .setName('valor')
                    .setDescription('Novo preÃ§o')
                    .setRequired(true)
                    .setMinValue(0)
            )
    );

const manageStock = new SlashCommandBuilder()
    .setName('manage_stock')
    .setDescription('Gerencia estoque')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
        o
            .setName('id')
            .setDescription('ID do produto')
            .setRequired(true)
    )
    .addStringOption(o =>
        o
            .setName('operacao')
            .setDescription('OperaÃ§Ã£o')
            .setRequired(true)
            .addChoices(
                { name: 'Adicionar', value: 'add' },
                { name: 'Remover', value: 'remove' },
                { name: 'Definir', value: 'set' }
            )
    )
    .addIntegerOption(o =>
        o
            .setName('quantidade')
            .setDescription('Quantidade')
            .setRequired(true)
            .setMinValue(0)
    );

const manageItem = new SlashCommandBuilder()
    .setName('manage_item')
    .setDescription('Gerencia itens digitais')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub
            .setName('adicionar')
            .setDescription('Adiciona um item de entrega')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do produto')
                    .setRequired(true)
            )
            .addStringOption(o =>
                o
                    .setName('conteudo')
                    .setDescription('ConteÃºdo da entrega')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub
            .setName('quantidade')
            .setDescription('Mostra itens disponÃ­veis')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do produto')
                    .setRequired(true)
            )
    );

const manageTicket = new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Sistema de tickets de suporte')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub
            .setName('listar')
            .setDescription('Lista os tickets')
    )
    .addSubcommand(sub =>
        sub
            .setName('fechar')
            .setDescription('Fecha um ticket')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do ticket')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub
            .setName('responder')
            .setDescription('Responde um ticket')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do ticket')
                    .setRequired(true)
            )
            .addStringOption(o =>
                o
                    .setName('resposta')
                    .setDescription('Resposta para o ticket')
                    .setRequired(true)
            )
    );

const manageAnnouncement = new SlashCommandBuilder()
    .setName('anuncio')
    .setDescription('Gerencia anÃºncios da loja')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub
            .setName('criar')
            .setDescription('Cria um novo anÃºncio')
            .addStringOption(o =>
                o
                    .setName('titulo')
                    .setDescription('TÃ­tulo do anÃºncio')
                    .setRequired(true)
            )
            .addStringOption(o =>
                o
                    .setName('conteudo')
                    .setDescription('ConteÃºdo do anÃºncio')
                    .setRequired(true)
            )
            .addBooleanOption(o =>
                o
                    .setName('ativo')
                    .setDescription('AnÃºncio ativo')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub
            .setName('listar')
            .setDescription('Lista os anÃºncios')
    )
    .addSubcommand(sub =>
        sub
            .setName('ativar')
            .setDescription('Ativa/desativa um anÃºncio')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do anÃºncio')
                    .setRequired(true)
            )
            .addBooleanOption(o =>
                o
                    .setName('ativo')
                    .setDescription('Status do anÃºncio')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub
            .setName('remover')
            .setDescription('Remove um anÃºncio')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do anÃºncio')
                    .setRequired(true)
            )
    );

const commands = [
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Abre o painel administrativo'),

    new SlashCommandBuilder()
        .setName('loja')
        .setDescription('Abre o painel pÃºblico da loja'),

    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Publica o painel da loja no canal atual')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('criar_produto')
        .setDescription('Cria um produto')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    manageProduct,
    manageStock,
    manageItem,
    manageTicket,
    manageAnnouncement,

    new SlashCommandBuilder()
        .setName('postproduto')
        .setDescription('Publica um produto individual')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o =>
            o
                .setName('id')
                .setDescription('ID do produto')
                .setRequired(true)
        )
        .addChannelOption(o =>
            o
                .setName('canal')
                .setDescription('Canal')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    // User-facing ticket creation command
    new SlashCommandBuilder()
        .setName('criar_ticket')
        .setDescription('Cria um ticket de suporte')
        .addStringOption(o =>
            o
                .setName('titulo')
                .setDescription('TÃ­tulo do ticket')
                .setRequired(true)
        )
        .addStringOption(o =>
            o
                .setName('descricao')
                .setDescription('DescriÃ§Ã£o do problema')
                .setRequired(true)
        )
];

// ============================================================
// INTERAÃ‡Ã•ES
// ============================================================

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const name = interaction.commandName;

            if (name === 'panel') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Apenas administradores.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.reply({
                    embeds: [panelEmbed()],
                    components: panelComponents()
                });

                return;
            }

            if (name === 'loja') {
                await interaction.reply({
                    embeds: [storeEmbed()],
                    components: storeComponents()
                });

                return;
            }

            if (name === 'setup') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Apenas administradores.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.channel.send({
                    embeds: [storeEmbed()],
                    components: storeComponents()
                });

                await interaction.reply({
                    content:
                        'âœ… Painel da loja publicado neste canal.',
                    ephemeral: true
                });

                return;
            }

            if (name === 'criar_produto') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Apenas administradores.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.showModal(buildNewProductModal());
                return;
            }

            if (name === 'manage_product') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Sem permissÃ£o.',
                        ephemeral: true
                    });
                    return;
                }

                const sub = interaction.options.getSubcommand();

                if (sub === 'listar') {
                    const text = db.products.length
                        ? db.products
                              .map(
                                  product =>
                                      `**${product.name}** â€” \`${product.id}\` â€” ${money(product.price)} â€” estoque ${product.stock}`
                              )
                              .join('\n')
                        : 'Nenhum produto cadastrado.';

                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                    await interaction.reply({
                                .setDescription(text.slice(0, 3900))
                        ],
                        ephemeral: true
                    });
                    return;
                }

                const id = interaction.options.getString('id', true);
                const product = getProduct(id);

                if (!product) {
                    await interaction.reply({
                        content: 'âŒ Produto nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                if (sub === 'remover') {
                    db.products = db.products.filter(
                        item => item.id !== product.id
                    );
                    saveDatabase();

                    await interaction.reply({
                        content: `âœ… Produto **${product.name}** removido.`,
                        ephemeral: true
                    });
                    return;
                }

                if (sub === 'preco') {
                    const valor = interaction.options.getNumber(
                        'valor',
                        true
                    );

                    product.price = Number(valor.toFixed(2));
                    saveDatabase();

                    await interaction.reply({
                        content:
                            `âœ… PreÃ§o de **${product.name}** atualizado para **${money(product.price)}**.`,
                        ephemeral: true
                    });
                    return;
                }
            }

            if (name === 'manage_stock') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Sem permissÃ£o.',
                        ephemeral: true
                    });
                    return;
                }

                const id = interaction.options.getString('id', true);
                const operation = interaction.options.getString(
                    'operacao',
                    true
                );
                const quantity = interaction.options.getInteger(
                    'quantidade',
                    true
                );

                const product = getProduct(id);

                if (!product) {
                    await interaction.reply({
                        content: 'âŒ Produto nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                if (operation === 'add') {
                    product.stock += quantity;
                }

                if (operation === 'remove') {
                    product.stock = Math.max(
                        0,
                        product.stock - quantity
                    );
                }

                if (operation === 'set') {
                    product.stock = quantity;
                }

                saveDatabase();

                await interaction.reply({
                    content:
                        `âœ… Estoque de **${product.name}**: **${product.stock}**.`,
                    ephemeral: true
                });

                return;
            }

            if (name === 'manage_item') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Sem permissÃ£o.',
                        ephemeral: true
                    });
                    return;
                }

                const id = interaction.options.getString(
                    'id',
                    true
                );

                const product = getProduct(id);

                if (!product) {
                    await interaction.reply({
                        content: 'âŒ Produto nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                product.deliveryItems = Array.isArray(
                    product.deliveryItems
                )
                    ? product.deliveryItems
                    : [];

                const sub = interaction.options.getSubcommand();

                if (sub === 'adicionar') {
                    const content =
                        interaction.options.getString(
                            'conteudo',
                            true
                        );

                    product.deliveryItems.push(content);
                    product.stock = product.deliveryItems.length;

                    saveDatabase();

                    await interaction.reply({
                        content:
                            `âœ… Item adicionado a **${product.name}**.\n` +

                        ephemeral: true
                    });

                    return;
                }

                if (sub === 'quantidade') {
                    await interaction.reply({
                        content:

                        ephemeral: true
                    });

                    return;
                }
            }

            if (name === 'ticket') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Sem permissÃ£o.',
                        ephemeral: true
                    });
                    return;
                }

                const sub = interaction.options.getSubcommand();

                if (sub === 'listar') {
                    const tickets = db.tickets;
                    const text = tickets.length
                        ? tickets
                              .map(
                                  ticket =>
                                      `**${ticket.id}** â€” ${ticket.title} â€” ${ticket.status} â€” <@${ticket.userId}> â€” <t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>`
                              )
                              .join('\n')
                        : 'Nenhum ticket cadastrado.';

                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                    await interaction.reply({
                                .setDescription(text.slice(0, 3900))
                        ],
                        ephemeral: true
                    });
                    return;
                }

                const id = interaction.options.getString('id', true);
                const ticket = db.tickets.find(t => t.id === id);

                if (!ticket) {
                    await interaction.reply({
                        content: 'âŒ Ticket nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                if (sub === 'fechar') {
                    ticket.status = 'Fechado';
                    ticket.closedAt = new Date().toISOString();
                    saveDatabase();

                    await interaction.reply({
                        content: `âœ… Ticket **${ticket.id}** fechado.`,
                        ephemeral: true
                    });
                    return;
                }

                if (sub === 'responder') {
                    const resposta = interaction.options.getString('resposta', true);

                    // In a real implementation, you would send this response to the user
                    // For now, we'll just store it in the ticket
                    if (!ticket.responses) ticket.responses = [];
                    ticket.responses.push({
                        adminId: interaction.user.id,
                        message: resposta,
                        timestamp: new Date().toISOString()
                    });
                    saveDatabase();

                    await interaction.reply({
                        content: `âœ… Resposta enviada para o ticket **${ticket.id}**.`,
                        ephemeral: true
                    });
                    return;
                }
            }

            if (name === 'anuncio') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Sem permissÃ£o.',
                        ephemeral: true
                    });
                    return;
                }

                const sub = interaction.options.getSubcommand();

                if (sub === 'criar') {
                    const titulo = interaction.options.getString('titulo', true);
                    const conteudo = interaction.options.getString('conteudo', true);
                    const ativo = interaction.options.getBoolean('ativo', true);

                    const announcement = {
                        id: makeId('ANC'),
                        titulo,
                        conteudo,
                        active: ativo,
                        createdAt: new Date().toISOString(),
                        createdBy: interaction.user.id
                    };

                    db.announcements.push(announcement);
                    saveDatabase();

                    await interaction.reply({
                        content: `âœ… AnÃºncio **${announcement.id}** criado.`,
                        ephemeral: true
                    });
                    return;
                }

                if (sub === 'listar') {
                    const announcements = db.announcements;
                    const text = announcements.length
                        ? announcements
                              .map(
                                  ann =>
                                      `**${ann.id}** â€” ${ann.titulo} â€” ${ann.active ? 'âœ… Ativo' : 'âŒ Inativo'} â€” <t:${Math.floor(new Date(ann.createdAt).getTime() / 1000)}:R>`
                              )
                              .join('\n')
                        : 'Nenhum anÃºncio cadastrado.';

                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                    await interaction.reply({
                                .setDescription(text.slice(0, 3900))
                        ],
                        ephemeral: true
                    });
                    return;
                }

                if (sub === 'ativar') {
                    const id = interaction.options.getString('id', true);
                    const ativo = interaction.options.getBoolean('ativo', true);

                    const announcement = db.announcements.find(a => a.id === id);
                    if (!announcement) {
                        await interaction.reply({
                            content: 'âŒ AnÃºncio nÃ£o encontrado.',
                            ephemeral: true
                        });
                        return;
                    }

                    announcement.active = ativo;
                    saveDatabase();

                    await interaction.reply({
                        content: `âœ… AnÃºncio **${announcement.id}** ${ativo ? 'ativado' : 'desativado'}.`,
                        ephemeral: true
                    });
                    return;
                }

                if (sub === 'remover') {
                    const id = interaction.options.getString('id', true);
                    const announcement = db.announcements.find(a => a.id === id);
                    if (!announcement) {
                        await interaction.reply({
                            content: 'âŒ AnÃºncio nÃ£o encontrado.',
                            ephemeral: true
                        });
                        return;
                    }

                    db.announcements = db.announcements.filter(a => a.id !== id);
                    saveDatabase();

                    await interaction.reply({
                        content: `âœ… AnÃºncio **${announcement.id}** removido.`,
                        ephemeral: true
                    });
                    return;
                }
            }

            if (name === 'postproduto') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Sem permissÃ£o.',
                        ephemeral: true
                    });
                    return;
                }

                const product = getProduct(
                    interaction.options.getString('id', true)
                );

                const channel = interaction.options.getChannel(
                    'canal',
                    true
                );

                if (!product) {
                    await interaction.reply({
                        content: 'âŒ Produto nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                await channel.send({
                    embeds: [productDetail(product)],
                    components: [productActions(product.id)]
                });

                await interaction.reply({
                    content:
                        `âœ… **${product.name}** publicado em ${channel}.`,
                    ephemeral: true
                });

                return;
            }

            if (name === 'criar_ticket') {
                const titulo = interaction.options.getString('titulo', true);
                const descricao = interaction.options.getString('descricao', true);

                const ticket = {
                    id: makeId('TKT'),
                    userId: interaction.user.id,
                    username: interaction.user.username,
                    titulo,
                    descricao,
                    status: 'Aberto',
                    createdAt: new Date().toISOString(),
                    responses: []
                };

                db.tickets.push(ticket);
                saveDatabase();

                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(SUCCESS)
                            .setTitle('âœ… Ticket Criado')
                            .setDescription(`Seu ticket foi criado com sucesso.`)
                            .addFields(
                                {
                            .setTitle('✅ Ticket Criado')
                                    value: ticket.id,
                                    inline: true
                                },
                                {
                                    value: ticket.id,
                                    value: ticket.titulo,
                                    inline: true
                                },
                                {
                                    value: ticket.titulo,
                                    value: `<@${ticket.userId}>`,
                                    inline: true
                                },
                                {
                                    value: `<@${ticket.userId}>`,
                                    value: ticket.status,
                                    inline: true
                                }
                            )
                            .setFooter({
                                text: 'Uma equipe de suporte atenderÃ¡ em breve.'
                            })
                    ],
                    ephemeral: true
                });

                return;
            }
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'product_select') {
                const product = getProduct(
                    interaction.values[0]
                );

                if (!product) {
                    await interaction.reply({
                        content: 'âŒ Produto nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.update({
                    embeds: [productDetail(product)],
                    components: [
                        productActions(product.id),
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('back_store')
                                .setLabel('Voltar Ã  loja')
                                .setEmoji('â†©ï¸')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ]
                });

                return;
            }

            if (interaction.customId === 'panel_section') {
                const section = interaction.values[0];

                if (section === 'store') {
                    await interaction.update({
                        embeds: [storeEmbed()],
                        components: storeComponents()
                    });
                    return;
                }

                if (section === 'carts') {
                    const active = db.orders.filter(
                        order => order.status === 'Carrinho Aberto'
                    );

                    const text = active.length
                        ? active
                              .map(
                                  order =>

                              )
                              .join('\n')
                        : 'Nenhum carrinho aberto.';

                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)

                                .setDescription(text.slice(0, 3900))
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('â†©ï¸')
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            )
                        ]
                    });

                    return;
                }

                if (section === 'purchases') {
                    const orders = db.orders.filter(
                        order =>
                            order.userId ===
                            interaction.user.id
                    );

                    const text = orders.length
                        ? orders
                              .slice(-15)
                              .reverse()
                              .map(
                                  order =>
                                      `**${order.id}** â€” ${order.productName} â€” ${money(order.total)} â€” ${order.status}`
                              )
                              .join('\n')
                        : 'VocÃª ainda nÃ£o possui pedidos.';

                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)

                                .setDescription(text.slice(0, 3900))
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('â†©ï¸')
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            )
                        ]
                    });

                    return;
                }

                if (section === 'tools') {
                    if (!isAdmin(interaction)) {
                        await interaction.reply({
                            content: 'âŒ Sem permissÃ£o.',
                            ephemeral: true
                        });
                        return;
                    }

                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)

                                .setDescription(
                                    'Use os comandos administrativos para gerenciar sua loja.'
                                )
                                .addFields(
                                    {
                                .setDescription(
                                        value:
                                            '`/criar_produto` e `/manage_product`'
                                    },
                                    {
                                        name: '📦 Produtos',
                                        value: '`/manage_stock`'
                                    },
                                    {
                                    {
                                        value: '`/manage_item`'
                                    },
                                    {
                                    {
                                        value: '`/postproduto` ou `/setup`'
                                    }
                                )
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('â†©ï¸')
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            )
                        ]
                    });

                    return;
                }

                if (section === 'metrics') {
                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                if (section === 'metrics') {
                                .addFields(
                                    {
                                        name: 'Produtos',
                                        value: String(
                                            db.products.length
                                        ),
                                        inline: true
                                    },
                                    {
                                        name: 'Estoque',
                                        value: String(totalStock()),
                                        inline: true
                                    },
                                    {
                                        name: 'Pedidos',
                                        value: String(
                                            db.orders.length
                                        ),
                                        inline: true
                                    },
                                    {
                                        name: 'Carrinhos',
                                        value: String(
                                            db.orders.filter(
                                                order =>
                                                    order.status ===
                                                    'Carrinho Aberto'
                                            ).length
                                        ),
                                        inline: true
                                    },
                                    {
                                        name: 'Finalizados',
                                        value: String(
                                            db.orders.filter(
                                                order =>
                                                    order.status ===
                                                    'Finalizado'
                                            ).length
                                        ),
                                        inline: true
                                    },
                                    {
                                        name: 'Faturamento',
                                        value: money(paidRevenue()),
                                        inline: true
                                    }
                                )
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('â†©ï¸')
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            )
                        ]
                    });

                    return;
                }

                if (section === 'settings') {
                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                                .setTitle('âš™ï¸ ConfiguraÃ§Ãµes')
                                .setDescription(
                                    `Nome da loja: **${db.settings.storeName}**\n` +
                                    `Categoria dos carrinhos: **${db.settings.cartCategoryName}**\n\n` +
                                    'Nesta etapa o fluxo de carrinho jÃ¡ estÃ¡ ativo.'
                                )
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('â†©ï¸')
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            )
                        ]
                    });

                    return;
                }

                if (section === 'tickets') {
                    if (!isAdmin(interaction)) {
                        await interaction.reply({
                            content: 'âŒ Sem permissÃ£o.',
                            ephemeral: true
                        });
                        return;
                    }

                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)

                                .setDescription(
                                    'Gerencie os tickets de suporte da sua loja.\n\n' +
                                    'Use os comandos apropriados para criar e gerenciar tickets.'
                                )
                                .addFields(
                                    {
                                    'Gerencie os tickets de suporte da sua loja.\n\n' +
                                        value: String(
                                            db.tickets.filter(
                                                ticket => ticket.status === 'Aberto'
                                            ).length
                                        ),
                                        inline: true
                                    },
                                    {
                                            ).length
                                        value: String(
                                            db.tickets.filter(
                                                ticket => ticket.status === 'Fechado'
                                            ).length
                                        ),
                                        inline: true
                                    }
                                )
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('â†©ï¸')
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            )
                        ]
                    });

                    return;
                }

                if (section === 'announcements') {
                    if (!isAdmin(interaction)) {
                        await interaction.reply({
                            content: 'âŒ Sem permissÃ£o.',
                            ephemeral: true
                        });
                        return;
                    }

                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)

                                .setDescription(
                                    'Gerencie os anÃºncios que serÃ£o exibidos para seus clientes.'
                                )
                                .addFields(
                                    {
                                .setDescription(
                                        value: String(
                                            db.announcements.filter(
                                                announcement => announcement.active
                                            ).length
                                        ),
                                        inline: true
                                    },
                                    {
                                            ).length
                                        value: String(db.announcements.length),
                                        inline: true
                                    }
                                )
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('â†©ï¸')
                                    .setStyle(
                                        ButtonStyle.Secondary
                                    )
                            )
                        ]
                    });

                    return;
                }
            }
        }

        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'store_refresh') {
                await interaction.update({
                    embeds: [storeEmbed()],
                    components: storeComponents()
                });
                return;
            }

            if (id === 'back_store') {
                await interaction.update({
                    embeds: [storeEmbed()],
                    components: storeComponents()
                });
                return;
            }

            if (id === 'panel_home' || id === 'panel_refresh') {
                await interaction.update({
                    embeds: [panelEmbed()],
                    components: panelComponents()
                });
                return;
            }

            if (id === 'panel_close') {
                await interaction.update({
                    content: 'âœ… Painel fechado.',
                    embeds: [],
                    components: []
                });
                return;
            }

            if (id.startsWith('buy:')) {
                const product = getProduct(
                    id.split(':')[1]
                );

                if (!product) {
                    await interaction.reply({
                        content: 'âŒ Produto nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                const stockCheck = checkProductStock(product);
                if (!stockCheck.canPurchase) {
                    await interaction.reply({
                        content: stockCheck.message,
                        ephemeral: true
                    });
                    return;
                }

                // Show warning if stock is low
                if (stockCheck.message) {
                    await interaction.reply({
                        content: stockCheck.message,
                        ephemeral: true
                    });
                    // Continue with cart creation despite warning
                }

                try {
                    const result =
                        await createCartChannel(
                            interaction,
                            product
                        );

                    if (result.existing) {
                        await interaction.reply({
                            content:
                        );
                            ephemeral: true
                        });
                        return;
                    }

                    await interaction.reply({
                        content:
                            `âœ… Seu carrinho foi criado: ${result.channel}\n` +
                    }
                        ephemeral: true
                    });
                } catch (error) {
                    console.error(
                        'âŒ Erro ao criar carrinho:',
                        error
                    );

                    await interaction.reply({
                        content:
                            'âŒ NÃ£o foi possÃ­vel criar o carrinho.',
                        ephemeral: true
                    });
                }

                return;
            }

            if (id.startsWith('deliver:')) {
                const order = getOrder(id.split(':')[1]);

                if (!order) {
                    await interaction.reply({
                        content: 'âŒ Pedido nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                await finalizeCart(interaction, order);
                return;
            }

            if (id.startsWith('cancel_cart:')) {
                const order = getOrder(
                    id.split(':')[1]
                );

                if (!order) {
                    await interaction.reply({
                        content: 'âŒ Pedido nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                await cancelCart(interaction, order);
                return;
            }

            if (id.startsWith('verify_payment:')) {
                const orderId = id.split(':')[1];
                const order = getOrder(orderId);

                if (!order) {
                    await interaction.reply({
                        content: 'âŒ Pedido nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                // Only the order owner or admin can verify payment
                if (interaction.user.id !== order.userId && !isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ VocÃª nÃ£o pode verificar o pagamento deste pedido.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.deferReply();

                try {
                    // Show checking status
                    await interaction.editReply({
                await interaction.deferReply();
                        embeds: [],
                        components: []
                    });

                    // Check payment status with EfÃ­
                    const charge = await efiService.getCharge(order.txid);

                    // Update order based on charge status
                    let statusChanged = false;
                    let statusMessage = '';

                    if (charge.status === 'CONCLUIDA' && order.payment !== 'Confirmado') {
                        order.payment = 'Confirmado';
                        order.status = 'Pago';
                        statusChanged = true;
                        statusMessage = 'âœ… Pagamento confirmado com sucesso!';
                    } else if ((charge.status === 'REMOVIDA_PELO_USUARIO_AGENTE' || charge.status === 'REMOVIDA_PELO_USUARIO') && order.payment !== 'Cancelado') {
                        order.payment = 'Cancelado';
                        order.status = 'Cancelado';
                        statusChanged = true;
                        statusMessage = 'âŒ Pagamento cancelado pelo usuÃ¡rio.';
                    } else if (charge.status === 'ATIVA' && order.payment !== 'Pendente') {
                        order.payment = 'Pendente';
                        // Keep status as Carrinho Aberto
                        statusChanged = true;
                        statusMessage = 'â³ Pagamento ainda pendente.';
                    } else if (charge.status === 'EXPIRADA' && order.payment !== 'Expirado') {
                        order.payment = 'Expirado';
                        order.status = 'Expirado';
                        statusChanged = true;
                        statusMessage = 'â° Pagamento expirado.';
                    } else {
                        // No status change, but we still want to update the UI
                        statusMessage = 'â„¹ï¸ Status do pagamento atualizado.';
                    }

                    if (statusChanged) {
                        saveDatabase();
                    }

                    // Update the cart message with new payment status
                    const channel = interaction.channel;
                    const cartEmbed = new EmbedBuilder()
                        .setColor(getStatusColor(order.payment, order.status))

                        .setDescription(
                            `OlÃ¡ <@${order.userId}>!\n\n` +
                            `Seu pedido foi aberto neste canal privado.\n\n` +
                            `**Produto:** ${order.productName}\n` +
                            `**Quantidade:** 1\n` +
                            `**Valor:** ${money(order.total)}\n` +
                            `**Pedido:** \`${order.id}\`\n\n` +
                            `Seu pedido foi aberto neste canal privado.\n\n` +
                            `**Produto:** ${order.productName}\n` +
                        )
                        .addFields({
                            `**Pedido:** \`${order.id}\`\n\n` +
                            value: getCartInstructions(order.payment, order.status)
                        })
                        .setFooter({
                            text: 'CaduSallers â€¢ Carrinho privado'
                        })
                        .setTimestamp();

                    // Update action buttons based on status
                    const actionComponents = [];

                    // Cancel button (only for pending payments and not delivered)
                    if (order.payment !== 'Confirmado' && order.status !== 'Finalizado' && order.status !== 'Cancelado' && order.status !== 'Expirado') {
                        actionComponents.push(
                            new ButtonBuilder()
                                .setCustomId(`cancel_cart:${order.id}`)
                                .setLabel('Cancelar')
                                .setEmoji('âŒ')
                                .setStyle(ButtonStyle.Danger)
                        );
                    }

                    // Verify payment button (only for pending payments)
                    if (order.payment === 'Pendente') {
                        actionComponents.push(
                            new ButtonBuilder()
                                .setCustomId(`verify_payment:${order.id}`)
                                .setLabel('Verificar pagamento')
                    if (order.payment === 'Pendente') {
                                .setStyle(ButtonStyle.Primary)
                        );

                        actionComponents.push(
                            new ButtonBuilder()
                                .setCustomId(`copy_pix:${order.id}`)
                                .setLabel('Copiar Pix')

                                .setStyle(ButtonStyle.Secondary)
                        );
                    }

                    const actions = new ActionRowBuilder().addComponents(actionComponents);

                    await interaction.editReply({
                        embeds: [cartEmbed],
                        components: [actions]
                    });

                    // Notify user based on payment status
                    if (order.payment === 'Confirmado' && order.status === 'Pago') {
                        await interaction.followUp({
                            content: 'âœ… Pagamento confirmado! Aguarde a entrega do produto.',
                            ephemeral: true
                        });
                    } else if (order.payment === 'Cancelado' || order.payment === 'Expirado') {
                        await interaction.followUp({
                            content: statusMessage,
                            ephemeral: true
                        });
                    } else {
                        // Still pending or other status
                        await interaction.followUp({
                            content: statusMessage,
                            ephemeral: true
                        });
                    }
                } catch (error) {
                    console.error('âŒ Error verifying payment:', error);
                    await interaction.followUp({
                        content: 'âŒ NÃ£o foi possÃ­vel verificar o pagamento. Tente novamente em alguns instantes.',
                        ephemeral: true
                    });
                }
                return;
            }

            if (id.startsWith('copy_pix:')) {
                const orderId = id.split(':')[1];
                const order = getOrder(orderId);

                if (!order) {
                    await interaction.reply({
                        content: 'âŒ Pedido nÃ£o encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                // Only the order owner or admin can copy Pix
                if (interaction.user.id !== order.userId && !isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ VocÃª nÃ£o pode copiar o cÃ³digo Pix deste pedido.',
                        ephemeral: true
                    });
                    return;
                }

                if (!order.copiaCola) {
                    await interaction.reply({
                        content: 'âŒ CÃ³digo Pix nÃ£o disponÃ­vel para este pedido.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.reply({
                    });
                    ephemeral: true
                });
                return;
            }
        }

        if (interaction.isModalSubmit()) {
            if (
                interaction.customId ===
                'new_product_modal'
            ) {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: 'âŒ Sem permissÃ£o.',
                        ephemeral: true
                    });
                    return;
                }

                const name =
                    interaction.fields
                        .getTextInputValue(
                            'product_name'
                        )
                        .trim();

                const price = Number(
                    interaction.fields
                        .getTextInputValue(
                            'product_price'
                        )
                        .replace(',', '.')
                );

                const stock =
                    Number.parseInt(
                        interaction.fields.getTextInputValue(
                            'product_stock'
                        ),
                        10
                    );

                const category =
                    interaction.fields
                        .getTextInputValue(
                            'product_category'
                        )
                        .trim();

                const description =
                    interaction.fields
                        .getTextInputValue(
                            'product_description'
                        )
                        .trim();

                if (
                    !name ||
                    !Number.isFinite(price) ||
                    price < 0 ||
                    !Number.isInteger(stock) ||
                    stock < 0 ||
                    !category ||
                    !description
                ) {
                    await interaction.reply({
                        content:
                            'âŒ Dados invÃ¡lidos.',
                        ephemeral: true
                    });
                    return;
                }

                const product = {
                    id: makeId('PROD'),
                    name,
                    description,
                    price: Number(price.toFixed(2)),
                    stock,
                    category,
                    name,
                    deliveryItems: [],
                    createdAt: new Date().toISOString()
                };

                db.products.push(product);
                saveDatabase();

                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(SUCCESS)
                            .setTitle('âœ… Produto criado')
                            .addFields(
                                {
                                    name: 'Nome',
                                    value: product.name,
                                    inline: true
                                },
                                {
                                    name: 'PreÃ§o',
                                    value: money(
                                        product.price
                                    ),
                                    inline: true
                                },
                                {
                                    name: 'Estoque',
                                    value: String(
                                        product.stock
                                    ),
                                    inline: true
                                },
                                {
                                    name: 'ID',
                                    value: product.id
                                }
                            )
                    ],
                    ephemeral: true
                });

                return;
            }
        }
    } catch (error) {
        console.error(
            'âŒ Erro na interaÃ§Ã£o:',
            error
        );

        try {
            if (
                interaction.replied ||
                interaction.deferred
            ) {
                await interaction.followUp({
                    content:
                        'âŒ Ocorreu um erro ao processar a aÃ§Ã£o.',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content:
                        'âŒ Ocorreu um erro ao processar a aÃ§Ã£o.',
                    ephemeral: true
                });
            }
        } catch {
            // Evita erro secundÃ¡rio.
        }
    }
});

// ============================================================
// READY
// ============================================================

client.once('ready', async () => {
    console.log('');
    console.log('========================================');
    console.log(`âœ… ${client.user.tag} estÃ¡ ONLINE`);
    console.log(`âœ… Servidores: ${client.guilds.cache.size}`);
    console.log(`âœ… Produtos carregados: ${db.products.length}`);
    console.log('âœ… Sistema de carrinhos: ATIVO');
    console.log('âœ… Entrega -> contagem 10s -> exclusÃ£o: ATIVO');
    console.log('========================================');
    console.log('');

    const rest = new REST({ version: '10' }).setToken(
        token
    );

    try {
        for (const guild of client.guilds.cache.values()) {
            await rest.put(
                Routes.applicationGuildCommands(
                    client.user.id,
                    guild.id
                ),
                {
                    body: commands.map(command =>
                        command.toJSON()
                    )
                }
            );

            console.log(
                `âœ… Comandos registrados: ${guild.name}`
            );
        }
    } catch (error) {
        console.error(
            'âŒ Erro registrando comandos:',
            error
        );
    }
});

client.on('error', error => {
    console.error(
        'âŒ Erro do Discord:',
        error
    );
});

process.on('unhandledRejection', error => {
    console.error(
        'âŒ Unhandled rejection:',
        error
    );
});

client.login(token);
