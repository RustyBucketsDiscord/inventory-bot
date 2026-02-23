const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ChannelType } = require('discord.js');
const { products, productSizes, vendors } = require('../utils/database');
const { formatPrice, buildProductEmbed } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('product')
    .setDescription('Manage products')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a new product — opens a popup form')
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('Edit an existing product — opens a popup form')
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a product')
    )
    .addSubcommand(sub =>
      sub.setName('restock')
        .setDescription('Restock a product or size')
        .addIntegerOption(opt => opt.setName('product-id').setDescription('Product ID').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to add').setRequired(true))
        .addStringOption(opt => opt.setName('size').setDescription('Specific size to restock (leave empty for all)').setRequired(false))
    )
    .setDefaultMemberPermissions(null),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // Permission check: admin or vendor
    const vendor = vendors.getByUserId(interaction.user.id, interaction.guildId);
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
    if (!vendor && !isAdmin) {
      return interaction.reply({ content: '❌ You need Manage Server permission or be a trusted vendor.', ephemeral: true });
    }

    if (sub === 'add') {
      const modal = new ModalBuilder()
        .setCustomId('product_add_modal')
        .setTitle('📦 Add New Product');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('name').setLabel('Product Name')
            .setPlaceholder('Lulu Lemon Strawberry Hoodie').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('price').setLabel('Price ($)')
            .setPlaceholder('89.99').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('description').setLabel('Description (optional)')
            .setPlaceholder('Brand new, authentic...').setStyle(TextInputStyle.Paragraph).setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('image').setLabel('Image URL (optional)')
            .setPlaceholder('https://example.com/product.png').setStyle(TextInputStyle.Short).setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('sizes').setLabel('Sizes — Name:Stock (one per line, optional)')
            .setPlaceholder('Small:5\nMedium:8\nLarge:3\nXL:2').setStyle(TextInputStyle.Paragraph).setRequired(false)
        ),
      );

      await interaction.showModal(modal);
    }

    if (sub === 'edit') {
      const allProducts = vendor && !isAdmin
        ? products.getAll(interaction.guildId, vendor.id)
        : products.getAll(interaction.guildId);

      if (allProducts.length === 0) {
        return interaction.reply({ content: '❌ No products found.', ephemeral: true });
      }

      const options = allProducts.slice(0, 25).map(p => ({
        label: p.name.slice(0, 100),
        description: `${formatPrice(p.price)} | Stock: ${p.stock}`,
        value: String(p.id),
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('product_edit_select')
        .setPlaceholder('Select a product to edit')
        .addOptions(options);

      await interaction.reply({
        content: '📝 Which product do you want to edit?',
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        ephemeral: true,
      });
    }

    if (sub === 'remove') {
      const allProducts = vendor && !isAdmin
        ? products.getAll(interaction.guildId, vendor.id)
        : products.getAll(interaction.guildId);

      if (allProducts.length === 0) {
        return interaction.reply({ content: '❌ No products found.', ephemeral: true });
      }

      const options = allProducts.slice(0, 25).map(p => ({
        label: p.name.slice(0, 100),
        description: `${formatPrice(p.price)} | Stock: ${p.stock}`,
        value: String(p.id),
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('product_remove_select')
        .setPlaceholder('Select product(s) to remove')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options);

      await interaction.reply({
        content: '🗑️ Which product(s) do you want to remove? You can select multiple.',
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        ephemeral: true,
      });
    }

    if (sub === 'restock') {
      const productId = interaction.options.getInteger('product-id');
      const amount = interaction.options.getInteger('amount');
      const sizeLabel = interaction.options.getString('size');

      const product = products.getById(productId, interaction.guildId);
      if (!product) {
        return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
      }

      // Vendor can only restock their own products
      if (vendor && !isAdmin && product.vendor_id !== vendor.id) {
        return interaction.reply({ content: '❌ You can only restock your own products.', ephemeral: true });
      }

      if (sizeLabel) {
        const size = productSizes.getByLabel(productId, interaction.guildId, sizeLabel);
        if (!size) {
          return interaction.reply({ content: `❌ Size **${sizeLabel}** not found.`, ephemeral: true });
        }
        productSizes.updateStock(size.id, interaction.guildId, size.stock + amount);
        // Update total product stock
        const totalStock = productSizes.getByProduct(productId, interaction.guildId).reduce((s, sz) => s + sz.stock, 0);
        products.updateStock(productId, interaction.guildId, totalStock);
        await interaction.reply({ content: `✅ **${product.name}** (${sizeLabel}) restocked: +${amount} → ${size.stock + amount} total`, ephemeral: true });
      } else {
        // Restock all sizes equally or product stock
        const sizes = productSizes.getByProduct(productId, interaction.guildId);
        if (sizes.length > 0) {
          for (const s of sizes) {
            productSizes.updateStock(s.id, interaction.guildId, s.stock + amount);
          }
          const totalStock = sizes.reduce((sum, s) => sum + s.stock + amount, 0);
          products.updateStock(productId, interaction.guildId, totalStock);
          await interaction.reply({ content: `✅ **${product.name}** — all ${sizes.length} sizes restocked +${amount} each`, ephemeral: true });
        } else {
          products.updateStock(productId, interaction.guildId, product.stock + amount);
          await interaction.reply({ content: `✅ **${product.name}** restocked: +${amount} → ${product.stock + amount} total`, ephemeral: true });
        }
      }

      // Update inventory thread
      const updated = products.getById(productId, interaction.guildId);
      const allSizes = productSizes.getByProduct(productId, interaction.guildId);
      if (updated.message_id && updated.channel_id) {
        try {
          const thread = await interaction.guild.channels.fetch(updated.message_id);
          if (thread?.isThread()) {
            const totalStock = allSizes.length > 0 ? allSizes.reduce((s, sz) => s + sz.stock, 0) : updated.stock;
            await thread.setName(`${updated.name}${totalStock > 0 ? '' : ' [OUT OF STOCK]'}`.slice(0, 100));
            const messages = await thread.messages.fetch({ limit: 10 });
            const botMsg = messages.find(m => m.author.id === interaction.client.user.id);
            if (botMsg) await botMsg.edit({ embeds: [buildProductEmbed(updated, allSizes)] });
          }
        } catch (e) {}
      }
    }
  },
};
