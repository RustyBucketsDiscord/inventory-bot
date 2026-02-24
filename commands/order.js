const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { orders, products, productSizes, paymentMethods, db } = require('../utils/database');
const { formatPrice, formatPaymentInstructions, parseEmoji } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('order')
    .setDescription('Order management')
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('Start payment flow in a purchase ticket')
    )
    .addSubcommand(sub =>
      sub.setName('tracking')
        .setDescription('Add tracking number, DM buyer, auto-close ticket')
        .addStringOption(opt => opt.setName('tracking-number').setDescription('Tracking/shipping number').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('View order history')
        .addStringOption(opt =>
          opt.setName('filter')
            .setDescription('Filter orders')
            .addChoices(
              { name: 'All', value: 'all' },
              { name: 'Pending', value: 'pending' },
              { name: 'Awaiting Payment', value: 'awaiting_payment' },
              { name: 'Shipped', value: 'shipped' },
              { name: 'Completed', value: 'completed' },
            )
            .setRequired(false)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ─── Start Payment ──────────────────────────────────────────────────
    if (sub === 'start') {
      const { cart } = require('../utils/cart');

      // Find cart items for this ticket channel
      const cartItems = cart.getByTicket(interaction.channelId, interaction.guildId);

      let totalPrice = 0;
      const orderLines = [];
      const createdOrders = [];
      let buyerId;

      if (cartItems.length > 0) {
        // Cart still has items — create orders from cart
        buyerId = cartItems[0].buyer_id;

        for (const item of cartItems) {
          const product = products.getById(item.product_id, interaction.guildId);
          if (!product) continue;

          const orderId = orders.create(
            interaction.guildId, buyerId, item.product_id, item.size_label,
            item.quantity, interaction.channelId, interaction.user.id
          );

          const lineTotal = product.price * item.quantity;
          totalPrice += lineTotal;
          const sizeStr = item.size_label ? ` (${item.size_label})` : '';
          orderLines.push(`• **${product.name}**${sizeStr} x${item.quantity} — ${formatPrice(lineTotal)}`);
          createdOrders.push(orderId);
        }

        // Clear cart now that orders are created
        cart.clearTicket(interaction.channelId, interaction.guildId);

      } else {
        // Cart already cleared — check for pending orders in this ticket
        const pendingOrders = db.prepare(
          `SELECT * FROM orders WHERE ticket_channel_id = ? AND guild_id = ? AND status IN ('pending', 'confirmed', 'awaiting_payment')`
        ).all(interaction.channelId, interaction.guildId);

        if (pendingOrders.length === 0) {
          return interaction.reply({ content: '❌ No items in cart for this ticket. The buyer needs to select products first.', ephemeral: true });
        }

        buyerId = pendingOrders[0].buyer_id;

        for (const o of pendingOrders) {
          const product = products.getById(o.product_id, interaction.guildId);
          if (!product) continue;
          const lineTotal = product.price * o.quantity;
          totalPrice += lineTotal;
          const sizeStr = o.size_label ? ` (${o.size_label})` : '';
          orderLines.push(`• **${product.name}**${sizeStr} x${o.quantity} — ${formatPrice(lineTotal)}`);
          createdOrders.push(o.id);
        }
      }

      if (createdOrders.length === 0) {
        return interaction.reply({ content: '❌ No valid orders found for this ticket.', ephemeral: true });
      }

      // Get payment methods
      const methods = paymentMethods.getAll(interaction.guildId);

      if (methods.length === 0) {
        return interaction.reply({ content: '❌ No payment methods set up. Add one with `/payment add` first.', ephemeral: true });
      }

      // Show payment buttons
      const embed = new EmbedBuilder()
        .setTitle('💰 Payment Required')
        .setDescription(
          `<@${buyerId}>, please select a payment method:\n\n` +
          `**Your Order:**\n${orderLines.join('\n')}\n\n` +
          `**Total: ${formatPrice(totalPrice)}**`
        )
        .setColor(0xffa500)
        .setTimestamp();

      const buttons = methods.slice(0, 5).map(m =>
        new ButtonBuilder()
          .setCustomId(`payment_select:${createdOrders[0]}:${m.id}`)
          .setLabel(`${m.name} — ${formatPrice(totalPrice)}`)
          .setEmoji(parseEmoji(m.emoji))
          .setStyle(ButtonStyle.Primary)
      );

      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
      }

      await interaction.reply({ embeds: [embed], components: rows });
    }

    // ─── Tracking ───────────────────────────────────────────────────────
    if (sub === 'tracking') {
      const trackingNumber = interaction.options.getString('tracking-number');

      // Find orders in this ticket
      const ticketOrders = db.prepare(
        'SELECT * FROM orders WHERE ticket_channel_id = ? AND guild_id = ? AND status IN (?, ?, ?) ORDER BY id'
      ).all(interaction.channelId, interaction.guildId, 'payment_approved', 'awaiting_shipping', 'pending');

      if (ticketOrders.length === 0) {
        return interaction.reply({ content: '❌ No orders found in this ticket.', ephemeral: true });
      }

      const buyerId = ticketOrders[0].buyer_id;

      const orderLines = [];
      for (const order of ticketOrders) {
        orders.updateTracking(order.id, interaction.guildId, trackingNumber);
        const product = products.getById(order.product_id, interaction.guildId);
        const sizeStr = order.size_label ? ` (${order.size_label})` : '';
        orderLines.push(`• ${product ? product.name : 'Unknown'}${sizeStr} x${order.quantity}`);
      }

      // DM buyer
      let dmSent = true;
      try {
        const buyer = await interaction.client.users.fetch(buyerId);
        const dmEmbed = new EmbedBuilder()
          .setTitle('📦 Your Order Has Shipped!')
          .setColor(0x00ff00)
          .setDescription(
            `Your order from **${interaction.guild.name}** has shipped!\n\n` +
            orderLines.join('\n') +
            `\n\n**📦 Tracking Number:** ${trackingNumber}`
          )
          .setFooter({ text: interaction.guild.name })
          .setTimestamp();
        await buyer.send({ embeds: [dmEmbed] });
      } catch (e) {
        dmSent = false;
      }

      // Post in ticket
      const ticketEmbed = new EmbedBuilder()
        .setTitle('📦 Tracking Added!')
        .setDescription(
          `<@${buyerId}>, your order has shipped!\n\n` +
          orderLines.join('\n') +
          `\n\n**📦 Tracking Number:** ${trackingNumber}` +
          `\n${dmSent ? '✅ DM sent to buyer' : '⚠️ Could not DM buyer (DMs may be closed)'}` +
          `\n\n🔒 This ticket will be deleted in **5 minutes**.`
        )
        .setColor(0x00ff00)
        .setTimestamp();

      await interaction.reply({ embeds: [ticketEmbed] });

      // Rename channel
      try {
        const buyer = await interaction.guild.members.fetch(buyerId);
        const displayName = buyer.nickname || buyer.displayName || buyer.user.username;
        const safeName = displayName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
        await interaction.channel.setName(`${safeName}-tracking`);
      } catch (e) {}

      // Auto-delete in 5 minutes
      setTimeout(async () => {
        try { await interaction.channel.delete('Order completed — tracking sent'); } catch (e) {}
      }, 5 * 60 * 1000);
    }

    // ─── List ───────────────────────────────────────────────────────────
    if (sub === 'list') {
      const filter = interaction.options.getString('filter') || 'all';

      let allOrders;
      if (filter === 'all') {
        allOrders = db.prepare('SELECT * FROM orders WHERE guild_id = ? ORDER BY id DESC LIMIT 25').all(interaction.guildId);
      } else {
        allOrders = db.prepare('SELECT * FROM orders WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT 25').all(interaction.guildId, filter);
      }

      if (allOrders.length === 0) {
        return interaction.reply({ content: '📦 No orders found.', ephemeral: true });
      }

      const lines = allOrders.map(o => {
        const product = products.getById(o.product_id, interaction.guildId);
        const sizeStr = o.size_label ? ` (${o.size_label})` : '';
        const statusEmoji = { pending: '⏳', awaiting_payment: '💰', payment_approved: '✅', awaiting_shipping: '📬', shipped: '🚚', completed: '✅', cancelled: '❌', denied: '🚫' };
        return `${statusEmoji[o.status] || '❓'} **#${o.id}** ${product?.name || 'Unknown'}${sizeStr} x${o.quantity} — <@${o.buyer_id}>`;
      });

      const embed = new EmbedBuilder()
        .setTitle('📋 Orders')
        .setDescription(lines.join('\n'))
        .setColor(0x5865f2)
        .setFooter({ text: `Showing ${allOrders.length} orders` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};
