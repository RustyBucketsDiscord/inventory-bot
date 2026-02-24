const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

console.log('Starting ticket panel buttons migration...');

// Backup the database first
const dbPath = path.join(__dirname, 'inventory.db');
const backupPath = path.join(__dirname, 'inventory.db.backup.' + Date.now() + '.db');
fs.copyFileSync(dbPath, backupPath);
console.log(`✅ Backup created: ${backupPath}`);

const db = new Database(dbPath);

// Add blank column to ticket_panels if not exists
try {
  db.exec(`ALTER TABLE ticket_panels ADD COLUMN blank INTEGER DEFAULT 0`);
  console.log('✅ Added blank column to ticket_panels');
} catch (e) {
  console.log('ℹ️ blank column already exists or error:', e.message);
}

// Create ticket_panel_buttons table
db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_panel_buttons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    custom_label TEXT DEFAULT '',
    custom_emoji TEXT DEFAULT '',
    button_style TEXT DEFAULT 'Primary', -- Primary, Secondary, Success, Danger, Link
    button_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_id) REFERENCES ticket_panels(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES ticket_categories(id) ON DELETE CASCADE
  )
`);

// Migrate existing panel-category relationships to the new table
// For each panel, find categories that have panel_id set to that panel
const panels = db.prepare('SELECT * FROM ticket_panels').all();
for (const panel of panels) {
  const categories = db.prepare('SELECT * FROM ticket_categories WHERE panel_id = ? AND guild_id = ?').all(panel.id, panel.guild_id);
  for (const cat of categories) {
    // Check if button already exists
    const existing = db.prepare('SELECT 1 FROM ticket_panel_buttons WHERE panel_id = ? AND category_id = ?').get(panel.id, cat.id);
    if (!existing) {
      db.prepare(`
        INSERT INTO ticket_panel_buttons (panel_id, category_id, custom_label, custom_emoji, button_style, button_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        panel.id,
        cat.id,
        '', // custom_label
        cat.emoji, // custom_emoji
        'Primary', // button_style
        cat.id // temporary order
      );
    }
  }
}
console.log(`✅ Migrated ${panels.length} panels to new button table`);

// Add ticket_type column to ticket_categories if not exists (already may exist from earlier)
try {
  db.exec(`ALTER TABLE ticket_categories ADD COLUMN ticket_type TEXT DEFAULT 'support'`);
  console.log('✅ Added ticket_type column to ticket_categories');
} catch (e) {
  console.log('ℹ️ ticket_type column already exists');
}

console.log('🎉 Migration complete!');
db.close();