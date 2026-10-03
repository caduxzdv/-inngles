const { SlashCommandBuilder } = require('discord.js');
const { makeId } = require('../utils/database');

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

module.exports = {
    manageProduct,
    manageStock,
    manageItem,
    commands
};