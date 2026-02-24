const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { settings } = require('../utils/database');
const { db } = require('../utils/database');
const { parseEmoji } = require('../utils/helpers');

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (panel_id) REFERENCES ticket_panels(id) ON DELETE CASCADE
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

// Add sales_channel_id column if it doesn't exist (migration for existing DBs)
try {
  db.exec(`ALTER TABLE ticket_settings ADD COLUMN sales_channel_id TEXT DEFAULT ''`);
} catch (e) {
  // Column already exists
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system management')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Initial ticket system setup (auto-creates log + transcript channels)')
        .addRoleOption(opt => opt.setName('staff-role').setDescription('Role that can manage tickets').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('panel')
        .setDescription('Create a ticket panel (embed with buttons)')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post the panel in').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('title').setDescription('Panel title').setRequired(false))
        .addStringOption(opt => opt.setName('description').setDescription('Panel description').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('category')
        .setDescription('Add a ticket category (auto-creates a Discord folder for it)')
        .addStringOption(opt => opt.setName('name').setDescription('Category name').setRequired(true))
        .addStringOption(opt => opt.setName('emoji').setDescription('Button emoji').setRequired(false))
        .addStringOption(opt => opt.setName('description').setDescription('Category description').setRequired(false))
        .addRoleOption(opt => opt.setName('staff-role').setDescription('Override staff role for this category').setRequired(false))
        .addStringOption(opt => opt.setName('welcome-message').setDescription('Message sent when ticket opens').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('category-remove')
        .setDescription('Remove a ticket category')
        .addStringOption(opt => opt.setName('name').setDescription('Category name to remove').setRequired(true))
    )
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
    .addSubcommand(sub =>
      sub.setName('edit-panel')
        .setDescription('Edit ticket panel — opens a popup form')
    )
    .addSubcommand(sub =>
      sub.setName('edit-category')
        .setDescription('Edit a ticket category/button — opens a popup form')
        .addStringOption(opt => opt.setName('name').setDescription('Name of category to edit').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('panel-refresh')
        .setDescription('Refresh/resend the ticket panel with current categories')
    )
    .setDefaultMemberPermissions(null), // Allow everyone to use /ticket close etc, permission checks in code

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
      const emoji = interaction.options.getString('emoji') || '🎫';
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
        categoryPerms.push({
          id: staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.AttachFiles,
          ],
        });
      }

      const discordCategory = await interaction.guild.channels.create({
        name: `${emoji} ${name} Tickets`,
        type: ChannelType.GuildCategory,
        permissionOverwrites: categoryPerms,
        reason: `Ticket category: ${name}`,
      });

      const stmt = db.prepare(`
        INSERT INTO ticket_categories (guild_id, name, description, emoji, category_channel_id, staff_role_ids, welcome_message)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        interaction.guildId,
        name,
        description,
        emoji,
        discordCategory.id,
        staffRoleId,
        welcomeMessage
      );

      await interaction.editReply({
        content: `✅ Category **${emoji} ${name}** added!\n📁 Discord folder: **${discordCategory.name}** (auto-created)\n${description ? `📝 ${description}\n` : ''}${staffRoleId ? `👥 Staff: <@&${staffRoleId}>\n` : ''}\nTickets in this category will be created inside that folder.\nNow create/update a panel with \`/ticket panel\` to show it.`,
      });
    }

    // ─── Category Remove ────────────────────────────────────────────────
    if (sub === 'category-remove') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const name = interaction.options.getString('name');
      const result = db.prepare('DELETE FROM ticket_categories WHERE guild_id = ? AND name = ?').run(interaction.guildId, name);

      if (result.changes > 0) {
        await interaction.reply({ content: `✅ Category **${name}** removed.`, ephemeral: true });
      } else {
        await interaction.reply({ content: `❌ Category **${name}** not found.`, ephemeral: true });
      }
    }

    // ─── Panel ──────────────────────────────────────────────────────────
    if (sub === 'panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const channelOption = interaction.options.getChannel('channel');
      const title = interaction.options.getString('title') || '🎫 Support Tickets';
      const description = interaction.options.getString('description') || 'Click a button below to open a ticket.';

      const channel = await interaction.client.channels.fetch(channelOption.id);

      const categories = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY id').all(interaction.guildId);

      if (categories.length === 0) {
        return interaction.reply({
          content: '❌ No ticket categories found. Add some first with `/ticket category`',
          ephemeral: true,
        });
      }

      // Create panel in DB
      const panelStmt = db.prepare('INSERT INTO ticket_panels (guild_id, channel_id, title, description) VALUES (?, ?, ?, ?)');
      const panelResult = panelStmt.run(interaction.guildId, channel.id, title, description);
      const panelId = panelResult.lastInsertRowid;

      // Link categories to panel
      const linkStmt = db.prepare('UPDATE ticket_categories SET panel_id = ? WHERE guild_id = ? AND panel_id IS NULL');
      linkStmt.run(panelId, interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0x5865f2)
        .setTimestamp();

      // Add category descriptions
      const catLines = categories.map(c => `${c.emoji} **${c.name}**${c.description ? ` — ${c.description}` : ''}`);
      if (catLines.length > 0) {
        embed.addFields({ name: 'Categories', value: catLines.join('\n') });
      }

      // Create buttons for each category
      const buttons = categories.slice(0, 5).map(c =>
        new ButtonBuilder()
          .setCustomId(`ticket_open:${c.id}`)
          .setLabel(c.name)
          .setEmoji(parseEmoji(c.emoji))
          .setStyle(ButtonStyle.Primary)
      );

      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }

      // If more than 5 categories, use a select menu instead
      if (categories.length > 5) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`ticket_open_select`)
          .setPlaceholder('Select a ticket category')
          .addOptions(categories.slice(0, 25).map(c => ({
            label: c.name,
            description: (c.description || 'Open a ticket').slice(0, 100),
            emoji: c.emoji,
            value: String(c.id),
          })));

        rows.length = 0; // Clear buttons
        rows.push(new ActionRowBuilder().addComponents(selectMenu));
      }

      const msg = await channel.send({ embeds: [embed], components: rows });

      // Save message ID
      db.prepare('UPDATE ticket_panels SET message_id = ? WHERE id = ?').run(msg.id, panelId);

      await interaction.reply({
        content: `✅ Ticket panel created in ${channel}!`,
        ephemeral: true,
      });
    }

    // ─── Close ──────────────────────────────────────────────────────────
    if (sub === 'close') {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ? AND status = ?')
        .get(interaction.channelId, interaction.guildId, 'open');

      if (!ticket) {
        return interaction.reply({ content: '❌ This is not an open ticket channel.', ephemeral: true });
      }

      // Check permissions — ticket owner or staff
      const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
      const isTicketOwner = interaction.user.id === ticket.user_id;
      const isStaff = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        (ticketSettings && ticketSettings.staff_role_id && interaction.member.roles.cache.has(ticketSettings.staff_role_id));

      if (!isTicketOwner && !isStaff) {
        return interaction.reply({ content: '❌ Only the ticket owner or staff can close this ticket.', ephemeral: true });
      }

      const reason = interaction.options.getString('reason') || 'No reason provided';

      // Confirm close
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_close_confirm:${ticket.id}`).setLabel('✅ Close Ticket').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({
        content: `⚠️ Are you sure you want to close this ticket?\n📝 Reason: ${reason}`,
        components: [row],
      });
    }

    // ─── Claim ──────────────────────────────────────────────────────────
    if (sub === 'claim') {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ? AND status = ?')
        .get(interaction.channelId, interaction.guildId, 'open');

      if (!ticket) {
        return interaction.reply({ content: '❌ This is not an open ticket channel.', ephemeral: true });
      }

      if (ticket.claimed_by) {
        return interaction.reply({ content: `❌ This ticket is already claimed by <@${ticket.claimed_by}>.`, ephemeral: true });
      }

      db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run(interaction.user.id, ticket.id);

      const embed = new EmbedBuilder()
        .setDescription(`🙋 **${interaction.user.displayName}** claimed this ticket.`)
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      // Log it
      await logTicketAction(interaction, ticket, 'claimed', `Claimed by ${interaction.user.tag}`);
    }

    // ─── Unclaim ────────────────────────────────────────────────────────
    if (sub === 'unclaim') {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ? AND status = ?')
        .get(interaction.channelId, interaction.guildId, 'open');

      if (!ticket) {
        return interaction.reply({ content: '❌ This is not an open ticket channel.', ephemeral: true });
      }

      db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?').run('', ticket.id);

      await interaction.reply({ content: '🔓 Ticket unclaimed. Anyone can pick it up.' });
    }

    // ─── Add User ───────────────────────────────────────────────────────
    if (sub === 'add') {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ? AND status = ?')
        .get(interaction.channelId, interaction.guildId, 'open');

      if (!ticket) {
        return interaction.reply({ content: '❌ This is not an open ticket channel.', ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });

      await interaction.reply({ content: `✅ Added ${user} to this ticket.` });
    }

    // ─── Remove User ────────────────────────────────────────────────────
    if (sub === 'remove') {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ? AND status = ?')
        .get(interaction.channelId, interaction.guildId, 'open');

      if (!ticket) {
        return interaction.reply({ content: '❌ This is not an open ticket channel.', ephemeral: true });
      }

      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.edit(user.id, {
        ViewChannel: false,
      });

      await interaction.reply({ content: `✅ Removed ${user} from this ticket.` });
    }

    // ─── Rename ─────────────────────────────────────────────────────────
    if (sub === 'rename') {
      const ticket = db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ? AND status = ?')
        .get(interaction.channelId, interaction.guildId, 'open');

      if (!ticket) {
        return interaction.reply({ content: '❌ This is not an open ticket channel.', ephemeral: true });
      }

      const newName = interaction.options.getString('name');
      await interaction.channel.setName(newName);
      await interaction.reply({ content: `✅ Ticket renamed to **${newName}**` });
    }

    // ─── Auto Close ─────────────────────────────────────────────────────
    if (sub === 'auto-close') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const hours = interaction.options.getInteger('hours');

      db.prepare(`
        INSERT INTO ticket_settings (guild_id, auto_close_hours)
        VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET auto_close_hours = excluded.auto_close_hours
      `).run(interaction.guildId, hours);

      if (hours === 0) {
        await interaction.reply({ content: '✅ Auto-close disabled.', ephemeral: true });
      } else {
        await interaction.reply({ content: `✅ Tickets will auto-close after **${hours} hour(s)** of inactivity.`, ephemeral: true });
      }
    }

    // ─── Edit Panel (opens modal popup) ──────────────────────────────────
    if (sub === 'edit-panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const panels = db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id DESC').all(interaction.guildId);
      if (panels.length === 0) {
        return interaction.reply({ content: '❌ No ticket panels found. Create one with `/ticket panel`.', ephemeral: true });
      }

      const panel = panels[0]; // Most recent panel

      const modal = new ModalBuilder()
        .setCustomId(`panel_edit_modal:${panel.id}`)
        .setTitle('✏️ Edit Ticket Panel');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('title')
            .setLabel('Title')
            .setPlaceholder('🎫 Support Tickets')
            .setValue(panel.title || '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description')
            .setPlaceholder('Click a button below to open a ticket.')
            .setValue(panel.description || '')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('color')
            .setLabel('Color (name or hex: red, blue, #ff0000)')
            .setPlaceholder('blurple, red, gold, purple, #ff6600...')
            .setValue(panel.color || '#5865f2')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(20)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('image')
            .setLabel('Image URL (large banner at bottom)')
            .setPlaceholder('https://example.com/banner.png')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('thumbnail')
            .setLabel('Thumbnail URL (small image top-right)')
            .setPlaceholder('https://example.com/logo.png')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
      );

      await interaction.showModal(modal);
    }

    // ─── Edit Category (opens modal popup) ────────────────────────────────
    if (sub === 'edit-category') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const catName = interaction.options.getString('name');
      const category = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? AND LOWER(name) = LOWER(?)').get(interaction.guildId, catName);

      if (!category) {
        return interaction.reply({ content: `❌ Category **${catName}** not found.`, ephemeral: true });
      }

      const modal = new ModalBuilder()
        .setCustomId(`category_edit_modal:${category.id}`)
        .setTitle(`✏️ Edit — ${category.name}`);

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Category Name')
            .setPlaceholder('Purchase')
            .setValue(category.name || '')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('Description')
            .setPlaceholder('Buy products from our store')
            .setValue(category.description || '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('emoji')
            .setLabel('Button Emoji')
            .setPlaceholder('🛒')
            .setValue(category.emoji || '🎫')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('welcome')
            .setLabel('Welcome Message (sent when ticket opens)')
            .setPlaceholder('Welcome! How can we help you today?')
            .setValue(category.welcome_message || '')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
        ),
      );

      await interaction.showModal(modal);
    }

    // ─── Panel Refresh ──────────────────────────────────────────────────────
    if (sub === 'panel-refresh') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const panel = db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id DESC LIMIT 1').get(interaction.guildId);
      if (!panel) return interaction.reply({ content: '❌ No panel found. Create one with `/ticket panel` first.', ephemeral: true });

      const categories = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY id').all(interaction.guildId);
      if (categories.length === 0) return interaction.reply({ content: '❌ No categories found. Add some with `/ticket category`.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle(panel.title || '🎫 Support Tickets')
        .setDescription(panel.description || 'Click a button below to open a ticket.')
        .setColor(parseColor(panel.color) || 0x5865f2)
        .setTimestamp();

      const catLines = categories.map(c => `${c.emoji} **${c.name}**${c.description ? ` — ${c.description}` : ''}`);
      if (catLines.length > 0) embed.addFields({ name: 'Categories', value: catLines.join('\n') });

      let rows = [];
      if (categories.length <= 5) {
        const buttons = categories.slice(0, 5).map(c =>
          new ButtonBuilder()
            .setCustomId(`ticket_open:${c.id}`)
            .setLabel(c.name)
            .setEmoji(parseEmoji(c.emoji))
            .setStyle(ButtonStyle.Primary)
        );
        rows = [new ActionRowBuilder().addComponents(buttons)];
      } else {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('ticket_open_select')
          .setPlaceholder('Select a ticket category')
          .addOptions(categories.slice(0, 25).map(c => ({
            label: c.name,
            description: (c.description || 'Open a ticket').slice(0, 100),
            emoji: c.emoji,
            value: String(c.id),
          })));
        rows = [new ActionRowBuilder().addComponents(selectMenu)];
      }

      try {
        const channel = await interaction.client.channels.fetch(panel.channel_id);
        if (panel.message_id) {
          try {
            const msg = await channel.messages.fetch(panel.message_id);
            await msg.edit({ embeds: [embed], components: rows });
            return interaction.reply({ content: '✅ Panel updated!', ephemeral: true });
          } catch (_) {}
        }
        const msg = await channel.send({ embeds: [embed], components: rows });
        db.prepare('UPDATE ticket_panels SET message_id = ? WHERE id = ?').run(msg.id, panel.id);
        return interaction.reply({ content: '✅ Panel reposted!', ephemeral: true });
      } catch (err) {
        return interaction.reply({ content: `❌ Failed to update panel: ${err.message}`, ephemeral: true });
      }
    }
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logTicketAction(interaction, ticket, action, details) {
  const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
  if (!ticketSettings || !ticketSettings.log_channel_id) return;

  try {
    const logChannel = await interaction.client.channels.fetch(ticketSettings.log_channel_id);
    const embed = new EmbedBuilder()
      .setTitle(`🎫 Ticket #${ticket.id} — ${action}`)
      .setDescription(details)
      .addFields(
        { name: 'User', value: `<@${ticket.user_id}>`, inline: true },
        { name: 'Channel', value: `<#${ticket.channel_id}>`, inline: true },
        { name: 'Staff', value: interaction.user.tag, inline: true },
      )
      .setColor(action === 'closed' ? 0xff0000 : action === 'claimed' ? 0x00ff00 : 0x5865f2)
      .setTimestamp();

    await logChannel.send({ embeds: [embed] });
  } catch (e) {}
}
