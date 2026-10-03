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
    console.error('❌ DISCORD_TOKEN não encontrado no .env');
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
// /setup -> painel público -> Comprar -> canal privado do carrinho
// -> entrega manual -> botão Entregue -> contagem 10..0 -> apaga canal.
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const DEFAULT_DB = {
    version: 4,
    products: [],
    orders: [],
    coupons: [],
    settings: {
        currency: 'BRL',
        storeName: 'CaduSallers',
        cartCategoryName: '🛒・carrinhos'
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
            version: 4,
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

function isAdmin(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    );
}

function makeId(prefix) {
    const random = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`;
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
    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle(`${product.emoji || '📦'} ${product.name}`)
        .setDescription(product.description || 'Sem descrição.')
        .addFields(
            {
                name: '💰 Preço',
                value: money(product.price),
                inline: true
            },
            {
                name: '📦 Estoque',
                value: String(product.stock),
                inline: true
            },
            {
                name: '🗂️ Categoria',
                value: product.category || 'Geral',
                inline: true
            }
        )
        .setFooter({
            text: `ID: ${product.id}`
        });
}

function productActions(productId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`buy:${productId}`)
            .setLabel('Comprar')
            .setEmoji('🛒')
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
            name: db.settings.storeName || 'CaduSallers'
        })
        .setTitle('🛍️ Loja')
        .setDescription(
            products.length
                ? 'Selecione um produto abaixo para abrir os detalhes e comprar.\n\n' +
                  'Ao clicar em **Comprar**, um canal privado será criado automaticamente para o seu pedido.'
                : 'A loja está sem produtos disponíveis no momento.'
        )
        .addFields(
            {
                name: '📦 Produtos disponíveis',
                value: String(products.length),
                inline: true
            },
            {
                name: '📊 Estoque total',
                value: String(totalStock()),
                inline: true
            }
        )
        .setFooter({
            text: 'CaduSallers • Atendimento por carrinho'
        });
}

function productMenu() {
    const options = db.products
        .filter(product => Number(product.stock || 0) > 0)
        .slice(0, 25)
        .map(product => ({
            label: String(product.name).slice(0, 100),
            description:
                `${money(product.price)} • ${product.stock} em estoque`.slice(
                    0,
                    100
                ),
            value: product.id,
            emoji: product.emoji || '📦'
        }));

    if (!options.length) {
        return null;
    }

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('product_select')
            .setPlaceholder('🛍️ Escolha um produto')
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
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary)
        )
    );

    return components;
}

function panelEmbed() {
    const categories = new Set(
        db.products.map(product => product.category || 'Geral')
    );

    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle('CaduSallers • Painel Administrativo')
        .setDescription(
            'Gerencie sua operação de vendas pelo Discord.\n\n' +
            'O painel público da loja usa **/setup** e os carrinhos são criados automaticamente quando um cliente compra.'
        )
        .addFields(
            {
                name: '📦 Produtos',
                value: String(db.products.length),
                inline: true
            },
            {
                name: '📊 Estoque',
                value: String(totalStock()),
                inline: true
            },
            {
                name: '🧾 Pedidos',
                value: String(db.orders.length),
                inline: true
            },
            {
                name: '💰 Faturamento',
                value: money(paidRevenue()),
                inline: true
            },
            {
                name: '🗂️ Categorias',
                value: String(categories.size),
                inline: true
            },
            {
                name: '🛒 Carrinhos abertos',
                value: String(
                    db.orders.filter(
                        order => order.status === 'Carrinho Aberto'
                    ).length
                ),
                inline: true
            }
        )
        .setFooter({
            text: 'CaduSallers • Painel principal'
        })
        .setTimestamp();
}

function panelComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('panel_section')
                .setPlaceholder('Selecione um módulo')
                .addOptions(
                    {
                        label: 'Loja',
                        description: 'Ver produtos',
                        value: 'store',
                        emoji: '🛍️'
                    },
                    {
                        label: 'Carrinhos',
                        description: 'Pedidos em atendimento',
                        value: 'carts',
                        emoji: '🛒'
                    },
                    {
                        label: 'Compras',
                        description: 'Histórico de pedidos',
                        value: 'purchases',
                        emoji: '🧾'
                    },
                    {
                        label: 'Ferramentas',
                        description: 'Produtos e estoque',
                        value: 'tools',
                        emoji: '🧰'
                    },
                    {
                        label: 'Métricas',
                        description: 'Indicadores da loja',
                        value: 'metrics',
                        emoji: '📊'
                    },
                    {
                        label: 'Configurações',
                        description: 'Configurações da loja',
                        value: 'settings',
                        emoji: '⚙️'
                    }
                )
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('panel_refresh')
                .setLabel('Atualizar')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('panel_close')
                .setLabel('Fechar')
                .setEmoji('✖️')
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
                    .setLabel('Preço (ex.: 19.90)')
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
                    .setLabel('Descrição')
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
        finalizedAt: null
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

    if (Number(product.stock || 0) <= 0) {
        throw new Error('Produto sem estoque.');
    }

    const category = await getOrCreateCartCategory(interaction.guild);
    const order = createOrder(interaction.user.id, product);

    const userPart = sanitizeChannelName(
        interaction.member?.displayName || interaction.user.username
    );

    const channelName = `🛒-${userPart}-${Date.now()
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
        topic: `Pedido ${order.id} • ${interaction.user.id}`,
        reason: `Carrinho criado para ${interaction.user.tag}`
    });

    order.cartChannelId = channel.id;
    saveDatabase();

    const cartEmbed = new EmbedBuilder()
        .setColor(BRAND)
        .setTitle('🛒 Carrinho de compra')
        .setDescription(
            `Olá <@${interaction.user.id}>!\n\n` +
            `Seu pedido foi aberto neste canal privado.\n\n` +
            `**Produto:** ${product.name}\n` +
            `**Quantidade:** 1\n` +
            `**Valor:** ${money(product.price)}\n` +
            `**Pedido:** \`${order.id}\`\n\n` +
            `💳 **Pagamento:** ${order.payment}\n` +
            `📦 **Entrega:** aguardando atendimento`
        )
        .addFields({
            name: '📌 Como funciona',
            value:
                'Aguarde o atendimento do vendedor neste canal. ' +
                'Depois que o produto for entregue, um administrador poderá clicar em **Entregue**. ' +
                'Após isso o canal fará uma contagem de 10 segundos e será excluído automaticamente.'
        })
        .setFooter({
            text: 'CaduSallers • Carrinho privado'
        })
        .setTimestamp();

    const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cancel_cart:${order.id}`)
            .setLabel('Cancelar')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
    );

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
            content: '❌ Somente administradores podem marcar o pedido como entregue.',
            ephemeral: true
        });
        return;
    }

    if (closingCarts.has(order.id)) {
        return;
    }

    if (order.status !== 'Carrinho Aberto') {
        await interaction.reply({
            content: `ℹ️ Esse pedido já está com status **${order.status}**.`,
            ephemeral: true
        });
        return;
    }

    closingCarts.add(order.id);

    order.status = 'Finalizado';
    order.payment = 'Confirmado';
    order.deliveredAt = new Date().toISOString();
    order.finalizedAt = new Date().toISOString();

    // O estoque é baixado somente quando a entrega é concluída.
    const product = getProduct(order.productId);
    if (product) {
        product.stock = Math.max(
            0,
            Number(product.stock || 0) - Number(order.quantity || 1)
        );
    }

    saveDatabase();

    const seconds = 10;

    const countdownEmbed = () =>
        new EmbedBuilder()
            .setColor(SUCCESS)
            .setTitle('✅ Pedido entregue')
            .setDescription(
                `O pedido \`${order.id}\` foi marcado como **ENTREGUE**.\n\n` +
                `🗑️ Este canal será apagado em **CONTAGEM** segundos.`
            )
            .addFields(
                {
                    name: '📦 Produto',
                    value: order.productName,
                    inline: true
                },
                {
                    name: '💰 Valor',
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
                `🗑️ Este canal será apagado em **${seconds}** segundos.`
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
                    `Pedido ${order.id} finalizado após entrega`
                );
                break;
            }

            await message.edit({
                embeds: [
                    countdownEmbed().setDescription(
                        `O pedido \`${order.id}\` foi marcado como **ENTREGUE**.\n\n` +
                        `🗑️ Este canal será apagado em **${remaining}** segundos.`
                    )
                ],
                components: []
            });
        }
    } catch (error) {
        console.error('❌ Erro na finalização do carrinho:', error);
    } finally {
        closingCarts.delete(order.id);
    }
}

async function cancelCart(interaction, order) {
    if (!isAdmin(interaction) && interaction.user.id !== order.userId) {
        await interaction.reply({
            content: '❌ Você não pode cancelar este carrinho.',
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

    try {
        await interaction.reply({
            content: '❌ Carrinho cancelado. Este canal será apagado em 3 segundos.'
        });

        await new Promise(resolve => setTimeout(resolve, 3000));

        if (interaction.channel) {
            await interaction.channel.delete(
                `Carrinho ${order.id} cancelado`
            );
        }
    } catch (error) {
        console.error('❌ Erro cancelando carrinho:', error);
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
            .setDescription('Altera o preço')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do produto')
                    .setRequired(true)
            )
            .addNumberOption(o =>
                o
                    .setName('valor')
                    .setDescription('Novo preço')
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
            .setDescription('Operação')
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
                    .setDescription('Conteúdo da entrega')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub
            .setName('quantidade')
            .setDescription('Mostra itens disponíveis')
            .addStringOption(o =>
                o
                    .setName('id')
                    .setDescription('ID do produto')
                    .setRequired(true)
            )
    );

const commands = [
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Abre o painel administrativo'),

    new SlashCommandBuilder()
        .setName('loja')
        .setDescription('Abre o painel público da loja'),

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
        )
];

// ============================================================
// INTERAÇÕES
// ============================================================

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            const name = interaction.commandName;

            if (name === 'panel') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: '❌ Apenas administradores.',
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
                        content: '❌ Apenas administradores.',
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
                        '✅ Painel da loja publicado neste canal.',
                    ephemeral: true
                });

                return;
            }

            if (name === 'criar_produto') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: '❌ Apenas administradores.',
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
                        content: '❌ Sem permissão.',
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
                                      `**${product.name}** — \`${product.id}\` — ${money(product.price)} — estoque ${product.stock}`
                              )
                              .join('\n')
                        : 'Nenhum produto cadastrado.';

                    await interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                                .setTitle('📦 Produtos')
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
                        content: '❌ Produto não encontrado.',
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
                        content: `✅ Produto **${product.name}** removido.`,
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
                            `✅ Preço de **${product.name}** atualizado para **${money(product.price)}**.`,
                        ephemeral: true
                    });
                    return;
                }
            }

            if (name === 'manage_stock') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: '❌ Sem permissão.',
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
                        content: '❌ Produto não encontrado.',
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
                        `✅ Estoque de **${product.name}**: **${product.stock}**.`,
                    ephemeral: true
                });

                return;
            }

            if (name === 'manage_item') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: '❌ Sem permissão.',
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
                        content: '❌ Produto não encontrado.',
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
                            `✅ Item adicionado a **${product.name}**.\n` +
                            `📦 Itens disponíveis: **${product.deliveryItems.length}**.`,
                        ephemeral: true
                    });

                    return;
                }

                if (sub === 'quantidade') {
                    await interaction.reply({
                        content:
                            `📦 **${product.name}** possui **${product.deliveryItems.length}** itens digitais.`,
                        ephemeral: true
                    });

                    return;
                }
            }

            if (name === 'postproduto') {
                if (!isAdmin(interaction)) {
                    await interaction.reply({
                        content: '❌ Sem permissão.',
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
                        content: '❌ Produto não encontrado.',
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
                        `✅ **${product.name}** publicado em ${channel}.`,
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
                        content: '❌ Produto não encontrado.',
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
                                .setLabel('Voltar à loja')
                                .setEmoji('↩️')
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
                                      `🛒 **${order.id}** — ${order.productName} — ${money(order.total)} — <@${order.userId}>`
                              )
                              .join('\n')
                        : 'Nenhum carrinho aberto.';

                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                                .setTitle('🛒 Carrinhos abertos')
                                .setDescription(text.slice(0, 3900))
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('↩️')
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
                                      `**${order.id}** — ${order.productName} — ${money(order.total)} — ${order.status}`
                              )
                              .join('\n')
                        : 'Você ainda não possui pedidos.';

                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                                .setTitle('🧾 Minhas compras')
                                .setDescription(text.slice(0, 3900))
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('↩️')
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
                            content: '❌ Sem permissão.',
                            ephemeral: true
                        });
                        return;
                    }

                    await interaction.update({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(BRAND)
                                .setTitle('🧰 Ferramentas')
                                .setDescription(
                                    'Use os comandos administrativos para gerenciar sua loja.'
                                )
                                .addFields(
                                    {
                                        name: '📦 Produtos',
                                        value:
                                            '`/criar_produto` e `/manage_product`'
                                    },
                                    {
                                        name: '📊 Estoque',
                                        value: '`/manage_stock`'
                                    },
                                    {
                                        name: '🎟️ Itens digitais',
                                        value: '`/manage_item`'
                                    },
                                    {
                                        name: '📢 Publicação',
                                        value: '`/postproduto` ou `/setup`'
                                    }
                                )
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('↩️')
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
                                .setTitle('📊 Métricas')
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
                                    .setEmoji('↩️')
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
                                .setTitle('⚙️ Configurações')
                                .setDescription(
                                    `Nome da loja: **${db.settings.storeName}**\n` +
                                    `Categoria dos carrinhos: **${db.settings.cartCategoryName}**\n\n` +
                                    'Nesta etapa o fluxo de carrinho já está ativo.'
                                )
                        ],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('panel_home')
                                    .setLabel('Voltar')
                                    .setEmoji('↩️')
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
                    content: '✅ Painel fechado.',
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
                        content: '❌ Produto não encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                if (Number(product.stock || 0) <= 0) {
                    await interaction.reply({
                        content: '❌ Esse produto está sem estoque.',
                        ephemeral: true
                    });
                    return;
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
                                `🛒 Você já possui um carrinho aberto: ${result.channel}.`,
                            ephemeral: true
                        });
                        return;
                    }

                    await interaction.reply({
                        content:
                            `✅ Seu carrinho foi criado: ${result.channel}\n` +
                            `📦 Pedido: \`${result.order.id}\``,
                        ephemeral: true
                    });
                } catch (error) {
                    console.error(
                        '❌ Erro ao criar carrinho:',
                        error
                    );

                    await interaction.reply({
                        content:
                            '❌ Não foi possível criar o carrinho.',
                        ephemeral: true
                    });
                }

                return;
            }

            if (id.startsWith('deliver:')) {
                const order = getOrder(id.split(':')[1]);

                if (!order) {
                    await interaction.reply({
                        content: '❌ Pedido não encontrado.',
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
                        content: '❌ Pedido não encontrado.',
                        ephemeral: true
                    });
                    return;
                }

                await cancelCart(interaction, order);
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
                        content: '❌ Sem permissão.',
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
                            '❌ Dados inválidos.',
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
                    emoji: '📦',
                    deliveryItems: [],
                    createdAt: new Date().toISOString()
                };

                db.products.push(product);
                saveDatabase();

                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(SUCCESS)
                            .setTitle('✅ Produto criado')
                            .addFields(
                                {
                                    name: 'Nome',
                                    value: product.name,
                                    inline: true
                                },
                                {
                                    name: 'Preço',
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
            '❌ Erro na interação:',
            error
        );

        try {
            if (
                interaction.replied ||
                interaction.deferred
            ) {
                await interaction.followUp({
                    content:
                        '❌ Ocorreu um erro ao processar a ação.',
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content:
                        '❌ Ocorreu um erro ao processar a ação.',
                    ephemeral: true
                });
            }
        } catch {
            // Evita erro secundário.
        }
    }
});

// ============================================================
// READY
// ============================================================

client.once('ready', async () => {
    console.log('');
    console.log('========================================');
    console.log(`✅ ${client.user.tag} está ONLINE`);
    console.log(`✅ Servidores: ${client.guilds.cache.size}`);
    console.log(`✅ Produtos carregados: ${db.products.length}`);
    console.log('✅ Sistema de carrinhos: ATIVO');
    console.log('✅ Entrega -> contagem 10s -> exclusão: ATIVO');
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
                `✅ Comandos registrados: ${guild.name}`
            );
        }
    } catch (error) {
        console.error(
            '❌ Erro registrando comandos:',
            error
        );
    }
});

client.on('error', error => {
    console.error(
        '❌ Erro do Discord:',
        error
    );
});

process.on('unhandledRejection', error => {
    console.error(
        '❌ Unhandled rejection:',
        error
    );
});

client.login(token);
