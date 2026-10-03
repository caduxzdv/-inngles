require('dotenv').config();

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
    console.error('ERRO: DISCORD_TOKEN não encontrado no .env');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ============================================================
// CaduSallers v3
// Núcleo persistente: produtos, estoque, pedidos e cupons.
// Implementação própria; sem dependências externas de banco.
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_DB = {
    version: 1,
    products: [],
    orders: [],
    coupons: [],
    settings: {
        currency: 'BRL',
        storeName: 'CaduSallers'
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
            products: Array.isArray(parsed.products) ? parsed.products : [],
            orders: Array.isArray(parsed.orders) ? parsed.orders : [],
            coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [],
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

let db = loadDatabase();

function saveDatabase() {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(db, null, 2),
        'utf8'
    );
}

const carts = new Map();
const tickets = new Map();

const BRAND = 0x5865F2;
const SUCCESS = 0x57F287;
const WARNING = 0xFEE75C;
const DANGER = 0xED4245;
const DARK = 0x2B2D31;

function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
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

function getProduct(productId) {
    return db.products.find(p => p.id === productId);
}

function getCart(userId) {
    if (!carts.has(userId)) carts.set(userId, []);
    return carts.get(userId);
}

function totalStock() {
    return db.products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
}

function paidRevenue() {
    return db.orders
        .filter(order => order.status === 'Pago')
        .reduce((sum, order) => sum + Number(order.total || 0), 0);
}

function productsEmbed() {
    const products = db.products;

    const description = products.length
        ? products.map(product =>
            `**${product.name}**\n` +
            `${product.description || 'Sem descrição.'}\n` +
            `💰 ${money(product.price)} • 📦 ${product.stock} em estoque • 🗂️ ${product.category}`
        ).join('\n\n')
        : 'Nenhum produto cadastrado.';

    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle('🛍️ Loja')
        .setDescription(description.slice(0, 3900))
        .setFooter({ text: 'CaduSallers • Catálogo' });
}

function productMenu() {
    const options = db.products.slice(0, 25).map(product => ({
        label: String(product.name).slice(0, 100),
        description: `${money(product.price)} • ${product.stock} em estoque`.slice(0, 100),
        value: product.id
    }));

    if (!options.length) return null;

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('product_select')
            .setPlaceholder('Selecione um produto')
            .addOptions(options)
    );
}

function panelEmbed() {
    const categories = new Set(db.products.map(p => p.category));

    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle('CaduSallers • Central')
        .setDescription(
            'Painel central da sua operação de vendas.\n\n' +
            'Escolha um módulo no menu para continuar.'
        )
        .addFields(
            { name: '📦 Produtos', value: String(db.products.length), inline: true },
            { name: '📊 Estoque', value: String(totalStock()), inline: true },
            { name: '🧾 Pedidos', value: String(db.orders.length), inline: true },
            { name: '💰 Faturamento pago', value: money(paidRevenue()), inline: true },
            { name: '🎫 Tickets', value: String(tickets.size), inline: true },
            { name: '🗂️ Categorias', value: String(categories.size), inline: true }
        )
        .setFooter({ text: 'CaduSallers • Painel principal' })
        .setTimestamp();
}

function panelMenu() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('panel_section')
            .setPlaceholder('Selecione uma seção')
            .addOptions(
                { label: 'Loja', description: 'Produtos e catálogo', value: 'store', emoji: '🛍️' },
                { label: 'Carrinhos', description: 'Carrinhos em andamento', value: 'carts', emoji: '🛒' },
                { label: 'Compras', description: 'Histórico e pedidos', value: 'purchases', emoji: '🧾' },
                { label: 'Atendimento', description: 'Tickets e suporte', value: 'tickets', emoji: '🎫' },
                { label: 'Segurança', description: 'Proteções e moderação', value: 'security', emoji: '🛡️' },
                { label: 'Automações', description: 'Alertas e rotinas', value: 'automation', emoji: '🤖' },
                { label: 'Customização', description: 'Aparência e mensagens', value: 'customization', emoji: '🎨' },
                { label: 'Configurações', description: 'Sistema e pagamentos', value: 'settings', emoji: '⚙️' },
                { label: 'Ferramentas', description: 'Administração', value: 'tools', emoji: '🧰' },
                { label: 'Métricas', description: 'Indicadores', value: 'metrics', emoji: '📊' }
            )
    );
}

function panelButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_refresh').setLabel('Atualizar').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_close').setLabel('Fechar').setStyle(ButtonStyle.Danger)
    );
}

function panelComponents() {
    return [panelMenu(), panelButtons()];
}

function cartEmbed(userId) {
    const cart = getCart(userId);

    if (!cart.length) {
        return new EmbedBuilder()
            .setColor(DARK)
            .setTitle('🛒 Carrinho')
            .setDescription('Seu carrinho está vazio.');
    }

    let total = 0;
    const lines = [];

    for (const item of cart) {
        const product = getProduct(item.productId);
        if (!product) continue;
        const subtotal = Number(product.price) * item.quantity;
        total += subtotal;
        lines.push(`**${product.name}** × ${item.quantity} — ${money(subtotal)}`);
    }

    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle('🛒 Seu carrinho')
        .setDescription(lines.join('\n') || 'Carrinho vazio.')
        .addFields({ name: '💰 Total', value: `**${money(total)}**` });
}

function cartActions(userId) {
    const hasItems = getCart(userId).length > 0;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('checkout').setLabel('Finalizar compra').setEmoji('💳').setStyle(ButtonStyle.Success).setDisabled(!hasItems),
        new ButtonBuilder().setCustomId('clear_cart').setLabel('Limpar').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(!hasItems),
        new ButtonBuilder().setCustomId('back_store').setLabel('Voltar à loja').setEmoji('🛍️').setStyle(ButtonStyle.Secondary)
    );
}

function productDetail(product) {
    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle(`${product.emoji || '📦'} ${product.name}`)
        .setDescription(product.description || 'Sem descrição.')
        .addFields(
            { name: '💰 Preço', value: money(product.price), inline: true },
            { name: '📦 Estoque', value: String(product.stock), inline: true },
            { name: '🗂️ Categoria', value: product.category || 'Geral', inline: true }
        )
        .setFooter({ text: `ID: ${product.id}` });
}

function productActions(productId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`add:${productId}`).setLabel('Adicionar ao carrinho').setEmoji('🛒').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`buy:${productId}`).setLabel('Comprar agora').setEmoji('⚡').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('back_store').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
    );
}

function purchasesEmbed(userId) {
    const orders = db.orders.filter(o => o.userId === userId).slice(-15).reverse();

    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle('🧾 Minhas compras')
        .setDescription(
            orders.length
                ? orders.map(order =>
                    `**${order.id}** • ${money(order.total)} • **${order.status}**`
                ).join('\n')
                : 'Nenhuma compra encontrada.'
        );
}

function adminToolsEmbed() {
    return new EmbedBuilder()
        .setColor(WARNING)
        .setTitle('🧰 Ferramentas administrativas')
        .setDescription('Gerencie o catálogo e o estoque sem sair do Discord.')
        .addFields(
            { name: '📦 Produto', value: 'Criar, editar e remover.', inline: true },
            { name: '📊 Estoque', value: 'Adicionar, remover e definir estoque.', inline: true },
            { name: '🏷️ Cupons', value: 'Criar e remover descontos.', inline: true },
            { name: '📢 Publicação', value: 'Publicar produtos em canais.', inline: true },
            { name: '💳 Pedidos', value: 'Consultar e preparar entrega.', inline: true },
            { name: '🛠️ Sistema', value: 'Persistência local habilitada.', inline: true }
        );
}

function adminToolsButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_new_product').setLabel('Novo produto').setEmoji('📦').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('admin_stock').setLabel('Estoque').setEmoji('📊').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_home').setLabel('Painel').setStyle(ButtonStyle.Secondary)
    );
}

function buildNewProductModal() {
    return new ModalBuilder()
        .setCustomId('new_product_modal')
        .setTitle('Criar produto')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('product_name').setLabel('Nome').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('product_price').setLabel('Preço (ex.: 19.90)').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('product_stock').setLabel('Estoque inicial').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('product_category').setLabel('Categoria').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('product_description').setLabel('Descrição').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(700)
            )
        );
}

function buildStockModal() {
    return new ModalBuilder()
        .setCustomId('stock_modal')
        .setTitle('Gerenciar estoque')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('stock_product_id').setLabel('ID do produto').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('stock_operation').setLabel('Operação: add | remove | set').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('stock_quantity').setLabel('Quantidade').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
}

function createOrder(userId, itemList) {
    let total = 0;

    const items = itemList.map(item => {
        const product = getProduct(item.productId);
        const subtotal = Number(product.price) * item.quantity;
        total += subtotal;
        return {
            productId: product.id,
            name: product.name,
            quantity: item.quantity,
            unitPrice: product.price
        };
    });

    const order = {
        id: makeId('PED'),
        userId,
        items,
        total,
        status: 'Pendente',
        payment: 'Pendente',
        createdAt: new Date().toISOString()
    };

    db.orders.push(order);
    saveDatabase();
    return order;
}

// ============================================================
// COMANDOS
// ============================================================

const manageProduct = new SlashCommandBuilder()
    .setName('manage_product')
    .setDescription('Gerencia produtos')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
        .setName('listar')
        .setDescription('Lista os produtos'))
    .addSubcommand(sub => sub
        .setName('remover')
        .setDescription('Remove um produto')
        .addStringOption(o => o.setName('id').setDescription('ID do produto').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('preco')
        .setDescription('Altera o preço')
        .addStringOption(o => o.setName('id').setDescription('ID do produto').setRequired(true))
        .addNumberOption(o => o.setName('valor').setDescription('Novo preço').setRequired(true).setMinValue(0)));

const manageStock = new SlashCommandBuilder()
    .setName('manage_stock')
    .setDescription('Gerencia estoque')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('id').setDescription('ID do produto').setRequired(true))
    .addStringOption(o => o
        .setName('operacao')
        .setDescription('Operação')
        .setRequired(true)
        .addChoices(
            { name: 'Adicionar', value: 'add' },
            { name: 'Remover', value: 'remove' },
            { name: 'Definir', value: 'set' }
        ))
    .addIntegerOption(o => o.setName('quantidade').setDescription('Quantidade').setRequired(true).setMinValue(0));

const manageItem = new SlashCommandBuilder()
    .setName('manage_item')
    .setDescription('Gerencia itens digitais de um produto')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
        .setName('adicionar')
        .setDescription('Adiciona um item de entrega')
        .addStringOption(o => o.setName('id').setDescription('ID do produto').setRequired(true))
        .addStringOption(o => o.setName('conteudo').setDescription('Conteúdo da entrega').setRequired(true)))
    .addSubcommand(sub => sub
        .setName('quantidade')
        .setDescription('Mostra itens disponíveis')
        .addStringOption(o => o.setName('id').setDescription('ID do produto').setRequired(true)));

const commands = [
    new SlashCommandBuilder().setName('panel').setDescription('Abre o painel principal'),
    new SlashCommandBuilder().setName('loja').setDescription('Abre a loja'),
    new SlashCommandBuilder().setName('vercompras').setDescription('Consulta suas compras'),
    new SlashCommandBuilder().setName('tools').setDescription('Abre as ferramentas administrativas').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('criar_produto').setDescription('Abre o criador de produto').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    manageProduct,
    manageStock,
    manageItem,
    new SlashCommandBuilder().setName('postproduto').setDescription('Publica um produto em um canal').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o => o.setName('id').setDescription('ID do produto').setRequired(true))
        .addChannelOption(o => o.setName('canal').setDescription('Canal de publicação').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName('setup').setDescription('Publica o painel no canal atual').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('gerarpix').setDescription('Cria uma solicitação de pagamento Pix (modo demonstrativo)').addNumberOption(o => o.setName('valor').setDescription('Valor').setRequired(true).setMinValue(0.01)),
    new SlashCommandBuilder().setName('consultarpagamentos').setDescription('Consulta o status de um pedido').addStringOption(o => o.setName('pedido').setDescription('ID do pedido').setRequired(true))
];

// ============================================================
// INTERAÇÕES
// ============================================================

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const name = interaction.commandName;

            if (name === 'panel') {
                await interaction.reply({ embeds: [panelEmbed()], components: panelComponents() });
                return;
            }

            if (name === 'loja') {
                const components = [];
                const menu = productMenu();
                if (menu) components.push(menu);
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_cart').setLabel('Carrinho').setEmoji('🛒').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('panel_home').setLabel('Painel').setStyle(ButtonStyle.Secondary)
                ));
                await interaction.reply({ embeds: [productsEmbed()], components });
                return;
            }

            if (name === 'vercompras') {
                await interaction.reply({ embeds: [purchasesEmbed(interaction.user.id)], ephemeral: true });
                return;
            }

            if (name === 'tools') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }
                await interaction.reply({ embeds: [adminToolsEmbed()], components: [adminToolsButtons()] });
                return;
            }

            if (name === 'criar_produto') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }
                await interaction.showModal(buildNewProductModal());
                return;
            }

            if (name === 'manage_product') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }

                const sub = interaction.options.getSubcommand();

                if (sub === 'listar') {
                    const text = db.products.length
                        ? db.products.map(p => `**${p.name}** — 0${p.id}0 — ${money(p.price)} — estoque ${p.stock}`).join('\n')
                        : 'Nenhum produto.';
                    await interaction.reply({ embeds: [new EmbedBuilder().setColor(BRAND).setTitle('📦 Produtos').setDescription(text.slice(0, 3900))], ephemeral: true });
                    return;
                }

                const id = interaction.options.getString('id', true);
                const product = getProduct(id);

                if (!product) {
                    await interaction.reply({ content: '❌ Produto não encontrado.', ephemeral: true });
                    return;
                }

                if (sub === 'remover') {
                    db.products = db.products.filter(p => p.id !== id);
                    saveDatabase();
                    await interaction.reply({ content: `✅ Produto **${product.name}** removido.`, ephemeral: true });
                    return;
                }

                if (sub === 'preco') {
                    const value = interaction.options.getNumber('valor', true);
                    product.price = Number(value.toFixed(2));
                    saveDatabase();
                    await interaction.reply({ content: `✅ Preço atualizado para **${money(product.price)}**.`, ephemeral: true });
                    return;
                }
            }

            if (name === 'manage_stock') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }

                const id = interaction.options.getString('id', true);
                const operation = interaction.options.getString('operacao', true);
                const quantity = interaction.options.getInteger('quantidade', true);
                const product = getProduct(id);

                if (!product) {
                    await interaction.reply({ content: '❌ Produto não encontrado.', ephemeral: true });
                    return;
                }

                if (operation === 'add') product.stock += quantity;
                if (operation === 'remove') product.stock = Math.max(0, product.stock - quantity);
                if (operation === 'set') product.stock = quantity;
                saveDatabase();

                await interaction.reply({ content: `✅ Estoque de **${product.name}** agora é **${product.stock}**.`, ephemeral: true });
                return;
            }

            if (name === 'manage_item') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }

                const product = getProduct(interaction.options.getString('id', true));
                if (!product) {
                    await interaction.reply({ content: '❌ Produto não encontrado.', ephemeral: true });
                    return;
                }

                const sub = interaction.options.getSubcommand();
                product.deliveryItems = Array.isArray(product.deliveryItems) ? product.deliveryItems : [];

                if (sub === 'adicionar') {
                    const content = interaction.options.getString('conteudo', true);
                    product.deliveryItems.push(content);
                    product.stock = product.deliveryItems.length;
                    saveDatabase();
                    await interaction.reply({ content: `✅ Item adicionado. Itens disponíveis: **${product.deliveryItems.length}**.`, ephemeral: true });
                    return;
                }

                if (sub === 'quantidade') {
                    await interaction.reply({ content: `📦 **${product.name}** possui **${product.deliveryItems.length}** itens de entrega.`, ephemeral: true });
                    return;
                }
            }

            if (name === 'postproduto') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }

                const product = getProduct(interaction.options.getString('id', true));
                const channel = interaction.options.getChannel('canal', true);

                if (!product) {
                    await interaction.reply({ content: '❌ Produto não encontrado.', ephemeral: true });
                    return;
                }

                await channel.send({
                    embeds: [productDetail(product)],
                    components: [productActions(product.id)]
                });
                await interaction.reply({ content: `✅ **${product.name}** publicado em ${channel}.`, ephemeral: true });
                return;
            }

            if (name === 'setup') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }
                await interaction.channel.send({ embeds: [panelEmbed()], components: panelComponents() });
                await interaction.reply({ content: '✅ Painel publicado.', ephemeral: true });
                return;
            }

            if (name === 'gerarpix') {
                const value = interaction.options.getNumber('valor', true);
                await interaction.reply({
                    embeds: [new EmbedBuilder().setColor(WARNING).setTitle('💳 Pix').setDescription(
                        `Solicitação criada para **${money(value)}**.\n\n` +
                        '⚠️ O gateway Pix ainda não está conectado. Esta versão apenas prepara o fluxo.'
                    )]
                });
                return;
            }

            if (name === 'consultarpagamentos') {
                const order = db.orders.find(o => o.id === interaction.options.getString('pedido', true));
                if (!order) {
                    await interaction.reply({ content: '❌ Pedido não encontrado.', ephemeral: true });
                    return;
                }
                await interaction.reply({
                    embeds: [new EmbedBuilder().setColor(BRAND).setTitle('🔎 Pagamento').addFields(
                        { name: 'Pedido', value: order.id },
                        { name: 'Valor', value: money(order.total), inline: true },
                        { name: 'Status', value: order.status, inline: true },
                        { name: 'Pagamento', value: order.payment, inline: true }
                    )]
                });
                return;
            }
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'panel_section') {
                const section = interaction.values[0];

                if (section === 'store') {
                    const components = [];
                    const menu = productMenu();
                    if (menu) components.push(menu);
                    components.push(panelButtons());
                    await interaction.update({ embeds: [productsEmbed()], components });
                    return;
                }

                if (section === 'purchases') {
                    await interaction.update({ embeds: [purchasesEmbed(interaction.user.id)], components: [panelButtons()] });
                    return;
                }

                if (section === 'metrics') {
                    await interaction.update({
                        embeds: [new EmbedBuilder().setColor(BRAND).setTitle('📊 Métricas').addFields(
                            { name: 'Produtos', value: String(db.products.length), inline: true },
                            { name: 'Estoque', value: String(totalStock()), inline: true },
                            { name: 'Pedidos', value: String(db.orders.length), inline: true },
                            { name: 'Faturamento pago', value: money(paidRevenue()), inline: true }
                        )],
                        components: [panelButtons()]
                    });
                    return;
                }

                if (section === 'tools') {
                    if (!isAdmin(interaction)) {
                        await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                        return;
                    }
                    await interaction.update({ embeds: [adminToolsEmbed()], components: [adminToolsButtons()] });
                    return;
                }

                const labels = {
                    carts: ['🛒 Carrinhos', 'Área reservada para monitoramento de carrinhos em andamento.'],
                    tickets: ['🎫 Atendimento', 'Área reservada para tickets e suporte.'],
                    security: ['🛡️ Segurança', 'Área reservada para proteção, moderação e logs.'],
                    automation: ['🤖 Automações', 'Área reservada para alertas, restock e rotinas.'],
                    customization: ['🎨 Customização', 'Área reservada para identidade visual e mensagens.'],
                    settings: ['⚙️ Configurações', 'Área reservada para pagamentos, permissões e integrações.']
                };

                const data = labels[section] || ['CaduSallers', 'Módulo preparado para a próxima integração.'];
                await interaction.update({
                    embeds: [new EmbedBuilder().setColor(BRAND).setTitle(data[0]).setDescription(data[1])],
                    components: [panelButtons()]
                });
                return;
            }

            if (interaction.customId === 'product_select') {
                const product = getProduct(interaction.values[0]);
                if (!product) {
                    await interaction.reply({ content: '❌ Produto não encontrado.', ephemeral: true });
                    return;
                }

                await interaction.update({ embeds: [productDetail(product)], components: [productActions(product.id)] });
                return;
            }
        }

        if (interaction.isButton()) {
            const id = interaction.customId;

            if (id === 'panel_home') {
                await interaction.update({ embeds: [panelEmbed()], components: panelComponents() });
                return;
            }

            if (id === 'panel_refresh') {
                await interaction.update({ embeds: [panelEmbed()], components: panelComponents() });
                return;
            }

            if (id === 'panel_close') {
                await interaction.update({ content: '✅ Painel fechado.', embeds: [], components: [] });
                return;
            }

            if (id === 'admin_new_product') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }
                await interaction.showModal(buildNewProductModal());
                return;
            }

            if (id === 'admin_stock') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }
                await interaction.showModal(buildStockModal());
                return;
            }

            if (id === 'open_cart') {
                await interaction.update({ embeds: [cartEmbed(interaction.user.id)], components: [cartActions(interaction.user.id)] });
                return;
            }

            if (id === 'back_store') {
                const components = [];
                const menu = productMenu();
                if (menu) components.push(menu);
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('open_cart').setLabel('Carrinho').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('panel_home').setLabel('Painel').setStyle(ButtonStyle.Secondary)
                ));
                await interaction.update({ embeds: [productsEmbed()], components });
                return;
            }

            if (id === 'clear_cart') {
                carts.set(interaction.user.id, []);
                await interaction.update({ embeds: [cartEmbed(interaction.user.id)], components: [cartActions(interaction.user.id)] });
                return;
            }

            if (id === 'checkout') {
                const cart = getCart(interaction.user.id);
                if (!cart.length) {
                    await interaction.reply({ content: '❌ Carrinho vazio.', ephemeral: true });
                    return;
                }

                for (const item of cart) {
                    const product = getProduct(item.productId);
                    if (!product || product.stock < item.quantity) {
                        await interaction.reply({ content: '❌ Um dos produtos ficou sem estoque suficiente.', ephemeral: true });
                        return;
                    }
                }

                const order = createOrder(interaction.user.id, cart);
                carts.set(interaction.user.id, []);

                await interaction.reply({
                    embeds: [new EmbedBuilder().setColor(WARNING).setTitle('🧾 Pedido criado').setDescription(
                        `Pedido: **${order.id}**\n` +
                        `Total: **${money(order.total)}**\n` +
                        `Pagamento: **Pendente**\n\n` +
                        'O próximo módulo conecta este pedido ao gateway Pix e à confirmação automática.'
                    )]
                });
                return;
            }

            if (id.startsWith('add:')) {
                const product = getProduct(id.split(':')[1]);
                if (!product) {
                    await interaction.reply({ content: '❌ Produto não encontrado.', ephemeral: true });
                    return;
                }
                if (product.stock <= 0) {
                    await interaction.reply({ content: '❌ Sem estoque.', ephemeral: true });
                    return;
                }

                const cart = getCart(interaction.user.id);
                const existing = cart.find(item => item.productId === product.id);
                if (existing) {
                    if (existing.quantity >= product.stock) {
                        await interaction.reply({ content: '❌ Limite de estoque atingido.', ephemeral: true });
                        return;
                    }
                    existing.quantity += 1;
                } else {
                    cart.push({ productId: product.id, quantity: 1 });
                }

                await interaction.reply({ content: `✅ **${product.name}** adicionado ao carrinho.`, ephemeral: true });
                return;
            }

            if (id.startsWith('buy:')) {
                const product = getProduct(id.split(':')[1]);
                if (!product) {
                    await interaction.reply({ content: '❌ Produto não encontrado.', ephemeral: true });
                    return;
                }
                if (product.stock <= 0) {
                    await interaction.reply({ content: '❌ Sem estoque.', ephemeral: true });
                    return;
                }

                const order = createOrder(interaction.user.id, [{ productId: product.id, quantity: 1 }]);
                await interaction.reply({
                    embeds: [new EmbedBuilder().setColor(WARNING).setTitle('⚡ Compra criada').setDescription(
                        `Pedido: **${order.id}**\nValor: **${money(order.total)}**\nStatus: **Pendente**`
                    )],
                    ephemeral: true
                });
                return;
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'new_product_modal') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }

                const name = interaction.fields.getTextInputValue('product_name').trim();
                const price = Number(interaction.fields.getTextInputValue('product_price').replace(',', '.'));
                const stock = Number.parseInt(interaction.fields.getTextInputValue('product_stock'), 10);
                const category = interaction.fields.getTextInputValue('product_category').trim();
                const description = interaction.fields.getTextInputValue('product_description').trim();

                if (!name || !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0 || !category) {
                    await interaction.reply({ content: '❌ Dados inválidos. Verifique nome, preço, estoque e categoria.', ephemeral: true });
                    return;
                }

                const product = {
                    id: makeId('PROD'),
                    name,
                    description,
                    price: Number(price.toFixed(2)),
                    stock,
                    category,
                    deliveryItems: [],
                    createdAt: new Date().toISOString()
                };

                db.products.push(product);
                saveDatabase();

                await interaction.reply({
                    embeds: [new EmbedBuilder().setColor(SUCCESS).setTitle('✅ Produto criado').addFields(
                        { name: 'Nome', value: product.name, inline: true },
                        { name: 'Preço', value: money(product.price), inline: true },
                        { name: 'Estoque', value: String(product.stock), inline: true },
                        { name: 'ID', value: product.id }
                    )],
                    ephemeral: true
                });
                return;
            }

            if (interaction.customId === 'stock_modal') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({ content: '❌ Sem permissão.', ephemeral: true });
                    return;
                }

                const product = getProduct(interaction.fields.getTextInputValue('stock_product_id').trim());
                const operation = interaction.fields.getTextInputValue('stock_operation').trim().toLowerCase();
                const quantity = Number.parseInt(interaction.fields.getTextInputValue('stock_quantity'), 10);

                if (!product || !['add', 'remove', 'set'].includes(operation) || !Number.isInteger(quantity) || quantity < 0) {
                    await interaction.reply({ content: '❌ Dados inválidos.', ephemeral: true });
                    return;
                }

                if (operation === 'add') product.stock += quantity;
                if (operation === 'remove') product.stock = Math.max(0, product.stock - quantity);
                if (operation === 'set') product.stock = quantity;

                saveDatabase();
                await interaction.reply({ content: `✅ Estoque de **${product.name}** atualizado para **${product.stock}**.`, ephemeral: true });
            }
        }
    } catch (error) {
        console.error('❌ Erro na interação:', error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: '❌ Ocorreu um erro ao processar a ação.', ephemeral: true });
            } else {
                await interaction.reply({ content: '❌ Ocorreu um erro ao processar a ação.', ephemeral: true });
            }
        } catch {
            // Evita erro secundário.
        }
    }
});

client.once('ready', async () => {
    console.log('');
    console.log('========================================');
    console.log(`✅ ${client.user.tag} está ONLINE`);
    console.log(`✅ Servidores: ${client.guilds.cache.size}`);
    console.log(`✅ Produtos carregados: ${db.products.length}`);
    console.log('========================================');
    console.log('');

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        for (const guild of client.guilds.cache.values()) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: commands.map(command => command.toJSON()) }
            );
            console.log(`✅ Comandos registrados: ${guild.name}`);
        }
    } catch (error) {
        console.error('❌ Erro registrando comandos:', error);
    }
});

client.on('error', error => console.error('❌ Erro do Discord:', error));
process.on('unhandledRejection', error => console.error('❌ Unhandled rejection:', error));

client.login(token);
