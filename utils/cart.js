// ─── Cart Database Operations ─────────────────────────────────────────────
const { db } = require('./database');

const cartStmts = {
  add: db.prepare(`INSERT INTO cart_items (guild_id, user_id, ticket_channel_id, product_id, size_label, quantity) VALUES (?, ?, ?, ?, ?, ?)`),
  getByTicket: db.prepare(`SELECT * FROM cart_items WHERE ticket_channel_id = ? AND guild_id = ? ORDER BY id`),
  getByUser: db.prepare(`SELECT * FROM cart_items WHERE user_id = ? AND ticket_channel_id = ? AND guild_id = ?`),
  removeItem: db.prepare(`DELETE FROM cart_items WHERE id = ? AND guild_id = ?`),
  clearCart: db.prepare(`DELETE FROM cart_items WHERE ticket_channel_id = ? AND guild_id = ?`),
  updateQuantity: db.prepare(`UPDATE cart_items SET quantity = ? WHERE id = ? AND guild_id = ?`),
};

const cart = {
  add(guildId, userId, ticketChannelId, productId, sizeLabel, quantity = 1) {
    const result = cartStmts.add.run(guildId, userId, ticketChannelId, productId, sizeLabel, quantity);
    return result.lastInsertRowid;
  },
  getByTicket(ticketChannelId, guildId) {
    return cartStmts.getByTicket.all(ticketChannelId, guildId);
  },
  removeItem(id, guildId) {
    return cartStmts.removeItem.run(id, guildId);
  },
  clearCart(ticketChannelId, guildId) {
    return cartStmts.clearCart.run(ticketChannelId, guildId);
  },
  updateQuantity(id, guildId, quantity) {
    return cartStmts.updateQuantity.run(quantity, id, guildId);
  },
};

module.exports = { cart };
