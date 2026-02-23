const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db, vendors, products, productSizes, paymentMethods } = require('../utils/database');
const { buildProductEmbed, formatPrice, parseEmoji } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vendor')
    .setDescription('Manage trusted vendors')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a trusted vendor — creates their private channels')
        .addUserOption(opt => opt.setName('user').setDescription('The vendor').setRequired(true))
        .addStringOption(opt => opt.setName('name').setDescription('Vendor/store name').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a trusted vendor')
        .addUserOption(opt => opt.setName('user').setDescription('The vendor to remove').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all trusted vendors')
    )
    .addSubcommand(sub =>
      sub.setName('panel')
        .setDescription('Create a Trusted Vendors panel for buyers')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to post the panel').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ─── Add Vendor ────────────────────────────────────────────────────
    if (sub === 'add') {
      await interaction.deferReply({ ephemeral: true });

      const user = interaction.options.getUser('user');
      const vendorName = interaction.options.getString('name');

      // Check if already a vendor
      const existing = vendors.getByUserId(user.id, interaction.guildId);
      if (existing) {
        return interaction.editReply({ content: `❌ <@${user.id}> is already a vendor (**${existing.name}**).` });
      }

      // Get staff role from ticket settings
      const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
      const staffRoleId = ticketSettings?.staff_role_id;

      // Category folder — visible to everyone (inherits server defaults)
      // Category folder — visible to everyone (inherits server defaults)
      const vendorCategory = await interaction.guild.channels.create({
        name: `🏪 ${vendorName}`,
        type: ChannelType.GuildCategory,
        reason: `Vendor setup for ${vendorName}`,
      });

      // Vendor's shop channel — everyone can VIEW, only vendor + bot can SEND
      const inventoryChannel = await interaction.guild.channels.create({
        name: `📦-${vendorName.toLowerCase().replace(/[^a-z0-9]/gi, '-')}-shop`,
        type: ChannelType.GuildText,
        parent: vendorCategory.id,
        permissionOverwrites: [
          { id: interaction.guildId, deny: ['SendMessages'], allow: ['ViewChannel', 'ReadMessageHistory'] },
          { id: user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles'] },
          { id: interaction.client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles'] },
        ],
        reason: `Vendor inventory for ${vendorName}`,
      });

      // Management channel — ONLY vendor + staff + bot (private)
      const mgmtPerms = [
        { id: interaction.guildId, deny: ['ViewChannel'] },
        { id: user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles'] },
        { id: interaction.client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles', 'ManageChannels'] },
      ];
      if (staffRoleId) {
        mgmtPerms.push({ id: staffRoleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
      }

      const mgmtChannel = await interaction.guild.channels.create({
        name: `⚙-${vendorName.toLowerCase().replace(/[^a-z0-9]/gi, '-')}-manage`,
        type: ChannelType.GuildText,
        parent: vendorCategory.id,
        permissionOverwrites: mgmtPerms,
        reason: `Vendor management for ${vendorName}`,
      });

      // Sales log — vendor can READ, staff can read, nobody else can see
      const salesPerms = [
        { id: interaction.guildId, deny: ['ViewChannel'] },
        { id: interaction.client.user.id, allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory'] },
        { id: user.id, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] },
      ];
      if (staffRoleId) {
        salesPerms.push({ id: staffRoleId, allow: ['ViewChannel', 'ReadMessageHistory'] });
      }

      const salesChannel = await interaction.guild.channels.create({
        name: `💰-${vendorName.toLowerCase().replace(/[^a-z0-9]/gi, '-')}-sales`,
        type: ChannelType.GuildText,
        parent: vendorCategory.id,
        permissionOverwrites: salesPerms,
        reason: `Vendor sales log for ${vendorName}`,
      });

      // Save vendor to DB
      const vendor = vendors.add(interaction.guildId, user.id, vendorName);
      vendors.updateChannels(vendor.id, interaction.guildId, mgmtChannel.id, salesChannel.id, inventoryChannel.id, vendorCategory.id);

      // Also create a ticket category for this vendor
      const catStmt = db.prepare(`
        INSERT INTO ticket_categories (guild_id, name, description, emoji, category_channel_id, staff_role_ids)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      catStmt.run(
        interaction.guildId,
        `${vendorName}`,
        `Buy from ${vendorName}`,
        '🏪',
        vendorCategory.id,
        staffRoleId || ''
      );

      // Send welcome message to management channel
      const welcomeEmbed = new EmbedBuilder()
        .setTitle(`🏪 Welcome, ${vendorName}!`)
        .setDescription(
          `This is your **management channel**. Use commands here to manage your store.\n\n` +
          `**Your Channels:**\n` +
          `📦 ${inventoryChannel} — Your products are displayed here (buyers can see)\n` +
          `⚙️ ${mgmtChannel} — Run commands here (private)\n` +
          `💰 ${salesChannel} — Your sales log (read-only)\n\n` +
          `**Commands you can use:**\n` +
          `\`/product-add\` — Add a product\n` +
          `\`/product-edit\` — Edit a product\n` +
          `\`/product-remove\` — Remove a product\n` +
          `\`/product-restock\` — Restock a product\n` +
          `\`/inventory-post\` — Post products to your shop channel\n` +
          `\`/payment-add\` — Add your payment methods\n` +
          `\`/start\` — Start payment flow in a buyer's ticket\n` +
          `\`/tracking\` — Add tracking to an order\n\n` +
          `⚠️ Your commands only affect **your own products**. You cannot see or edit the main store or other vendors.`
        )
        .setColor(0x5865f2)
        .setTimestamp();

      await mgmtChannel.send({ embeds: [welcomeEmbed] });

      await interaction.editReply({
        content: `✅ **${vendorName}** (<@${user.id}>) added as a trusted vendor!\n\n` +
          `📁 **Category:** ${vendorCategory}\n` +
          `📦 **Shop Channel:** ${inventoryChannel}\n` +
          `⚙️ **Management:** ${mgmtChannel}\n` +
          `💰 **Sales Log:** ${salesChannel}\n\n` +
          `Their ticket category has been auto-created. Run \`/vendor panel\` or \`/ticket panel\` to add their button for buyers.`,
      });
    }

    // ─── Remove Vendor ─────────────────────────────────────────────────
    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      const vendor = vendors.getByUserId(user.id, interaction.guildId);

      if (!vendor) {
        return interaction.reply({ content: `❌ <@${user.id}> is not a vendor.`, ephemeral: true });
      }

      vendors.remove(vendor.id, interaction.guildId);

      await interaction.reply({
        content: `✅ **${vendor.name}** (<@${user.id}>) removed as a vendor.\n⚠️ Their channels are still there — delete them manually if needed.`,
        ephemeral: true,
      });
    }

    // ─── List Vendors ──────────────────────────────────────────────────
    if (sub === 'list') {
      const allVendors = vendors.getAll(interaction.guildId);

      if (allVendors.length === 0) {
        return interaction.reply({ content: '❌ No vendors set up. Add one with `/vendor add`.', ephemeral: true });
      }

      const lines = allVendors.map((v, i) =>
        `${i + 1}. **${v.name}** — <@${v.user_id}> ${v.enabled ? '🟢' : '🔴'}`
      );

      const embed = new EmbedBuilder()
        .setTitle('🏪 Trusted Vendors')
        .setDescription(lines.join('\n'))
        .setColor(0x5865f2)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ─── Vendor Panel ──────────────────────────────────────────────────
    if (sub === 'panel') {
      const channelOption = interaction.options.getChannel('channel');
      const allVendors = vendors.getAll(interaction.guildId);

      if (allVendors.length === 0) {
        return interaction.reply({ content: '❌ No vendors found. Add some first with `/vendor add`.', ephemeral: true });
      }

      const channel = await interaction.client.channels.fetch(channelOption.id);

      // Find ticket categories that match vendor names
      const categories = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY id').all(interaction.guildId);

      const embed = new EmbedBuilder()
        .setTitle('🏪 Trusted Vendors')
        .setDescription('Browse our trusted vendors! Click a button below to open a purchase ticket with a vendor.')
        .setColor(0x5865f2)
        .setTimestamp();

      const vendorLines = allVendors.map(v => {
        const cat = categories.find(c => c.name === v.name);
        return `🏪 **${v.name}** — <@${v.user_id}>`;
      });
      embed.addFields({ name: 'Vendors', value: vendorLines.join('\n') });

      // Create buttons for each vendor's ticket category
      const buttons = [];
      for (const v of allVendors.slice(0, 5)) {
        const cat = categories.find(c => c.name === v.name);
        if (cat) {
          buttons.push(
            new ButtonBuilder()
              .setCustomId(`ticket_open:${cat.id}`)
              .setLabel(v.name)
              .setEmoji('🏪')
              .setStyle(ButtonStyle.Primary)
          );
        }
      }

      const rows = [];
      if (buttons.length > 0) {
        for (let i = 0; i < buttons.length; i += 5) {
          rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
      }

      await channel.send({ embeds: [embed], components: rows });
      await interaction.reply({ content: `✅ Vendor panel posted in ${channel}!`, ephemeral: true });
    }
  },
};
