const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { orders, products, paymentMethods, db } = require('../utils/database');
const { formatPrice, parseEmoji } = require('../utils/helpers');

module.exports = {
  data: [
    new SlashCommandBuilder()
      .setName('start')
      .setDescription('Start the payment flow for this ticket (staff only)'),
  ],

  async execute(interaction) {
    const { cart } = require('../utils/cart');

    const cartItems = cart.getByTicket(interaction.channelId, interaction.guildId);
    let totalPrice = 0;
    const orderLines = [];
    const createdOrders = [];
    let buyerId;

    if (cartItems.length > 0) {
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
      cart.clearTicket(interaction.channelId, interaction.guildId);
    } else {
      const pendingOrders = db.prepare(
        `SELECT * FROM orders WHERE ticket_channel_id = ? AND guild_id = ? AND status IN ('pending','confirmed','awaiting_payment')`
      ).all(interaction.channelId, interaction.guildId);

      if (pendingOrders.length === 0) {
        return interaction.reply({ content: '❌ No items in cart. The buyer needs to select products first.', ephemeral: true });
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

    const methods = paymentMethods.getAll(interaction.guildId);
    if (methods.length === 0) {
      return interaction.reply({ content: '❌ No payment methods set up. Use `/payment add`.', ephemeral: true });
    }

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
  },
};
