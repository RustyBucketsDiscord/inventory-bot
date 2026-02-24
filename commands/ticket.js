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
        .addStringOption(opt => opt.setName('color').setDescription('Panel color (name or hex)').setRequired(false))
        .addBooleanOption(opt => opt.setName('blank').setDescription('Start with blank panel (no buttons)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('panel-list')
        .setDescription('List all ticket panels in this server')
    )
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
      sub.setName('button-modal')
        .setDescription('Manage buttons via popup form (add/edit/remove)')
        .addIntegerOption(opt => opt.setName('panel-id').setDescription('Panel ID to manage buttons for').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('category')
        .setDescription('Add a ticket category (auto-creates a Discord folder for it)')
        .addStringOption(opt => opt.setName('name').setDescription('Category name').setRequired(true))
        .addStringOption(opt => opt.setName('type').setDescription('Ticket type').setRequired(false)
          .addChoices(
            { name: '🛒 Purchase (shows product dropdown)', value: 'purchase' },
            { name: '💬 Support (general support)', value: 'support' },
          ))
        .addStringOption(opt => opt.setName('emoji').setDescription('Button emoji (unicode only, e.g. 💰)').setRequired(false))
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

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const sub = interaction.options.getSubcommand();
    
    if (sub === 'category-edit' || sub === 'category-remove' || 
        sub === 'button-add' || sub === 'button-remove' || sub === 'button-edit' ||
        sub === 'edit-category') {
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

      // Use only the name for the folder (no emoji, no "Tickets" suffix)
      const folderName = name.slice(0, 100);
      const discordCategory = await interaction.guild.channels.create({
        name: folderName,
        type: ChannelType.GuildCategory,
        permissionOverwrites: categoryPerms,
        reason: `Ticket category: ${name}`,
      });

      // Add ticket_type column if it doesn't exist
      try { db.prepare('ALTER TABLE ticket_categories ADD COLUMN ticket_type TEXT DEFAULT "support"').run(); } catch (_) {}

      const stmt = db.prepare(`
        INSERT INTO ticket_categories (guild_id, name, description, emoji, category_channel_id, staff_role_ids, welcome_message, ticket_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        interaction.guildId,
        name,
        description,
        emoji,
        discordCategory.id,
        staffRoleId,
        welcomeMessage,
        ticketType
      );

      const typeLabel = ticketType === 'purchase' ? '🛒 Purchase (shows product dropdown)' : '💬 Support';
      await interaction.editReply({
        content: `✅ Category **${emoji ? emoji + ' ' : ''}${name}** added!\n📁 Discord folder: **${folderName}** (auto-created)\n🎫 Type: ${typeLabel}\n${staffRoleId ? `👥 Staff: <@&${staffRoleId}>\n` : ''}\nNow run \`/ticket panel\` to update your panel.`,
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
      const colorInput = interaction.options.getString('color');
      const blank = interaction.options.getBoolean('blank') || false;

      const channel = await interaction.client.channels.fetch(channelOption.id);
      const color = parseColor(colorInput) || 0x5865f2;

      // Create panel in DB (include blank flag)
      const panelStmt = db.prepare('INSERT INTO ticket_panels (guild_id, channel_id, title, description, color, blank) VALUES (?, ?, ?, ?, ?, ?)');
      const panelResult = panelStmt.run(interaction.guildId, channel.id, title, description, colorInput || '#5865f2', blank ? 1 : 0);
      const panelId = panelResult.lastInsertRowid;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

      let rows = [];
      let categories = [];
      
      if (!blank) {
        // Auto-add buttons for all categories (original behavior)
        categories = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY id').all(interaction.guildId);
        
        if (categories.length === 0) {
          return interaction.reply({
            content: '❌ No ticket categories found. Add some first with `/ticket category`',
            ephemeral: true,
          });
        }

        // Link categories to panel (for auto-added buttons)
        const linkStmt = db.prepare('UPDATE ticket_categories SET panel_id = ? WHERE guild_id = ? AND panel_id IS NULL');
        linkStmt.run(panelId, interaction.guildId);

        // Add category descriptions to embed
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

          rows = [new ActionRowBuilder().addComponents(selectMenu)];
        }

        // Create button entries in ticket_panel_buttons table for auto-added buttons
        for (const cat of categories.slice(0, 25)) {
          db.prepare(`
            INSERT INTO ticket_panel_buttons (panel_id, category_id, custom_label, custom_emoji, button_style, button_order)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(panelId, cat.id, '', cat.emoji, 'Primary', cat.id);
        }
      } else {
        // Blank panel - no buttons initially
        embed.addFields({ name: 'ℹ️ Note', value: 'This panel has no buttons yet. Use `/ticket button-add` to add buttons.' });
      }

      const msg = await channel.send({ embeds: [embed], components: rows });

      // Save message ID
      db.prepare('UPDATE ticket_panels SET message_id = ? WHERE id = ?').run(msg.id, panelId);

      const blankText = blank ? ' (blank - no buttons)' : '';
      await interaction.reply({
        content: `✅ Ticket panel created in ${channel}! Panel ID: **${panelId}**${blankText}`,
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

      // Staff can close immediately, ticket owners need confirmation
      if (isStaff) {
        // Staff instant close
        await interaction.deferReply({ ephemeral: true });
        
        // Call the close function directly
        const { db } = require('../utils/database');
        const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
        
        // Close the ticket (similar to ticket_close_confirm logic)
        db.prepare('UPDATE tickets SET status = ?, closed_at = datetime("now") WHERE id = ?').run('closed', ticket.id);
        
        // Log to transcript channel if available
        if (ticketSettings && ticketSettings.transcript_channel_id) {
          try {
            const transcriptChannel = await interaction.client.channels.fetch(ticketSettings.transcript_channel_id);
            const transcriptEmbed = new EmbedBuilder()
              .setTitle(`🎫 Ticket #${ticket.id} — Closed`)
              .setDescription(`**Reason:** ${reason}\n**Closed by:** ${interaction.user.tag} (Staff)`)
              .addFields(
                { name: 'User', value: `<@${ticket.user_id}>`, inline: true },
                { name: 'Channel', value: `<#${ticket.channel_id}>`, inline: true },
                { name: 'Opened', value: `<t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:R>`, inline: true },
              )
              .setColor(0xff0000)
              .setTimestamp();
            
            await transcriptChannel.send({ embeds: [transcriptEmbed] });
          } catch (e) {}
        }
        
        // Delete the channel
        try {
          const channel = await interaction.client.channels.fetch(ticket.channel_id);
          await channel.delete(`Ticket closed by staff: ${interaction.user.tag}`);
        } catch (e) {
          await interaction.editReply({ content: `✅ Ticket #${ticket.id} closed (but could not delete channel).` });
          return;
        }
        
        await interaction.editReply({ content: `✅ Ticket #${ticket.id} closed instantly by staff.` });
        return;
      } else {
        // Ticket owner needs confirmation
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ticket_close_confirm:${ticket.id}`).setLabel('✅ Close Ticket').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({
          content: `⚠️ Are you sure you want to close this ticket?\n📝 Reason: ${reason}`,
          components: [row],
        });
      }
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
            .setCustomId('ticket_type')
            .setLabel('Ticket Type (purchase or support)')
            .setPlaceholder('purchase')
            .setValue(category.ticket_type || 'support')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
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

      // Get buttons from the new button table (with category info)
      const buttons = db.prepare(`
        SELECT b.*, c.name as category_name, c.emoji as category_emoji, c.description as category_description, c.ticket_type
        FROM ticket_panel_buttons b
        JOIN ticket_categories c ON b.category_id = c.id
        WHERE b.panel_id = ?
        ORDER BY b.button_order
      `).all(panel.id);

      const embed = new EmbedBuilder()
        .setTitle(panel.title || '🎫 Support Tickets')
        .setDescription(panel.description || 'Click a button below to open a ticket.')
        .setColor(parseColor(panel.color) || 0x5865f2)
        .setTimestamp();

      // Show button info in embed
      if (buttons.length > 0) {
        const buttonList = buttons.map(b => {
          const label = b.custom_label || b.category_name;
          const emoji = b.custom_emoji || b.category_emoji || '';
          return `${emoji} **${label}** — ${b.category_description || 'Open a ticket'}`;
        }).join('\n');
        embed.addFields({ name: 'Available Tickets', value: buttonList });
      } else if (panel.blank) {
        embed.addFields({ name: 'ℹ️ Note', value: 'This panel has no buttons yet. Use `/ticket button-add` to add buttons.' });
      } else {
        embed.addFields({ name: 'ℹ️ Note', value: 'No buttons configured. Use `/ticket button-add` to add buttons.' });
      }

      let rows = [];
      if (buttons.length > 0) {
        if (buttons.length <= 5) {
          // Create buttons from the button table
          const buttonComponents = buttons.slice(0, 5).map(b => {
            const label = b.custom_label || b.category_name;
            const emoji = b.custom_emoji || b.category_emoji || '';
            const styleMap = {
              'Primary': ButtonStyle.Primary,
              'Secondary': ButtonStyle.Secondary,
              'Success': ButtonStyle.Success,
              'Danger': ButtonStyle.Danger,
              'Link': ButtonStyle.Link
            };
            return new ButtonBuilder()
              .setCustomId(`ticket_open:${b.category_id}`)
              .setLabel(label.slice(0, 80))
              .setEmoji(parseEmoji(emoji))
              .setStyle(styleMap[b.button_style] || ButtonStyle.Primary);
          });
          
          // Group buttons into rows (max 5 per row)
          for (let i = 0; i < buttonComponents.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttonComponents.slice(i, i + 5)));
          }
        } else {
          // Use select menu for more than 5 buttons
          const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('ticket_open_select')
            .setPlaceholder('Select a ticket category')
            .addOptions(buttons.slice(0, 25).map(b => {
              const label = b.custom_label || b.category_name;
              const emoji = b.custom_emoji || b.category_emoji || '';
              return {
                label: label.slice(0, 100),
                description: (b.category_description || 'Open a ticket').slice(0, 100),
                emoji: emoji,
                value: String(b.category_id),
              };
            }));
          rows = [new ActionRowBuilder().addComponents(selectMenu)];
        }
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

    // ─── Panel List ──────────────────────────────────────────────────────
    if (sub === 'panel-list') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const panels = db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id').all(interaction.guildId);
      if (panels.length === 0) {
        return interaction.reply({ content: '❌ No ticket panels found. Create one with `/ticket panel`.', ephemeral: true });
      }

      const panelList = panels.map(p => {
        const channelMention = `<#${p.channel_id}>`;
        const buttonCount = db.prepare('SELECT COUNT(*) as count FROM ticket_panel_buttons WHERE panel_id = ?').get(p.id).count;
        return `**ID: ${p.id}** — ${p.title}\n   📍 ${channelMention} | 🎫 ${buttonCount} buttons | ${p.blank ? 'Blank' : 'Auto-filled'}`;
      }).join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle('📋 Ticket Panels')
        .setDescription(panelList)
        .setColor(0x5865f2)
        .setFooter({ text: 'Use /ticket button-add <panel-id> to add buttons to a panel' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ─── Button Add ──────────────────────────────────────────────────────
    if (sub === 'button-add') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const panelId = interaction.options.getInteger('panel-id');
      const categoryName = interaction.options.getString('category');
      const customLabel = interaction.options.getString('label');
      const customEmoji = interaction.options.getString('emoji') || '';
      const buttonStyle = interaction.options.getString('style') || 'Primary';

      // Check if panel exists
      const panel = db.prepare('SELECT * FROM ticket_panels WHERE id = ? AND guild_id = ?').get(panelId, interaction.guildId);
      if (!panel) {
        return interaction.reply({ content: `❌ Panel ID ${panelId} not found. Use /ticket panel-list to see available panels.`, ephemeral: true });
      }

      // Find category
      const category = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? AND LOWER(name) = LOWER(?)').get(interaction.guildId, categoryName);
      if (!category) {
        return interaction.reply({ content: `❌ Category "${categoryName}" not found.`, ephemeral: true });
      }

      // Check if button already exists for this category on this panel
      const existing = db.prepare('SELECT * FROM ticket_panel_buttons WHERE panel_id = ? AND category_id = ?').get(panelId, category.id);
      if (existing) {
        return interaction.reply({ content: `❌ A button for "${categoryName}" already exists on panel ${panelId}. Use /ticket button-edit instead.`, ephemeral: true });
      }

      // Get next order value
      const maxOrder = db.prepare('SELECT MAX(button_order) as max FROM ticket_panel_buttons WHERE panel_id = ?').get(panelId).max || 0;

      // Add button to database
      db.prepare(`
        INSERT INTO ticket_panel_buttons (panel_id, category_id, custom_label, custom_emoji, button_style, button_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(panelId, category.id, customLabel || '', customEmoji, buttonStyle, maxOrder + 1);

      // Update panel to show it's no longer blank
      if (panel.blank) {
        db.prepare('UPDATE ticket_panels SET blank = 0 WHERE id = ?').run(panelId);
      }

      await interaction.reply({ 
        content: `✅ Button added to panel ${panelId}!\n\n**Category:** ${category.emoji} ${category.name}\n**Label:** ${customLabel || category.name}\n**Emoji:** ${customEmoji || category.emoji || 'None'}\n**Style:** ${buttonStyle}\n\nUse /ticket panel-refresh to update the panel.`, 
        ephemeral: true 
      });
    }

    // ─── Button Remove ───────────────────────────────────────────────────
    if (sub === 'button-remove') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const panelId = interaction.options.getInteger('panel-id');
      const categoryName = interaction.options.getString('category');

      // Check if panel exists
      const panel = db.prepare('SELECT * FROM ticket_panels WHERE id = ? AND guild_id = ?').get(panelId, interaction.guildId);
      if (!panel) {
        return interaction.reply({ content: `❌ Panel ID ${panelId} not found.`, ephemeral: true });
      }

      // Find category
      const category = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? AND LOWER(name) = LOWER(?)').get(interaction.guildId, categoryName);
      if (!category) {
        return interaction.reply({ content: `❌ Category "${categoryName}" not found.`, ephemeral: true });
      }

      // Remove button
      const result = db.prepare('DELETE FROM ticket_panel_buttons WHERE panel_id = ? AND category_id = ?').run(panelId, category.id);

      if (result.changes > 0) {
        await interaction.reply({ 
          content: `✅ Button for "${categoryName}" removed from panel ${panelId}.\n\nUse /ticket panel-refresh to update the panel.`, 
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: `❌ No button found for "${categoryName}" on panel ${panelId}.`, 
          ephemeral: true 
        });
      }
    }

    // ─── Button Edit ─────────────────────────────────────────────────────
    if (sub === 'button-edit') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const panelId = interaction.options.getInteger('panel-id');
      const categoryName = interaction.options.getString('category');
      const newLabel = interaction.options.getString('label');
      const newEmoji = interaction.options.getString('emoji');
      const newStyle = interaction.options.getString('style');

      // Check if panel exists
      const panel = db.prepare('SELECT * FROM ticket_panels WHERE id = ? AND guild_id = ?').get(panelId, interaction.guildId);
      if (!panel) {
        return interaction.reply({ content: `❌ Panel ID ${panelId} not found.`, ephemeral: true });
      }

      // Find category
      const category = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? AND LOWER(name) = LOWER(?)').get(interaction.guildId, categoryName);
      if (!category) {
        return interaction.reply({ content: `❌ Category "${categoryName}" not found.`, ephemeral: true });
      }

      // Find existing button
      const button = db.prepare('SELECT * FROM ticket_panel_buttons WHERE panel_id = ? AND category_id = ?').get(panelId, category.id);
      if (!button) {
        return interaction.reply({ content: `❌ No button found for "${categoryName}" on panel ${panelId}. Use /ticket button-add first.`, ephemeral: true });
      }

      // Update button
      const updates = [];
      const params = [];
      
      if (newLabel !== null) {
        updates.push('custom_label = ?');
        params.push(newLabel || '');
      }
      
      if (newEmoji !== null) {
        updates.push('custom_emoji = ?');
        params.push(newEmoji || '');
      }
      
      if (newStyle !== null) {
        updates.push('button_style = ?');
        params.push(newStyle);
      }

      if (updates.length > 0) {
        params.push(panelId, category.id);
        const query = `UPDATE ticket_panel_buttons SET ${updates.join(', ')} WHERE panel_id = ? AND category_id = ?`;
        db.prepare(query).run(...params);
      }

      const changes = [];
      if (newLabel !== null) changes.push(`**Label:** ${newLabel || 'Reset to category name'}`);
      if (newEmoji !== null) changes.push(`**Emoji:** ${newEmoji || 'Reset to category emoji'}`);
      if (newStyle !== null) changes.push(`**Style:** ${newStyle}`);

      await interaction.reply({ 
        content: `✅ Button for "${categoryName}" updated on panel ${panelId}.\n\n${changes.join('\n')}\n\nUse /ticket panel-refresh to update the panel.`, 
        ephemeral: true 
      });
    }

    // ─── Button List ─────────────────────────────────────────────────────
    if (sub === 'button-list') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const panelId = interaction.options.getInteger('panel-id');

      // Check if panel exists
      const panel = db.prepare('SELECT * FROM ticket_panels WHERE id = ? AND guild_id = ?').get(panelId, interaction.guildId);
      if (!panel) {
        return interaction.reply({ content: `❌ Panel ID ${panelId} not found. Use /ticket panel-list to see available panels.`, ephemeral: true });
      }

      // Get buttons with category info
      const buttons = db.prepare(`
        SELECT b.*, c.name as category_name, c.emoji as category_emoji, c.ticket_type
        FROM ticket_panel_buttons b
        JOIN ticket_categories c ON b.category_id = c.id
        WHERE b.panel_id = ?
        ORDER BY b.button_order
      `).all(panelId);

      if (buttons.length === 0) {
        return interaction.reply({ 
          content: `❌ No buttons found on panel ${panelId}. This panel is blank.\n\nUse /ticket button-add to add buttons.`, 
          ephemeral: true 
        });
      }

      const buttonList = buttons.map(b => {
        const label = b.custom_label || b.category_name;
        const emoji = b.custom_emoji || b.category_emoji || '';
        const styleEmoji = {
          'Primary': '🔵',
          'Secondary': '⚪',
          'Success': '🟢',
          'Danger': '🔴',
          'Link': '🔗'
        }[b.button_style] || '🔘';
        
        return `${styleEmoji} **${label}** ${emoji}\n   📁 ${b.category_name} | 🎫 ${b.ticket_type} | Order: ${b.button_order}`;
      }).join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle(`🎫 Buttons on Panel #${panelId}`)
        .setDescription(buttonList)
        .setColor(0x5865f2)
        .setFooter({ text: `Panel: ${panel.title} in #${panel.channel_id}` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ─── Button Modal (popup form for adding/editing buttons) ──────────────
    if (sub === 'button-modal') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: '❌ You need Manage Server permission.', ephemeral: true });
      }

      const panelId = interaction.options.getInteger('panel-id');

      // Check if panel exists
      const panel = db.prepare('SELECT * FROM ticket_panels WHERE id = ? AND guild_id = ?').get(panelId, interaction.guildId);
      if (!panel) {
        return interaction.reply({ content: `❌ Panel ID ${panelId} not found. Use /ticket panel-list to see available panels.`, ephemeral: true });
      }

      // Get available categories
      const categories = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY name').all(interaction.guildId);
      if (categories.length === 0) {
        return interaction.reply({ 
          content: '❌ No ticket categories found. Add some first with `/ticket category`.', 
          ephemeral: true 
        });
      }

      // Create modal for adding a button
      const modal = new ModalBuilder()
        .setCustomId(`button_add_modal:${panelId}`)
        .setTitle(`✏️ Add Button to Panel #${panelId}`);

      // Category selection as text input (list categories in placeholder)
      const categoryOptions = categories.map(c => `${c.emoji} ${c.name}`).join(', ');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('category_name')
            .setLabel('Category Name')
            .setPlaceholder(`e.g. Purchase, Support, etc. Available: ${categoryOptions.slice(0, 100)}...`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('custom_label')
            .setLabel('Custom Button Label (optional)')
            .setPlaceholder('Leave empty to use category name')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(80)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('custom_emoji')
            .setLabel('Custom Emoji (optional)')
            .setPlaceholder('e.g. 🛒, ❓, 🔥')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('button_style')
            .setLabel('Button Style (Primary/Secondary/Success/Danger/Link)')
            .setPlaceholder('Primary')
            .setValue('Primary')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(20)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('button_order')
            .setLabel('Button Order (number, optional)')
            .setPlaceholder('1, 2, 3... Leave empty for auto')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(3)
        ),
      );

      await interaction.showModal(modal);
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
