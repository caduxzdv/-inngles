const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { money } = require('../utils/helpers');
const { makeId } = require('../utils/database');

const BRAND = 0x5865F2;
const SUCCESS = 0x57F287;
const WARNING = 0xFEE75C;
const DANGER = 0xED4245;
const DARK = 0x2B2D31;

// Store embed
function storeEmbed(db) {
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
                value: String(totalStock(db.products)),
                inline: true
            }
        )
        .setFooter({
            text: 'CaduSallers • Atendimento por carrinho'
        });
}

// Product detail embed
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

// Product actions (buttons)
function productActions(productId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`buy:${productId}`)
            .setLabel('Comprar')
            .setEmoji('🛒')
            .setStyle(ButtonStyle.Success)
    );
}

// Store components (select menu + refresh)
function storeComponents(db) {
    const components = [];
    const menu = productMenu(db);

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

// Product select menu
function productMenu(db) {
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

// Panel embed
function panelEmbed(db) {
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
                value: String(totalStock(db.products)),
                inline: true
            },
            {
                name: '🧾 Pedidos',
                value: String(db.orders.length),
                inline: true
            },
            {
                name: '💰 Faturamento',
                value: money(paidRevenue(db.orders)),
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

// Panel components
function panelComponents(isAdmin) {
    const components = [
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

    return components;
}

// Cart embed
function cartEmbed(order) {
    return new EmbedBuilder()
        .setColor(BRAND)
        .setTitle('🛒 Carrinho de compra')
        .setDescription(
            `Olá <@${order.userId}>!\n\n` +
            `Seu pedido foi aberto neste canal privado.\n\n` +
            `**Produto:** ${order.productName}\n` +
            `**Quantidade:** 1\n` +
            `**Valor:** ${money(order.total)}\n` +
            `**Pedido:** \`${order.id}\`\n\n` +
            `💳 **Pagamento:** ${order.payment === 'Confirmado' ? '✅ Confirmado' : order.payment === 'Cancelado' ? '❌ Cancelado' : order.payment === 'Expirado' ? '⏰ Expirado' : '⏳ Aguardando pagamento'}\n` +
            `📦 **Entrega:** ${order.status === 'Finalizado' ? '✅ Entregue' : order.status === 'Pago' ? '💳 Pago - aguardando entrega' : order.status === 'Cancelado' || order.status === 'Expirado' ? '❌ Cancelado/Expirado' : '⏳ Aguardando atendimento'}`
        )
        .addFields({
            name: '📌 Como funciona',
            value:
                order.payment === 'Confirmado' ?
                'Aguarde o atendimento do vendedor para receber seu produto.' :
                order.status === 'Finalizado' ?
                'Produto entregue! O canal será fechado automaticamente.' :
                order.status === 'Cancelado' || order.status === 'Expirado' ?
                'Pedido cancelado ou expirado. O canal será fechado em breve.' :
                'Aguarde o atendimento do vendedor neste canal. ' +
                'Depois que o produto for entregue, um administrador poderá clicar em **Entregue**. ' +
                'Após isso o canal fará uma contagem de 10 segundos e será excluído automaticamente.'
        })
        .setFooter({
            text: 'CaduSallers • Carrinho privado'
        })
        .setTimestamp();
}

// Cart actions
function cartActions(order) {
    const actionComponents = [
        new ButtonBuilder()
            .setCustomId(`cancel_cart:${order.id}`)
            .setLabel('Cancelar')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(order.payment === 'Confirmado' || order.status === 'Finalizado')
    ];

    if (order.payment === 'Pendente') {
        actionComponents.push(
            new ButtonBuilder()
                .setCustomId(`verify_payment:${order.id}`)
                .setLabel('Verificar pagamento')
                .setEmoji('🔄')
                .setStyle(ButtonStyle.Primary)
        );

        actionComponents.push(
            new ButtonBuilder()
                .setCustomId(`copy_pix:${order.id}`)
                .setLabel('Copiar Pix')
                .setEmoji('📋')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    return new ActionRowBuilder().addComponents(actionComponents);
}

// Countdown embed for finalization
function countdownEmbed(order, remaining) {
    return new EmbedBuilder()
        .setColor(SUCCESS)
        .setTitle('✅ Pedido entregue')
        .setDescription(
            `O pedido \`${order.id}\` foi marcado como **ENTREGUE**.\n\n` +
            `🗑️ Este canal será apagado em **${remaining}** segundos.`
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
}

// New product modal
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

// Manage product modal (edit)
function buildEditProductModal(product) {
    return new ModalBuilder()
        .setCustomId(`edit_product_modal:${product.id}`)
        .setTitle(`Editar produto: ${product.name}`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('edit_product_name')
                    .setLabel('Nome')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(80)
                    .setValue(product.name)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('edit_product_price')
                    .setLabel('Preço (ex.: 19.90)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(product.price))
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('edit_product_stock')
                    .setLabel('Estoque')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(String(product.stock))
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('edit_product_category')
                    .setLabel('Categoria')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setValue(product.category || '')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('edit_product_description')
                    .setLabel('Descrição')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(700)
                    .setValue(product.description || '')
            )
        );
}

module.exports = {
    storeEmbed,
    productDetail,
    productActions,
    storeComponents,
    productMenu,
    panelEmbed,
    panelComponents,
    cartEmbed,
    cartActions,
    countdownEmbed,
    buildNewProductModal,
    buildEditProductModal
};