function money(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
}

function isAdmin(interaction) {
    return Boolean(
        interaction.memberPermissions?.has(process.env.ADMIN_PERMISSION_CHECK === 'false'
            ? 0x00000008 // Administrator permission bit
            : process.env.ADMIN_PERMISSION_CHECK === 'true'
                ? 0x00000008
                : 0x00000008) // Default to Administrator permission
    );
}

function sanitizeChannelName(input) {
    return String(input || 'cliente')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'cliente';
}

function totalStock(products) {
    return products.reduce(
        (sum, product) => sum + Number(product.stock || 0),
        0
    );
}

function paidRevenue(orders) {
    return orders
        .filter(order => order.status === 'Finalizado')
        .reduce((sum, order) => sum + Number(order.total || 0), 0);
}

function getProductById(products, productId) {
    return products.find(p => p.id === productId);
}

function getActiveOrderForUser(orders, userId) {
    return orders.find(
        order =>
            order.userId === userId &&
            order.status === 'Carrinho Aberto'
    );
}

function getOrderById(orders, orderId) {
    return orders.find(order => order.id === orderId);
}

function getOrdersByUserId(orders, userId) {
    return orders.filter(order => order.userId === userId);
}

function getOrdersByStatus(orders, status) {
    return orders.filter(order => order.status === status);
}

module.exports = {
    money,
    isAdmin,
    sanitizeChannelName,
    totalStock,
    paidRevenue,
    getProductById,
    getActiveOrderForUser,
    getOrderById,
    getOrdersByUserId,
    getOrdersByStatus
};