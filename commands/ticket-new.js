const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { settings } = require('../utils/database');
const { db } = require('../utils/database');
const { parseEmoji, parseColor } = require('../utils/helpers');

// ─── Ticket Settings Table ──────────────────────────────────────────────────

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
    ticket_type TEXT DEFAULT 'support', -- 'purchase' or 'support'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_id) REFERENCES ticket_panels(id) ON DELETE CASCADE
  );

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

// Add columns if they don't exist (migration for existing DBs)
try { db.exec(`ALTER TABLE ticket_panels ADD COLUMN blank INTEGER DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE ticket_categories ADD COLUMN ticket_type TEXT DEFAULT 'support'`); } catch (e) {}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system management')
    
    // Setup
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Initial ticket system setup (auto-creates log + transcript channels)')
        .addRoleOption(opt => opt.setName('staff-role').setDescription('Role that can manage tickets').setRequired(true))
    )
    
    // Panel Management
    .addSubcommand(sub =>
      sub.setName('panel')
        .setDescription('Create a ticket panel (embed with buttons)')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post the panel in').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('title').setDescription('Panel title').setRequired(false))
        .addStringOption(opt => opt.setName('description').setDescription('Panel description').setRequired(false))
        .addStringOption(opt => opt.setName('color').setDescription('Panel color (name or hex)').setRequired(false))
        .addBooleanOption(opt => opt.setName('blank').setDescription('Start with blank panel (no buttons)').setRequired(false))
    )
    
    .addSubcommand(sub =>
      sub.setName('panel-list')
        .setDescription('List all ticket panels in this server')
    )
    
    .addSubcommand(sub =>
      sub.setName('panel-edit')
        .setDescription('Edit a ticket panel — opens a popup form')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID to edit (use /ticket panel-list to find)').setRequired(true))
    )
    
    .addSubcommand(sub =>
      sub.setName('panel-refresh')
        .setDescription('Refresh/resend the ticket panel with current buttons')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID to refresh (default: most recent)').setRequired(false))
    )
    
    .addSubcommand(sub =>
      sub.setName('panel-delete')
        .setDescription('Delete a ticket panel and its buttons')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID to delete').setRequired(true))
    )
    
    // Category Management
    .addSubcommand(sub =>
      sub.setName('category')
        .setDescription('Add a ticket category (auto-creates a Discord folder for it)')
        .addStringOption(opt => opt.setName('name').setDescription('Category name').setRequired(true))
        .addStringOption(opt => opt.setName('type').setDescription('Ticket type').setRequired(false)
          .addChoices(
            { name: '🛒 Purchase (shows product dropdown)', value: 'purchase' },
            { name: '💬 Support (general support)', value: 'support' },
          ))
        .addStringOption(opt => opt.setName('emoji').setDescription('Button emoji (unicode or custom)').setRequired(false))
        .addStringOption(opt => opt.setName('description').setDescription('Category description').setRequired(false))
        .addRoleOption(opt => opt.setName('staff-role').setDescription('Override staff role for this category').setRequired(false))
        .addStringOption(opt => opt.setName('welcome-message').setDescription('Message sent when ticket opens').setRequired(false))
    )
    
    .addSubcommand(sub =>
      sub.setName('category-list')
        .setDescription('List all ticket categories')
    )
    
    .addSubcommand(sub =>
      sub.setName('category-edit')
        .setDescription('Edit a ticket category — opens a popup form')
        .addStringOption(opt => opt.setName('name').setDescription('Name of category to edit').setRequired(true).setAutocomplete(true))
    )
    
    .addSubcommand(sub =>
      sub.setName('category-remove')
        .setDescription('Remove a ticket category')
        .addStringOption(opt => opt.setName('name').setDescription('Category name to remove').setRequired(true))
    )
    
    // Button Management
    .addSubcommand(sub =>
      sub.setName('button-add')
        .setDescription('Add a button to a ticket panel')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID to add button to').setRequired(true))
        .addStringOption(opt => opt.setName('category').setDescription('Category name for this button').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('label').setDescription('Custom button label (optional)').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('Custom emoji (optional)').setRequired(false))
        .addStringOption(opt => opt.setName('style').setDescription('Button style').setRequired(false)
          .addChoices(
            { name: 'Primary (blurple)', value: 'Primary' },
            { name: 'Secondary (grey)', value: 'Secondary' },
            { name: 'Success (green)', value: 'Success' },
            { name: 'Danger (red)', value: 'Danger' },
            { name: 'Link (grey with link icon)', value: 'Link' }
          ))
    )
    
    .addSubcommand(sub =>
      sub.setName('button-remove')
        .setDescription('Remove a button from a ticket panel')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID').setRequired(true))
        .addStringOption(opt => opt.setName('category').setDescription('Category name to remove button for').setRequired(true).setAutocomplete(true))
    )
    
    .addSubcommand(sub =>
      sub.setName('button-edit')
        .setDescription('Edit a button on a ticket panel')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID').setRequired(true))
        .addStringOption(opt => opt.setName('category').setDescription('Category name to edit button for').setRequired(true).setAutocomplete(true))
        .addStringOption(opt => opt.setName('label').setDescription('New button label').setRequired(false))
        .addStringOption(opt => opt.setName('emoji').setDescription('New emoji').setRequired(false))
        .addStringOption(opt => opt.setName('style').setDescription('New button style').setRequired(false)
          .addChoices(
            { name: 'Primary (blurple)', value: 'Primary' },
            { name: 'Secondary (grey)', value: 'Secondary' },
            { name: 'Success (green)', value: 'Success' },
            { name: 'Danger (red)', value: 'Danger' },
            { name: 'Link (grey with link icon)', value: 'Link' }
          ))
    )
    
    .addSubcommand(sub =>
      sub.setName('button-list')
        .setDescription('List all buttons on a panel')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID to list buttons for').setRequired(true))
    )
    
    .addSubcommand(sub =>
      sub.setName('button-order')
        .setDescription('Reorder buttons on a panel (opens modal)')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID to reorder buttons for').setRequired(true))
    )
    
    // Ticket Management (existing commands)
    .addSubcommand(sub =>
      sub.setName('close')
        .setDescription('Close the current ticket')
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for closing').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('claim')
        .setDescription('Claim this ticket (you\'re handling it)')
    )
    .addSubcommand(sub =>
      sub.setName('unclaim')
        .setDescription('Unclaim this ticket')
    )
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a user to this ticket')
        .addUserOption(opt => opt.setName('user').setDescription('User to add').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a user from this ticket')
        .addUserOption(opt => opt.setName('user').setDescription('User to remove').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('rename')
        .setDescription('Rename this ticket channel')
        .addStringOption(opt => opt.setName('name').setDescription('New channel name').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('auto-close')
        .setDescription('Set auto-close for inactive tickets')
        .addIntegerOption(opt => opt.setName('hours').setDescription('Hours of inactivity before auto-close (0 to disable)').setRequired(true))
    )
    .setDefaultMemberPermissions(null),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const sub = interaction.options.getSubcommand();
    
    if (sub === 'category-edit' || sub === 'category-remove' || 
        sub === 'button-add' || sub === 'button-remove' || sub === 'button-edit') {
      const categories = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY name').all(interaction.guildId);
      const filtered = categories.filter(c => 
        c.name.toLowerCase().includes(focused.toLowerCase()) ||
        (c.description && c.description.toLowerCase().includes(focused.toLowerCase()))
      ).slice(0, 25);
      
      await interaction.respond(
        filtered.map(c => ({
          name: `${c.emoji} ${c.name}${c.description ? ` — ${c.description.slice(0, 50)}` : ''}`,
          value: c.name
        }))
      );
    }
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ─── Setup ──────────────────────────────────────────────────────────
    if (sub === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const staffRole = interaction.options.getRole('staff-role');

      // Staff-only permissions for auto-created channels
      const staffOnlyPerms = [
        {
          id: interaction.guildId, // @everyone — hidden
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: staffRole.id, // Staff role — can view
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: interaction.client.user.id, // Bot — can send
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ];

      // Auto-create ticket log channel
      const logChannel = await interaction.guild.channels.create({
        name: '📋-ticket-logs',
        type: ChannelType.GuildText,
        permissionOverwrites: staffOnlyPerms,
        reason: 'Ticket system setup — log channel',
      });

      // Auto-create transcript channel
      const transcriptChannel = await interaction.guild.channels.create({
        name: '📝-transcripts',
        type: ChannelType.GuildText,
        permissionOverwrites: staffOnlyPerms,
        reason: 'Ticket system setup — transcript channel',
      });

      // Auto-create sales log channel
      const salesChannel = await interaction.guild.channels.create({
        name: '💰-sales-log',
        type: ChannelType.GuildText,
        permissionOverwrites: staffOnlyPerms,
        reason: 'Ticket system setup — sales log channel',
      });

      const stmt = db.prepare(`
        INSERT INTO ticket_settings (guild_id, staff_role_id, log_channel_id, transcript_channel_id, sales_channel_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
          staff_role_id = excluded.staff_role_id,
          log_channel_id = excluded.log_channel_id,
          transcript_channel_id = excluded.transcript_channel_id,
          sales_channel_id = excluded.sales_channel_id
      `);
      stmt.run(
        interaction.guildId,
        staffRole.id,
        logChannel.id,
        transcriptChannel.id,
        salesChannel.id
      );

      await interaction.editReply({
        content: `✅ Ticket system configured!\n\n👥 **Staff Role:** ${staffRole}\n📋 **Log Channel:** ${logChannel} (auto-created, staff only)\n📝 **Transcripts:** ${transcriptChannel} (auto-created, staff only)\n💰 **Sales Log:** ${salesChannel} (auto-created, staff only)\n\n🔒 All channels are only visible to **${staffRole.name}** and admins.\n\nNext: Add categories with \`/ticket category\` then create a panel with \`/ticket panel\``,
      });
    }

    // ─── Category ───────────────────────────────────────────────────────
    if (sub === 'category') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const name = interaction.options.getString('name');
      const ticketType = interaction.options.getString('type') || 'support';
      const rawEmoji = interaction.options.getString('emoji') || '';
      // Strip custom Discord emojis (<:name:id> or <a:name:id>), keep only unicode
      const emoji = rawEmoji.replace(/<a?:[^:]+:\d+>/g, '').trim();
      const description = interaction.options.getString('description') || '';
      const staffRole = interaction.options.getRole('staff-role');
      const welcomeMessage = interaction.options.getString('welcome-message') || '';

      // Get the ticket staff role (from setup or override)
      const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
      const staffRoleId = staffRole ? staffRole.id : (ticketSettings ? ticketSettings.staff_role_id : '');

      // Auto-create a Discord category (folder) for this ticket type
      const categoryPerms = [
        {
          id: interaction.guildId,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ];

      if (staffRoleId) {
