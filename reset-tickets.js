const Database = require('better-sqlite3');
const db = new Database('./inventory.db');

console.log('🧹 Wiping ALL ticket data...');
db.prepare('DELETE FROM ticket_panels').run();
db.prepare('DELETE FROM ticket_categories').run();
db.prepare('DELETE FROM ticket_panel_buttons').run();
db.prepare('DELETE FROM tickets').run();
db.prepare('DELETE FROM ticket_settings').run();
console.log('✅ All ticket data deleted! Starting fresh.');

// Recreate tables with new structure
db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT DEFAULT '',
    message_id TEXT DEFAULT '',
    title TEXT DEFAULT 'Support Tickets',
    description TEXT DEFAULT 'Click a button below to open a ticket.',
    color TEXT DEFAULT '#5865f2',
    blank INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ticket_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    panel_id INTEGER,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    emoji TEXT DEFAULT '🎫',
    category_channel_id TEXT DEFAULT '',
    staff_role_ids TEXT DEFAULT '',
    welcome_message TEXT DEFAULT '',
    ticket_type TEXT DEFAULT 'support',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_id) REFERENCES ticket_panels(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ticket_panel_buttons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    custom_label TEXT DEFAULT '',
    custom_emoji TEXT DEFAULT '',
    button_style TEXT DEFAULT 'Primary',
    button_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_id) REFERENCES ticket_panels(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES ticket_categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category_id INTEGER,
    panel_id INTEGER,
    claimed_by TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    transcript TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    FOREIGN KEY (category_id) REFERENCES ticket_categories(id)
  );

  CREATE TABLE IF NOT EXISTS ticket_settings (
    guild_id TEXT PRIMARY KEY,
    log_channel_id TEXT DEFAULT '',
    transcript_channel_id TEXT DEFAULT '',
    sales_channel_id TEXT DEFAULT '',
    staff_role_id TEXT DEFAULT '',
    auto_close_hours INTEGER DEFAULT 0,
    ticket_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ Database tables recreated with fresh structure.');
db.close();