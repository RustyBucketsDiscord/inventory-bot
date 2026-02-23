const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'inventory.db'));

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT DEFAULT '',
    category TEXT DEFAULT 'General',
    message_id TEXT DEFAULT '',
    channel_id TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_sizes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    label TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL,
    emoji TEXT DEFAULT '💳',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    buyer_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    size_label TEXT DEFAULT '',
    quantity INTEGER DEFAULT 1,
    payment_method TEXT DEFAULT '',
    payment_screenshot TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    buyer_name TEXT DEFAULT '',
    buyer_address TEXT DEFAULT '',
    tracking_number TEXT DEFAULT '',
    ticket_channel_id TEXT DEFAULT '',
    staff_id TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    inventory_channel_id TEXT DEFAULT '',
    bot_name TEXT DEFAULT '',
    bot_avatar TEXT DEFAULT '',
    log_channel_id TEXT DEFAULT '',
    image_channel_id TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add size_label column to orders if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE orders ADD COLUMN size_label TEXT DEFAULT ''`);
} catch (e) {
  // Column already exists
}

// Add image_channel_id to guild_settings if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE guild_settings ADD COLUMN image_channel_id TEXT DEFAULT ''`);
} catch (e) {
  // Column already exists
}

// ─── Products ─────────────────────────────────────────────────────────────────

const productStmts = {
  add: db.prepare(`
    INSERT INTO products (guild_id, name, description, price, stock, image_url, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getAll: db.prepare(`SELECT * FROM products WHERE guild_id = ? ORDER BY category, name`),
  getInStock: db.prepare(`SELECT * FROM products WHERE guild_id = ? AND stock > 0 ORDER BY category, name`),
  getById: db.prepare(`SELECT * FROM products WHERE id = ? AND guild_id = ?`),
  update: db.prepare(`
    UPDATE products SET name = ?, description = ?, price = ?, stock = ?, image_url = ?, category = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND guild_id = ?
  `),
  updateStock: db.prepare(`
    UPDATE products SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?
  `),
  decrementStock: db.prepare(`
    UPDATE products SET stock = stock - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ? AND stock > 0
  `),
  updateMessage: db.prepare(`
    UPDATE products SET message_id = ?, channel_id = ? WHERE id = ? AND guild_id = ?
  `),
  remove: db.prepare(`DELETE FROM products WHERE id = ? AND guild_id = ?`),
};

const products = {
  add(guildId, name, description, price, stock, imageUrl, category) {
    const result = productStmts.add.run(guildId, name, description, price, stock, imageUrl, category);
    return result.lastInsertRowid;
  },
  getAll(guildId, vendorId = null) {
    if (vendorId) {
      return db.prepare(`SELECT * FROM products WHERE guild_id = ? AND vendor_id = ? ORDER BY category, name`).all(guildId, vendorId);
    }
    return productStmts.getAll.all(guildId);
  },
  getAllMainStore(guildId) {
    return db.prepare(`SELECT * FROM products WHERE guild_id = ? AND (vendor_id IS NULL OR vendor_id = 0) ORDER BY category, name`).all(guildId);
  },
  getInStock(guildId, vendorId = null) {
    const all = vendorId
      ? db.prepare(`SELECT * FROM products WHERE guild_id = ? AND vendor_id = ? ORDER BY category, name`).all(guildId, vendorId)
      : productStmts.getAll.all(guildId);
    return all.filter(p => {
      const sizes = productSizes.getByProduct(p.id, guildId);
      if (sizes.length > 0) {
        return sizes.some(s => s.stock > 0);
      }
      return p.stock > 0;
    });
  },
  getById(id, guildId) {
    return productStmts.getById.get(id, guildId);
  },
  update(id, guildId, name, description, price, stock, imageUrl, category) {
    return productStmts.update.run(name, description, price, stock, imageUrl, category, id, guildId);
  },
  updateStock(id, guildId, stock) {
    return productStmts.updateStock.run(stock, id, guildId);
  },
  decrementStock(id, guildId) {
    return productStmts.decrementStock.run(id, guildId);
  },
  updateMessage(id, guildId, messageId, channelId) {
    return productStmts.updateMessage.run(messageId, channelId, id, guildId);
  },
  remove(id, guildId) {
    return productStmts.remove.run(id, guildId);
  },
  getTotalStock(id, guildId) {
    const sizes = productSizes.getByProduct(id, guildId);
    if (sizes.length > 0) {
      return sizes.reduce((sum, s) => sum + s.stock, 0);
    }
    const product = productStmts.getById.get(id, guildId);
    return product ? product.stock : 0;
  },
};

// ─── Product Sizes ────────────────────────────────────────────────────────────

const sizeStmts = {
  add: db.prepare(`INSERT INTO product_sizes (product_id, guild_id, label, stock) VALUES (?, ?, ?, ?)`),
  getByProduct: db.prepare(`SELECT * FROM product_sizes WHERE product_id = ? AND guild_id = ? ORDER BY id`),
  getById: db.prepare(`SELECT * FROM product_sizes WHERE id = ? AND guild_id = ?`),
  getByLabel: db.prepare(`SELECT * FROM product_sizes WHERE product_id = ? AND guild_id = ? AND label = ?`),
  updateStock: db.prepare(`UPDATE product_sizes SET stock = ? WHERE id = ? AND guild_id = ?`),
  decrementStock: db.prepare(`UPDATE product_sizes SET stock = stock - 1 WHERE id = ? AND guild_id = ? AND stock > 0`),
  remove: db.prepare(`DELETE FROM product_sizes WHERE id = ? AND guild_id = ?`),
  removeAll: db.prepare(`DELETE FROM product_sizes WHERE product_id = ? AND guild_id = ?`),
};

const productSizes = {
  add(productId, guildId, label, stock) {
    const result = sizeStmts.add.run(productId, guildId, label, stock);
    // Update total product stock
    const total = this.getTotalStock(productId, guildId);
    productStmts.updateStock.run(total, productId, guildId);
    return result.lastInsertRowid;
  },
  getByProduct(productId, guildId) {
    return sizeStmts.getByProduct.all(productId, guildId);
  },
  getById(id, guildId) {
    return sizeStmts.getById.get(id, guildId);
  },
  getByLabel(productId, guildId, label) {
    return sizeStmts.getByLabel.get(productId, guildId, label);
  },
  updateStock(id, guildId, stock) {
    const size = sizeStmts.getById.get(id, guildId);
    sizeStmts.updateStock.run(stock, id, guildId);
    if (size) {
      const total = this.getTotalStock(size.product_id, guildId);
      productStmts.updateStock.run(total, size.product_id, guildId);
    }
  },
  decrementStock(id, guildId) {
    const size = sizeStmts.getById.get(id, guildId);
    sizeStmts.decrementStock.run(id, guildId);
    if (size) {
      const total = this.getTotalStock(size.product_id, guildId);
      productStmts.updateStock.run(total, size.product_id, guildId);
    }
  },
  remove(id, guildId) {
    const size = sizeStmts.getById.get(id, guildId);
    sizeStmts.remove.run(id, guildId);
    if (size) {
      const total = this.getTotalStock(size.product_id, guildId);
      productStmts.updateStock.run(total, size.product_id, guildId);
    }
  },
  removeAll(productId, guildId) {
    sizeStmts.removeAll.run(productId, guildId);
  },
  getTotalStock(productId, guildId) {
    const sizes = sizeStmts.getByProduct.all(productId, guildId);
    return sizes.reduce((sum, s) => sum + s.stock, 0);
  },
};

// ─── Payment Methods ──────────────────────────────────────────────────────────

const paymentStmts = {
  add: db.prepare(`INSERT INTO payment_methods (guild_id, name, instructions, emoji) VALUES (?, ?, ?, ?)`),
  getAll: db.prepare(`SELECT * FROM payment_methods WHERE guild_id = ? ORDER BY name`),
  getById: db.prepare(`SELECT * FROM payment_methods WHERE id = ? AND guild_id = ?`),
  remove: db.prepare(`DELETE FROM payment_methods WHERE id = ? AND guild_id = ?`),
  update: db.prepare(`UPDATE payment_methods SET name = ?, instructions = ?, emoji = ? WHERE id = ? AND guild_id = ?`),
};

const paymentMethods = {
  add(guildId, name, instructions, emoji = '💳') {
    const result = paymentStmts.add.run(guildId, name, instructions, emoji);
    return result.lastInsertRowid;
  },
  getAll(guildId) {
    return paymentStmts.getAll.all(guildId);
  },
  getById(id, guildId) {
    return paymentStmts.getById.get(id, guildId);
  },
  remove(id, guildId) {
    return paymentStmts.remove.run(id, guildId);
  },
  update(id, guildId, name, instructions, emoji) {
    return paymentStmts.update.run(name, instructions, emoji, id, guildId);
  },
};

// ─── Orders ───────────────────────────────────────────────────────────────────

const orderStmts = {
  create: db.prepare(`
    INSERT INTO orders (guild_id, buyer_id, product_id, size_label, quantity, ticket_channel_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getById: db.prepare(`SELECT * FROM orders WHERE id = ? AND guild_id = ?`),
  getByTicket: db.prepare(`SELECT * FROM orders WHERE ticket_channel_id = ? AND guild_id = ? ORDER BY created_at DESC LIMIT 1`),
  getByBuyer: db.prepare(`SELECT * FROM orders WHERE buyer_id = ? AND guild_id = ? ORDER BY created_at DESC`),
  getAll: db.prepare(`SELECT * FROM orders WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`),
  getByStatus: db.prepare(`SELECT * FROM orders WHERE guild_id = ? AND status = ? ORDER BY created_at DESC`),
  updateStatus: db.prepare(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`),
  updatePayment: db.prepare(`UPDATE orders SET payment_method = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`),
  updateScreenshot: db.prepare(`UPDATE orders SET payment_screenshot = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`),
  updateShipping: db.prepare(`UPDATE orders SET buyer_name = ?, buyer_address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`),
  updateTracking: db.prepare(`UPDATE orders SET tracking_number = ?, status = 'shipped', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`),
  updateStaff: db.prepare(`UPDATE orders SET staff_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`),
  updateSize: db.prepare(`UPDATE orders SET size_label = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?`),
};

const orders = {
  create(guildId, buyerId, productId, sizeLabel, quantity, ticketChannelId) {
    const result = orderStmts.create.run(guildId, buyerId, productId, sizeLabel, quantity, ticketChannelId);
    return result.lastInsertRowid;
  },
  getById(id, guildId) {
    return orderStmts.getById.get(id, guildId);
  },
  getByTicket(ticketChannelId, guildId) {
    return orderStmts.getByTicket.get(ticketChannelId, guildId);
  },
  getByBuyer(buyerId, guildId) {
    return orderStmts.getByBuyer.all(buyerId, guildId);
  },
  getAll(guildId, limit = 25) {
    return orderStmts.getAll.all(guildId, limit);
  },
  getByStatus(guildId, status) {
    return orderStmts.getByStatus.all(guildId, status);
  },
  updateStatus(id, guildId, status) {
    return orderStmts.updateStatus.run(status, id, guildId);
  },
  updatePayment(id, guildId, method) {
    return orderStmts.updatePayment.run(method, id, guildId);
  },
  updateScreenshot(id, guildId, url) {
    return orderStmts.updateScreenshot.run(url, id, guildId);
  },
  updateShipping(id, guildId, name, address) {
    return orderStmts.updateShipping.run(name, address, id, guildId);
  },
  updateTracking(id, guildId, trackingNumber) {
    return orderStmts.updateTracking.run(trackingNumber, id, guildId);
  },
  updateStaff(id, guildId, staffId) {
    return orderStmts.updateStaff.run(staffId, id, guildId);
  },
  updateSize(id, guildId, sizeLabel) {
    return orderStmts.updateSize.run(sizeLabel, id, guildId);
  },
};

// ─── Guild Settings ───────────────────────────────────────────────────────────

const settingsStmts = {
  get: db.prepare(`SELECT * FROM guild_settings WHERE guild_id = ?`),
  upsert: db.prepare(`
    INSERT INTO guild_settings (guild_id, inventory_channel_id, bot_name, bot_avatar, log_channel_id, image_channel_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      inventory_channel_id = COALESCE(NULLIF(excluded.inventory_channel_id, ''), inventory_channel_id),
      bot_name = COALESCE(NULLIF(excluded.bot_name, ''), bot_name),
      bot_avatar = COALESCE(NULLIF(excluded.bot_avatar, ''), bot_avatar),
      log_channel_id = COALESCE(NULLIF(excluded.log_channel_id, ''), log_channel_id),
      image_channel_id = COALESCE(NULLIF(excluded.image_channel_id, ''), image_channel_id)
  `),
};

const settings = {
  get(guildId) {
    return settingsStmts.get.get(guildId);
  },
  set(guildId, { inventoryChannelId = '', botName = '', botAvatar = '', logChannelId = '', imageChannelId = '' } = {}) {
    return settingsStmts.upsert.run(guildId, inventoryChannelId, botName, botAvatar, logChannelId, imageChannelId);
  },
};

// Original export replaced — see bottom of file
// module.exports = { db, products, productSizes, paymentMethods, orders, settings };

// ─── Vendors ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    channel_id TEXT DEFAULT '',
    sales_channel_id TEXT DEFAULT '',
    inventory_channel_id TEXT DEFAULT '',
    category_channel_id TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, user_id)
  );
`);

// Add vendor_id columns to products and payment_methods if needed
try { db.exec(`ALTER TABLE products ADD COLUMN vendor_id INTEGER DEFAULT NULL`); } catch (e) {}
try { db.exec(`ALTER TABLE payment_methods ADD COLUMN vendor_id INTEGER DEFAULT NULL`); } catch (e) {}
try { db.exec(`ALTER TABLE orders ADD COLUMN vendor_id INTEGER DEFAULT NULL`); } catch (e) {}

const vendorStmts = {
  add: db.prepare(`INSERT OR IGNORE INTO vendors (guild_id, user_id, name) VALUES (?, ?, ?)`),
  getAll: db.prepare(`SELECT * FROM vendors WHERE guild_id = ? ORDER BY name`),
  getById: db.prepare(`SELECT * FROM vendors WHERE id = ? AND guild_id = ?`),
  getByUserId: db.prepare(`SELECT * FROM vendors WHERE user_id = ? AND guild_id = ?`),
  getByChannel: db.prepare(`SELECT * FROM vendors WHERE channel_id = ? AND guild_id = ?`),
  update: db.prepare(`UPDATE vendors SET name = ?, enabled = ? WHERE id = ? AND guild_id = ?`),
  updateChannels: db.prepare(`UPDATE vendors SET channel_id = ?, sales_channel_id = ?, inventory_channel_id = ?, category_channel_id = ? WHERE id = ? AND guild_id = ?`),
  remove: db.prepare(`DELETE FROM vendors WHERE id = ? AND guild_id = ?`),
};

const vendors = {
  add: (guildId, userId, name) => {
    vendorStmts.add.run(guildId, userId, name);
    return vendorStmts.getByUserId.get(userId, guildId);
  },
  getAll: (guildId) => vendorStmts.getAll.all(guildId),
  getById: (id, guildId) => vendorStmts.getById.get(id, guildId),
  getByUserId: (userId, guildId) => vendorStmts.getByUserId.get(userId, guildId),
  getByChannel: (channelId, guildId) => vendorStmts.getByChannel.get(channelId, guildId),
  /**
   * Detect vendor context: if user is a vendor AND in one of their channels, return vendor.
   * Staff/admins in a vendor channel also get vendor context for management.
   */
  detectContext: (userId, channelId, guildId) => {
    // Check if user is a vendor
    const vendor = vendorStmts.getByUserId.get(userId, guildId);
    if (vendor) return vendor;
    // Check if channel belongs to a vendor (for staff working in vendor channels)
    const allVendors = vendorStmts.getAll.all(guildId);
    return allVendors.find(v => v.channel_id === channelId || v.sales_channel_id === channelId || v.inventory_channel_id === channelId) || null;
  },
  updateChannels: (id, guildId, channelId, salesChannelId, inventoryChannelId, categoryChannelId) =>
    vendorStmts.updateChannels.run(channelId, salesChannelId, inventoryChannelId, categoryChannelId, id, guildId),
  remove: (id, guildId) => vendorStmts.remove.run(id, guildId),
};

module.exports = { db, products, productSizes, paymentMethods, orders, settings, vendors };
