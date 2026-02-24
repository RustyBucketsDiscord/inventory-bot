const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, AutocompleteInteraction } = require('discord.js');
const { products, productSizes, settings, vendors } = require('../utils/database');
const { buildProductEmbed, formatPrice } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('View or post inventory')
    .addSubcommand(sub =>
      sub.setName('view')
        .setDescription('View all products at a glance')
        .addStringOption(opt =>
          opt.setName('filter').setDescription('Filter')
            .addChoices({ name: 'All', value: 'all' }, { name: 'In Stock Only', value: 'instock' })
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('post')
        .setDescription('Post products to a forum channel (auto-creates if none given)')
        .addChannelOption(opt =>
          opt.setName('channel').setDescription('Existing channel (leave empty to auto-create)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildMedia)
            .setRequired(false)
        )
        .addChannelOption(opt =>
          opt.setName('folder').setDescription('Put the new forum inside this folder')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(false)
        )
        .addStringOption(opt => opt.setName('name').setDescription('Name for auto-created forum').setRequired(false))
        .addIntegerOption(opt => opt.setName('product-id').setDescription('Specific product ID').setRequired(false).setAutocomplete(true))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a product thread from a forum channel')
        .addIntegerOption(opt => opt.setName('product-id').setDescription('Product to remove').setRequired(true).setAutocomplete(true))
    )
    .setDefaultMemberPermissions(null),

  async autocomplete(interaction) {
    const guildId = interaction.guildId;
    const focused = interaction.options.getFocused().toString().toLowerCase();
    const allProducts = products.getAll(guildId);
    const filtered = allProducts
      .filter(p => p.name.toLowerCase().includes(focused) || String(p.id).includes(focused))
      .slice(0, 25)
      .map(p => ({
        name: `${p.name} — ${formatPrice(p.price)} (Stock: ${p.stock}) [ID: ${p.id}]`,
        value: p.id,
      }));
    await interaction.respond(filtered);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ─── View ─────────────────────────────────────────────────────────
    if (sub === 'view') {
      const filter = interaction.options.getString('filter') || 'all';
      const allProducts = filter === 'instock'
        ? products.getInStock(interaction.guildId)
        : products.getAll(interaction.guildId);

      if (allProducts.length === 0) {
        return interaction.reply({ content: '📦 No products. Use `/product add` to add some!', ephemeral: true });
      }

      const categories = {};
      for (const p of allProducts) {
        const cat = p.category || 'General';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(p);
      }

      const embed = new EmbedBuilder().setTitle('📦 Inventory Overview').setColor(0x5865f2).setTimestamp();

      for (const [category, items] of Object.entries(categories)) {
        const lines = items.map(p => {
          const stockIcon = p.stock > 0 ? '🟢' : '🔴';
          return `${stockIcon} **${p.name}** — ${formatPrice(p.price)} (${p.stock} in stock) [ID: ${p.id}]`;
        });
        embed.addFields({ name: `📁 ${category}`, value: lines.join('\n') || 'Empty' });
      }

      const totalProducts = allProducts.length;
      const totalStock = allProducts.reduce((sum, p) => sum + p.stock, 0);
      const totalValue = allProducts.reduce((sum, p) => sum + (p.price * p.stock), 0);
      embed.setFooter({ text: `${totalProducts} products | ${totalStock} units | ${formatPrice(totalValue)} value` });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ─── Post ─────────────────────────────────────────────────────────
    if (sub === 'post') {
      const vendor = vendors.getByUserId(interaction.user.id, interaction.guildId);
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
      if (!vendor && !isAdmin) {
        return interaction.reply({ content: '❌ You need Manage Server permission or be a trusted vendor.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const channelOption = interaction.options.getChannel('channel');
      const folderOption = interaction.options.getChannel('folder');
      const customName = interaction.options.getString('name');
      const specificId = interaction.options.getInteger('product-id');

      let channel;

      if (channelOption) {
        try { channel = await interaction.client.channels.fetch(channelOption.id); }
        catch (e) { return interaction.editReply({ content: `❌ Can't access that channel.` }); }
      } else {
        const forumName = customName || (vendor ? `📦 ${vendor.name} Shop` : '📦 Inventory');
        const parentId = folderOption?.id || vendor?.category_channel_id || null;

        channel = await interaction.guild.channels.create({
          name: forumName,
          type: ChannelType.GuildForum,
          parent: parentId,
          permissionOverwrites: [
            { id: interaction.guildId, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages', 'CreatePublicThreads'] },
            { id: interaction.client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks', 'AttachFiles', 'ManageThreads', 'CreatePublicThreads'] },
          ],
          reason: `Inventory forum created by ${interaction.user.tag}`,
        });

        if (vendor) {
          await channel.permissionOverwrites.edit(interaction.user.id, {
            ViewChannel: true, SendMessages: true, ReadMessageHistory: true, EmbedLinks: true, AttachFiles: true, CreatePublicThreads: true,
          });
        }
      }

      if (!channel) return interaction.editReply({ content: `❌ Channel not found.` });

      const isForum = channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia;
      settings.set(interaction.guildId, { inventoryChannelId: channel.id });

      if (vendor) {
        const { db } = require('../utils/database');
        db.prepare('UPDATE vendors SET inventory_channel_id = ? WHERE id = ? AND guild_id = ?').run(channel.id, vendor.id, interaction.guildId);
      }

      let productsToPost;
      if (specificId) {
        const product = products.getById(specificId, interaction.guildId);
        if (!product) return interaction.editReply({ content: '❌ Product not found.' });
        productsToPost = [product];
      } else {
        const allProducts = vendor && !isAdmin
          ? products.getAll(interaction.guildId, vendor.id)
          : products.getAllMainStore(interaction.guildId);
        productsToPost = allProducts.filter(p => !p.channel_id || p.channel_id === channel.id);
      }

      if (productsToPost.length === 0) {
        return interaction.editReply({ content: `❌ No products to post. Use \`/product add\` first.${!channelOption ? `\n📦 Forum created: ${channel}` : ''}` });
      }

      let posted = 0, updated = 0;

      for (const product of productsToPost) {
        const sizes = productSizes.getByProduct(product.id, interaction.guildId);
        const totalStock = sizes.length > 0 ? sizes.reduce((sum, s) => sum + s.stock, 0) : product.stock;
        const embed = buildProductEmbed(product, sizes);
        const threadName = `${product.name}${totalStock > 0 ? '' : ' [OUT OF STOCK]'}`.slice(0, 100);

        if (product.message_id && product.channel_id) {
          try {
            const existingThread = await interaction.client.channels.fetch(product.message_id);
            if (existingThread?.isThread()) {
              const messages = await existingThread.messages.fetch({ limit: 10 });
              const botMsg = messages.find(m => m.author.id === interaction.client.user.id);
              if (botMsg) await botMsg.edit({ embeds: [embed] });
              else await existingThread.send({ embeds: [embed] });
              if (existingThread.name !== threadName) await existingThread.setName(threadName);
              updated++;
              continue;
            }
          } catch (e) {}
        }

        let thread;
        if (isForum) {
          thread = await channel.threads.create({ name: threadName, message: { embeds: [embed] }, autoArchiveDuration: 10080 });
        } else {
          const starterMsg = await channel.send({ content: `**${product.name}**` });
          thread = await starterMsg.startThread({ name: threadName, autoArchiveDuration: 10080 });
          await thread.send({ embeds: [embed] });
        }

        products.updateMessage(product.id, interaction.guildId, thread.id, channel.id);
        posted++;
      }

      const parts = [];
      if (!channelOption) parts.push(`📦 Forum created: ${channel}`);
      if (posted > 0) parts.push(`✅ Posted **${posted}** product(s)`);
      if (updated > 0) parts.push(`🔄 Updated **${updated}** product(s)`);

      await interaction.editReply({ content: parts.join('\n') });
    }

    // ─── Remove ───────────────────────────────────────────────────────
    if (sub === 'remove') {
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
      const vendor = vendors.getByUserId(interaction.user.id, interaction.guildId);
      if (!vendor && !isAdmin) {
        return interaction.reply({ content: '❌ You need Manage Server permission or be a trusted vendor.', ephemeral: true });
      }

      const productId = interaction.options.getInteger('product-id');
      const product = products.getById(productId, interaction.guildId);
      if (!product) return interaction.reply({ content: '❌ Product not found.', ephemeral: true });

      // Delete the forum thread if it exists
      if (product.message_id) {
        try {
          const thread = await interaction.client.channels.fetch(product.message_id);
          if (thread) await thread.delete(`Inventory removed by ${interaction.user.tag}`);
        } catch (_) {}
      }

      // Clear the channel/message reference from the product
      products.updateMessage(productId, interaction.guildId, null, null);

      await interaction.reply({ content: `✅ **${product.name}** removed from inventory channel.`, ephemeral: true });
    }
  },
};
