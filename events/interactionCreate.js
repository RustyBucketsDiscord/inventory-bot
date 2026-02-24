const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { products, productSizes, paymentMethods, orders, settings, db } = require('../utils/database');
const { buildProductEmbed, buildOrderEmbed, formatPrice, formatPaymentInstructions, parseColor, parseSizesInput, sortSizeLabels, parseEmoji } = require('../utils/helpers');

// Active message collectors per channel (for shipping info)
const activeCollectors = new Map();

// Pending product removals: key = uniqueId, value = array of product IDs
const pendingRemovals = new Map();

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // ─── Autocomplete ────────────────────────────────────────────────────────
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try { await command.autocomplete(interaction); } catch (_) { await interaction.respond([]); }
      }
      return;
    }

    // ─── Slash Commands ─────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        const reply = { content: '❌ Something went wrong running that command.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      }
      return;
    }

    // ─── Select Menus ───────────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      const [action, ...args] = interaction.customId.split(':');

      // --- Product selected for order ---
      if (action === 'order_product_select') {
        const buyerId = args[0];
        const productId = parseInt(interaction.values[0]);
        const product = products.getById(productId, interaction.guildId);

        if (!product) {
          return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        if (product.stock <= 0) {
          return interaction.reply({ content: '❌ This product is out of stock!', ephemeral: true });
        }

        // Check if product has sizes
        const sizes = productSizes.getByProduct(productId, interaction.guildId);
        const inStockSizes = sizes.filter(s => s.stock > 0);

        if (sizes.length > 0 && inStockSizes.length === 0) {
          return interaction.reply({ content: '❌ All sizes are out of stock!', ephemeral: true });
        }

        // If product has sizes, show size picker first
        if (inStockSizes.length > 0) {
          const sizeOptions = inStockSizes.slice(0, 25).map(s => ({
            label: s.label,
            description: `${s.stock} in stock`,
            value: `${productId}:${s.id}:${s.label}`,
          }));

          const sizeMenu = new StringSelectMenuBuilder()
            .setCustomId(`order_size_select:${buyerId}`)
            .setPlaceholder('Select a size')
            .addOptions(sizeOptions);

          const row = new ActionRowBuilder().addComponents(sizeMenu);

          const embed = new EmbedBuilder()
            .setTitle('📏 Select Size')
            .setDescription(`<@${buyerId}>, what size for **${product.name}**?`)
            .addFields(
              { name: '💰 Price', value: formatPrice(product.price), inline: true },
            )
            .setColor(0x5865f2)
            .setTimestamp();

          if (product.image_url) embed.setThumbnail(product.image_url);

          await interaction.update({
            embeds: [embed],
            components: [row],
          });
          return;
        }

        // No sizes — go straight to payment
        const orderId = orders.create(
          interaction.guildId,
          buyerId,
          productId,
          '',
          1,
          interaction.channelId
        );
        orders.updateStaff(orderId, interaction.guildId, interaction.user.id);
        orders.updateStatus(orderId, interaction.guildId, 'awaiting_payment');

        await showPaymentButtons(interaction, orderId, buyerId, product);
      }

      // --- Size selected for order ---
      if (action === 'order_size_select') {
        const buyerId = args[0];
        const [productIdStr, sizeIdStr, ...sizeLabelParts] = interaction.values[0].split(':');
        const productId = parseInt(productIdStr);
        const sizeId = parseInt(sizeIdStr);
        const sizeLabel = sizeLabelParts.join(':');

        const product = products.getById(productId, interaction.guildId);
        if (!product) {
          return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        const orderId = orders.create(
          interaction.guildId,
          buyerId,
          productId,
          sizeLabel,
          1,
          interaction.channelId
        );
        orders.updateStaff(orderId, interaction.guildId, interaction.user.id);
        orders.updateStatus(orderId, interaction.guildId, 'awaiting_payment');

        await showPaymentButtons(interaction, orderId, buyerId, product, sizeLabel);
      }

      // --- Product edit select ---
      if (action === 'product_edit_select') {
        const productId = parseInt(interaction.values[0]);
        const product = products.getById(productId, interaction.guildId);

        if (!product) {
          return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        // Get existing sizes to pre-fill
        const existingSizes = productSizes.getByProduct(productId, interaction.guildId);
        const sizesStr = existingSizes.map(s => `${s.label}:${s.stock}`).join('\n');

        const modal = new ModalBuilder()
          .setCustomId(`product_edit_modal:${productId}`)
          .setTitle(`Edit: ${product.name.slice(0, 40)}`);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('name')
              .setLabel('Product Name')
              .setStyle(TextInputStyle.Short)
              .setValue(product.name)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('price')
              .setLabel('Price ($)')
              .setStyle(TextInputStyle.Short)
              .setValue(String(product.price))
              .setRequired(true)
              .setMaxLength(10)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('description')
              .setLabel('Description')
              .setStyle(TextInputStyle.Paragraph)
              .setValue(product.description || '')
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('image')
              .setLabel('Image URL')
              .setStyle(TextInputStyle.Short)
              .setValue(product.image_url || '')
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('sizes')
              .setLabel('Sizes — Name:Stock (one per line)')
              .setPlaceholder('Small:5\nMedium:8\nLarge:3\nXL:2')
              .setValue(sizesStr)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
          ),
        );

        await interaction.showModal(modal);
      }

      // --- Product remove select ---
      if (action === 'product_remove_select') {
        const selectedIds = interaction.values.map(v => parseInt(v));
        const selectedProducts = selectedIds.map(id => products.getById(id, interaction.guildId)).filter(Boolean);

        if (selectedProducts.length === 0) {
          return interaction.update({ content: '❌ No valid products found.', components: [] });
        }

        // Store selection in memory (customId has a 100-char limit)
        const removalKey = `${interaction.user.id}_${Date.now()}`;
        pendingRemovals.set(removalKey, selectedIds);
        // Auto-expire after 5 minutes
        setTimeout(() => pendingRemovals.delete(removalKey), 5 * 60 * 1000);

        const namesList = selectedProducts.map(p => `• **${p.name}**`).join('\n');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`product_remove_confirm:${removalKey}`)
            .setLabel(`Yes, delete ${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''}`)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('product_remove_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
        );

        await interaction.update({
          content: `⚠️ Are you sure you want to remove ${selectedProducts.length === 1 ? 'this product' : 'these **' + selectedProducts.length + '** products'}? This cannot be undone.\n\n${namesList}`,
          components: [row],
        });
      }

      // --- Payment remove select ---
      if (action === 'payment_remove_select') {
        const methodId = parseInt(interaction.values[0]);
        const method = paymentMethods.getById(methodId, interaction.guildId);

        if (!method) {
          return interaction.update({ content: '❌ Payment method not found.', components: [] });
        }

        paymentMethods.remove(methodId, interaction.guildId);

        await interaction.update({
          content: `✅ Payment method **${method.emoji} ${method.name}** removed.`,
          components: [],
        });
      }

      // --- Payment edit — show modal with current values ---
      if (action === 'payment_edit_select') {
        const methodId = parseInt(interaction.values[0]);
        const method = paymentMethods.getById(methodId, interaction.guildId);

        if (!method) {
          return interaction.update({ content: '❌ Payment method not found.', components: [] });
        }

        // Parse existing details
        let details = {};
        try { details = JSON.parse(method.instructions); } catch (e) {}

        const modal = new ModalBuilder()
          .setCustomId(`payment_edit_modal:${methodId}`)
          .setTitle(`✏️ Edit — ${method.emoji} ${method.name}`);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('name')
              .setLabel('Payment Method Name')
              .setPlaceholder('Zelle, CashApp, PayPal...')
              .setValue(method.name || '')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('emoji')
              .setLabel('Button Emoji')
              .setPlaceholder('💸')
              .setValue(method.emoji || '💳')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(10)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('contact')
              .setLabel('Phone / Email / Tag (one per line)')
              .setPlaceholder('Phone: 743-232-1234\nEmail: pay@me.com\nTag: $MyTag')
              .setValue(
                [
                  details.phone ? `Phone: ${details.phone}` : '',
                  details.email ? `Email: ${details.email}` : '',
                  details.tag ? `Tag: ${details.tag}` : '',
                ].filter(Boolean).join('\n')
              )
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('memo')
              .setLabel('Memo / Note instructions')
              .setPlaceholder('Write "gift" in the memo')
              .setValue(details.memo || '')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('extra')
              .setLabel('Extra Instructions')
              .setPlaceholder('Any additional info for the buyer')
              .setValue(details.extra || '')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
          ),
        );

        await interaction.showModal(modal);
      }
    }

    // ─── Buttons ────────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const [action, ...args] = interaction.customId.split(':');

      // --- Payment method selected by buyer ---
      if (action === 'payment_select') {
        const orderId = parseInt(args[0]);
        const methodId = parseInt(args[1]);

        const order = orders.getById(orderId, interaction.guildId);
        if (!order) {
          return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
        }

        const method = paymentMethods.getById(methodId, interaction.guildId);
        if (!method) {
          return interaction.reply({ content: '❌ Payment method not found.', ephemeral: true });
        }

        const product = products.getById(order.product_id, interaction.guildId);

        // Calculate total for all orders in this ticket
        const { db } = require('../utils/database');
        const ticketOrders = db.prepare(
          'SELECT * FROM orders WHERE ticket_channel_id = ? AND guild_id = ? AND status IN (?, ?)'
        ).all(order.ticket_channel_id || interaction.channelId, interaction.guildId, 'awaiting_payment', 'pending');

        let totalPrice = 0;
        const orderLines = [];
        const allOrders = ticketOrders.length > 0 ? ticketOrders : [order];

        for (const o of allOrders) {
          const p = products.getById(o.product_id, interaction.guildId);
          if (!p) continue;
          const lineTotal = p.price * o.quantity;
          totalPrice += lineTotal;
          const sizeStr = o.size_label ? ` (${o.size_label})` : '';
          orderLines.push(`• **${p.name}**${sizeStr} x${o.quantity} — ${formatPrice(lineTotal)}`);
          orders.updatePayment(o.id, interaction.guildId, method.name);
          orders.updateStatus(o.id, interaction.guildId, 'awaiting_payment');
        }

        // Format payment instructions with total
        const paymentDetails = formatPaymentInstructions(method, totalPrice);

        const embed = new EmbedBuilder()
          .setTitle(`💰 ${method.emoji} ${method.name} — Payment Instructions`)
          .setDescription(
            `<@${order.buyer_id}>, send your payment and upload a screenshot below.\n\n` +
            `**Your Order:**\n${orderLines.join('\n')}\n\n` +
            `**Total: ${formatPrice(totalPrice)}**\n\n` +
            `───────────────\n\n` +
            paymentDetails +
            `\n\n───────────────\n` +
            `📸 **Upload a screenshot of your payment below ⬇️**`
          )
          .setColor(0xffa500)
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: [],
        });

        // Set up a message collector for the payment screenshot
        const filter = m => m.author.id === order.buyer_id && m.attachments.size > 0;
        const collector = interaction.channel.createMessageCollector({ filter, time: 1800000, max: 1 }); // 30 min timeout

        collector.on('collect', async (message) => {
          const screenshot = message.attachments.first();
          orders.updateScreenshot(orderId, interaction.guildId, screenshot.url);
          orders.updateStatus(orderId, interaction.guildId, 'payment_submitted');

          const reviewEmbed = new EmbedBuilder()
            .setTitle(`📸 Payment Screenshot — Order #${orderId}`)
            .setDescription(`<@${order.buyer_id}> submitted payment. Staff, please review:`)
            .setImage(screenshot.url)
            .addFields(
              { name: '📦 Product', value: product ? product.name : 'Unknown', inline: true },
              { name: '💰 Amount', value: product ? formatPrice(product.price) : 'N/A', inline: true },
              { name: '💳 Method', value: `${method.emoji} ${method.name}`, inline: true },
            )
            .setColor(0xffa500)
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`payment_approve:${orderId}`)
              .setLabel('✅ Approve Payment')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`payment_deny:${orderId}`)
              .setLabel('❌ Deny Payment')
              .setStyle(ButtonStyle.Danger),
          );

          await interaction.channel.send({ embeds: [reviewEmbed], components: [row] });
        });

        collector.on('end', (collected, reason) => {
          if (reason === 'time' && collected.size === 0) {
            interaction.channel.send({
              content: `⏰ <@${order.buyer_id}>, payment screenshot timed out for Order #${orderId}. Please ask staff to restart the process.`,
            }).catch(() => {});
          }
        });
      }

      // --- Approve payment ---
      if (action === 'payment_approve') {
        const orderId = parseInt(args[0]);
        const order = orders.getById(orderId, interaction.guildId);

        if (!order) {
          return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
        }

        // Get ALL orders in this ticket that are awaiting payment
        const { db } = require('../utils/database');
        const ticketOrders = db.prepare(
          'SELECT * FROM orders WHERE ticket_channel_id = ? AND guild_id = ? AND status IN (?, ?)'
        ).all(order.ticket_channel_id, interaction.guildId, 'awaiting_payment', 'payment_submitted');

        const allOrders = ticketOrders.length > 0 ? ticketOrders : [order];

        // Validate stock for ALL items before approving
        const stockIssues = [];
        for (const o of allOrders) {
          const p = products.getById(o.product_id, interaction.guildId);
          if (!p) continue;

          if (o.size_label) {
            const size = productSizes.getByLabel(p.id, interaction.guildId, o.size_label);
            if (!size || size.stock < o.quantity) {
              stockIssues.push(`**${p.name}** (${o.size_label}) — only ${size ? size.stock : 0} left`);
            }
          } else {
            if (p.stock < o.quantity) {
              stockIssues.push(`**${p.name}** — only ${p.stock} left`);
            }
          }
        }

        if (stockIssues.length > 0) {
          return interaction.reply({
            content: `❌ Can't approve — stock issues:\n${stockIssues.join('\n')}\n\nSome items may have sold out since this order was placed.`,
            ephemeral: true,
          });
        }

        // Decrement stock for ALL orders
        for (const o of allOrders) {
          orders.updateStatus(o.id, interaction.guildId, 'payment_approved');
          const product = products.getById(o.product_id, interaction.guildId);
          if (!product) continue;

          for (let i = 0; i < o.quantity; i++) {
            if (o.size_label) {
              const size = productSizes.getByLabel(product.id, interaction.guildId, o.size_label);
              if (size) productSizes.decrementStock(size.id, interaction.guildId);
            } else {
              products.decrementStock(product.id, interaction.guildId);
            }
          }

          // Update inventory thread
          if (product.message_id && product.channel_id) {
            try {
              const updated = products.getById(product.id, interaction.guildId);
              const sizes = productSizes.getByProduct(product.id, interaction.guildId);
              const thread = await interaction.client.channels.fetch(product.message_id);
              if (thread && thread.isThread()) {
                const totalStock = products.getTotalStock(product.id, interaction.guildId);
                const threadName = `${updated.name}${totalStock > 0 ? '' : ' [OUT OF STOCK]'}`;
                await thread.setName(threadName.slice(0, 100));

                const messages = await thread.messages.fetch({ limit: 10 });
                const botMsg = messages.find(m => m.author.id === interaction.client.user.id);
                if (botMsg) {
                  await botMsg.edit({ embeds: [buildProductEmbed(updated, sizes)] });
                }
              }
            } catch (e) {}
          }
        }

        const embed = new EmbedBuilder()
          .setTitle(`✅ Payment Approved!`)
          .setDescription(`<@${order.buyer_id}>, your payment has been approved!\n\nClick the button below to enter your shipping info:`)
          .setColor(0x00ff00)
          .setTimestamp();

        // Show shipping info button instead of collecting via messages
        const shippingRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`shipping_form:${allOrders[0].id}:${order.buyer_id}`)
            .setLabel('📬 Enter Shipping Info')
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.update({
          embeds: [embed],
          components: [shippingRow],
        });

        // Rename ticket channel to name-paid
        try {
          const buyer = await interaction.guild.members.fetch(order.buyer_id);
          const displayName = buyer.nickname || buyer.displayName || buyer.user.username;
          const safeName = displayName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
          await interaction.channel.setName(`${safeName}-paid`);
        } catch (e) {}

        // Update all order statuses
        for (const o of allOrders) {
          orders.updateStatus(o.id, interaction.guildId, 'awaiting_shipping');
        }

        // Log sale to sales channel
        try {
          const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
          if (ticketSettings && ticketSettings.sales_channel_id) {
            const salesChannel = await interaction.client.channels.fetch(ticketSettings.sales_channel_id);

            let totalPrice = 0;
            const saleLines = [];
            for (const o of allOrders) {
              const p = products.getById(o.product_id, interaction.guildId);
              if (!p) continue;
              const lineTotal = p.price * o.quantity;
              totalPrice += lineTotal;
              const sizeStr = o.size_label ? ` (${o.size_label})` : '';
              saleLines.push(`• **${p.name}**${sizeStr} × ${o.quantity} — ${formatPrice(lineTotal)}`);
            }

            const buyer = await interaction.guild.members.fetch(order.buyer_id).catch(() => null);
            const buyerName = buyer ? (buyer.nickname || buyer.displayName || buyer.user.username) : `<@${order.buyer_id}>`;

            const salesEmbed = new EmbedBuilder()
              .setTitle(`💰 Sale Completed!`)
              .setDescription(saleLines.join('\n'))
              .addFields(
                { name: '👤 Buyer', value: `<@${order.buyer_id}> (${buyerName})`, inline: true },
                { name: '💵 Total', value: formatPrice(totalPrice), inline: true },
                { name: '💳 Payment', value: order.payment_method || 'N/A', inline: true },
                { name: '👨‍💼 Approved by', value: `<@${interaction.user.id}>`, inline: true },
              )
              .setColor(0x00ff00)
              .setTimestamp();

            await salesChannel.send({ embeds: [salesEmbed] });
          }
        } catch (e) {}
      }

      // --- Deny payment ---
      if (action === 'payment_deny') {
        const orderId = parseInt(args[0]);
        const order = orders.getById(orderId, interaction.guildId);

        if (!order) {
          return interaction.reply({ content: '❌ Order not found.', ephemeral: true });
        }

        orders.updateStatus(orderId, interaction.guildId, 'denied');

        const embed = new EmbedBuilder()
          .setTitle(`❌ Payment Denied — Order #${orderId}`)
          .setDescription(`<@${order.buyer_id}>, your payment was not approved. Please contact staff for more info.`)
          .setColor(0xff0000)
          .setTimestamp();

        await interaction.update({
          embeds: [embed],
          components: [],
        });
      }

      // --- Shipping form button — opens modal popup ---
      if (action === 'shipping_form') {
        const orderId = parseInt(args[0]);
        const buyerId = args[1];

        // Only the buyer can fill this out
        if (interaction.user.id !== buyerId) {
          return interaction.reply({ content: '❌ Only the buyer can fill out shipping info.', ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`shipping_modal:${orderId}`)
          .setTitle('📬 Shipping Information');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('full_name')
              .setLabel('Full Name')
              .setPlaceholder('John Doe')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('street')
              .setLabel('Street Address')
              .setPlaceholder('123 Main St')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('apt')
              .setLabel('Apt / Suite / Unit # (optional)')
              .setPlaceholder('Apt 4B')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('city_state')
              .setLabel('City, State')
              .setPlaceholder('Los Angeles, CA')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('zip')
              .setLabel('ZIP Code')
              .setPlaceholder('90001')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
        );

        await interaction.showModal(modal);
      }

      // --- Cancel order ---
      if (action === 'order_cancel') {
        const orderId = parseInt(args[0]);
        orders.updateStatus(orderId, interaction.guildId, 'cancelled');

        await interaction.update({
          content: `❌ Order #${orderId} has been cancelled.`,
          embeds: [],
          components: [],
        });
      }

      // --- Product remove confirm ---
      if (action === 'product_remove_confirm') {
        const removalKey = interaction.customId.split(':').slice(1).join(':');
        const productIds = pendingRemovals.get(removalKey);
        pendingRemovals.delete(removalKey);

        if (!productIds || productIds.length === 0) {
          return interaction.update({ content: '❌ This removal expired or was already processed.', components: [] });
        }

        const removed = [];

        for (const productId of productIds) {
          const product = products.getById(productId, interaction.guildId);
          if (!product) continue;

          // Try to delete the inventory thread
          if (product.message_id && product.channel_id) {
            try {
              const thread = await interaction.guild.channels.fetch(product.message_id);
              if (thread && thread.isThread()) {
                await thread.delete('Product removed');
              }
            } catch (e) {}
          }

          // Temporarily disable FK checks so orders referencing this product don't block deletion
          try {
            db.pragma('foreign_keys = OFF');
            products.remove(productId, interaction.guildId);
            db.pragma('foreign_keys = ON');
            removed.push(product.name);
          } catch (e) {
            db.pragma('foreign_keys = ON');
            console.error(`Failed to remove product ${productId}:`, e);
          }
        }

        const msg = removed.length === 0
          ? '❌ No products could be removed.'
          : removed.length === 1
            ? `✅ Removed **${removed[0]}**.`
            : `✅ Removed **${removed.length}** products:\n${removed.map(n => `• ${n}`).join('\n')}`;

        await interaction.update({
          content: msg,
          components: [],
        });
      }

      if (action === 'product_remove_cancel') {
        await interaction.update({
          content: '👍 Cancelled. Nothing was removed.',
          components: [],
        });
      }

      // ─── Ticket Buttons ─────────────────────────────────────────────────

      // --- Open a ticket from panel button ---
      if (action === 'ticket_open') {
        const categoryId = parseInt(args[0]);
        await handleTicketOpen(interaction, categoryId);
      }

      // --- Close ticket confirm ---
      if (action === 'ticket_close_confirm') {
        const ticketId = parseInt(args[0]);
        try {
          await handleTicketClose(interaction, ticketId);
        } catch (e) {
          console.error('Ticket close error:', e);
          // Fallback — just close the channel if ticket not in DB
          try {
            await interaction.update({ content: '🔒 Closing ticket...', components: [] });
            await interaction.channel.permissionOverwrites.edit(interaction.guildId, {
              SendMessages: false,
            });
            const { ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
            const row = new AR().addComponents(
              new BB().setCustomId(`ticket_delete:0`).setLabel('🗑️ Delete Channel').setStyle(BS.Danger)
            );
            await interaction.channel.send({ content: '🔒 Ticket closed.', components: [row] });
          } catch (e2) {
            console.error('Fallback close error:', e2);
          }
        }
      }

      if (action === 'ticket_close_cancel') {
        await interaction.update({
          content: '👍 Ticket close cancelled.',
          components: [],
        });
      }

      // --- Delete ticket (after close) ---
      if (action === 'ticket_delete') {
        const ticketId = parseInt(args[0]);
        await interaction.update({ content: '🗑️ Deleting ticket in 5 seconds...', components: [] });
        setTimeout(async () => {
          try {
            await interaction.channel.delete('Ticket deleted');
          } catch (e) {}
        }, 5000);
      }

      // --- Buyer confirms their cart ---
      if (action === 'buyer_confirm') {
        const buyerId = args[0];
        const ticketId = parseInt(args[1]);
        const { cart } = require('../utils/cart');

        const cartItems = cart.getByTicket(interaction.channelId, interaction.guildId);
        if (cartItems.length === 0) {
          return interaction.update({ content: '❌ Your cart is empty.', embeds: [], components: [] });
        }

        // Re-validate stock before confirming
        const outOfStock = [];
        for (const item of cartItems) {
          const product = products.getById(item.product_id, interaction.guildId);
          if (!product) { outOfStock.push(item); continue; }

          if (item.size_label) {
            const size = productSizes.getByLabel(item.product_id, interaction.guildId, item.size_label);
            if (!size || size.stock < item.quantity) {
              outOfStock.push(item);
            }
          } else {
            if (product.stock < item.quantity) {
              outOfStock.push(item);
            }
          }
        }

        if (outOfStock.length > 0) {
          // Remove out-of-stock items from cart
          for (const item of outOfStock) {
            cart.removeItem(item.id, interaction.guildId);
          }
          const names = outOfStock.map(i => {
            const p = products.getById(i.product_id, interaction.guildId);
            return `**${p ? p.name : 'Unknown'}**${i.size_label ? ` (${i.size_label})` : ''}`;
          });
          await interaction.channel.send({
            content: `⚠️ Some items went out of stock and were removed: ${names.join(', ')}`,
          }).catch(() => {});

          // Show updated cart
          return await showCartAndOptions(interaction, buyerId, ticketId);
        }

        // Create orders from cart
        let totalPrice = 0;
        const orderLines = [];

        for (const item of cartItems) {
          const product = products.getById(item.product_id, interaction.guildId);
          if (!product) continue;

          const orderId = orders.create(interaction.guildId, buyerId, item.product_id, item.size_label, item.quantity, interaction.channelId);
          orders.updateStatus(orderId, interaction.guildId, 'pending');

          const lineTotal = product.price * item.quantity;
          totalPrice += lineTotal;
          orderLines.push(`• **${product.name}**${item.size_label ? ` (${item.size_label})` : ''} x${item.quantity} — ${formatPrice(lineTotal)}`);
        }

        // Clear the cart
        cart.clearCart(interaction.channelId, interaction.guildId);

        // Get staff role for ping
        const { db } = require('../utils/database');
        const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
        const staffRoleId = ticketSettings ? ticketSettings.staff_role_id : '';

        const embed = new EmbedBuilder()
          .setTitle(`✅ Order Confirmed!`)
          .setDescription(`<@${buyerId}> has confirmed their order:\n\n${orderLines.join('\n')}\n\n**Total: ${formatPrice(totalPrice)}**`)
          .setColor(0x00ff00)
          .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });

        await interaction.channel.send({
          content: `${staffRoleId ? `<@&${staffRoleId}> ` : ''}📋 **Order confirmed!** Total: **${formatPrice(totalPrice)}**\nRun \`/start\` to begin the payment process.`,
        });
      }

      // --- Buyer wants to add more items ---
      if (action === 'buyer_add_more') {
        const buyerId = args[0];
        const ticketId = parseInt(args[1]);

        const inStockProducts = products.getInStock(interaction.guildId);

        if (inStockProducts.length === 0) {
          return interaction.update({ content: '❌ No products in stock right now.', embeds: [], components: [] });
        }

        const options = inStockProducts.slice(0, 25).map(p => {
          const sizes = productSizes.getByProduct(p.id, interaction.guildId);
          const totalStock = sizes.length > 0
            ? sizes.reduce((sum, s) => sum + s.stock, 0)
            : p.stock;
          return {
            label: p.name.slice(0, 100),
            description: `$${p.price.toFixed(2)} | ${totalStock} in stock`,
            value: String(p.id),
          };
        });

        const productMenu = new StringSelectMenuBuilder()
          .setCustomId(`buyer_product_select:${buyerId}:${ticketId}`)
          .setPlaceholder('👇 Pick another product to add')
          .addOptions(options);

        const productRow = new ActionRowBuilder().addComponents(productMenu);

        const shopEmbed = new EmbedBuilder()
          .setTitle('🛒 Add Another Product')
          .setDescription('Select a product to add to your order:')
          .setColor(0x5865f2);

        await interaction.update({ embeds: [shopEmbed], components: [productRow] });
      }

      // --- Buyer removes an item from cart ---
      if (action === 'buyer_remove_item') {
        const buyerId = args[0];
        const ticketId = parseInt(args[1]);
        const cartItemId = parseInt(args[2]);
        const { cart } = require('../utils/cart');

        cart.removeItem(cartItemId, interaction.guildId);
        await showCartAndOptions(interaction, buyerId, ticketId);
      }
    }

    // ─── Select Menus (tickets) ─────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      const [action, ...args] = interaction.customId.split(':');

      if (action === 'ticket_open_select') {
        const categoryId = parseInt(interaction.values[0]);
        await handleTicketOpen(interaction, categoryId);
      }

      // --- Buyer selected a product in their ticket ---
      if (action === 'buyer_product_select') {
        const buyerId = args[0];
        const ticketId = parseInt(args[1]);
        const productId = parseInt(interaction.values[0]);

        const product = products.getById(productId, interaction.guildId);
        if (!product) {
          return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        // Check sizes
        const sizes = productSizes.getByProduct(productId, interaction.guildId);
        const inStockSizes = sizes.filter(s => s.stock > 0);

        if (inStockSizes.length > 0) {
          // Show size picker (one at a time, then quantity)
          const sizeOptions = inStockSizes.slice(0, 25).map(s => ({
            label: s.label,
            description: `${s.stock} in stock`,
            value: `${productId}:${s.label}`,
          }));

          const sizeMenu = new StringSelectMenuBuilder()
            .setCustomId(`buyer_size_select:${buyerId}:${ticketId}`)
            .setPlaceholder('Select a size')
            .addOptions(sizeOptions);

          const row = new ActionRowBuilder().addComponents(sizeMenu);

          const embed = new EmbedBuilder()
            .setTitle(`📏 Select Size — ${product.name}`)
            .setDescription(`Pick a size, then you'll choose how many:`)
            .addFields(
              { name: '💰 Price', value: formatPrice(product.price) + ' each', inline: true },
            )
            .setColor(0x5865f2);

          if (product.image_url) embed.setThumbnail(product.image_url);

          await interaction.update({ embeds: [embed], components: [row] });
        } else {
          // No sizes — check stock before adding to cart
          if (product.stock <= 0) {
            return interaction.reply({ content: `❌ **${product.name}** is out of stock!`, ephemeral: true });
          }
          const { cart } = require('../utils/cart');
          // Check how many are already in cart for this product
          const existingCart = cart.getByTicket(interaction.channelId, interaction.guildId);
          const alreadyInCart = existingCart.filter(i => i.product_id === productId).reduce((sum, i) => sum + i.quantity, 0);
          if (alreadyInCart >= product.stock) {
            return interaction.reply({ content: `❌ You already have the max stock (${product.stock}) of **${product.name}** in your cart.`, ephemeral: true });
          }
          cart.add(interaction.guildId, buyerId, interaction.channelId, productId, '', 1);
          await showCartAndOptions(interaction, buyerId, ticketId);
        }
      }

      // --- Buyer selected a size — now show quantity picker ---
      if (action === 'buyer_size_select') {
        const buyerId = args[0];
        const ticketId = parseInt(args[1]);
        
        const [productIdStr, ...sizeLabelParts] = interaction.values[0].split(':');
        const productId = parseInt(productIdStr);
        const sizeLabel = sizeLabelParts.join(':');

        const product = products.getById(productId, interaction.guildId);
        if (!product) {
          return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        // Check max stock for this size
        const size = productSizes.getByLabel(productId, interaction.guildId, sizeLabel);
        const maxStock = size ? size.stock : 1;

        // Check how many already in cart
        const { cart } = require('../utils/cart');
        const existingCart = cart.getByTicket(interaction.channelId, interaction.guildId);
        const alreadyInCart = existingCart.filter(i => i.product_id === productId && i.size_label === sizeLabel).reduce((sum, i) => sum + i.quantity, 0);
        const available = Math.max(0, maxStock - alreadyInCart);

        if (available <= 0) {
          return interaction.reply({ content: `❌ You already have the max stock of **${product.name}** (${sizeLabel}) in your cart.`, ephemeral: true });
        }

        // Show quantity picker (dropdown 1-25 or max stock)
        const maxQty = Math.min(available, 25);
        const qtyOptions = [];
        for (let i = 1; i <= maxQty; i++) {
          qtyOptions.push({
            label: `${i}`,
            description: `${i} × ${formatPrice(product.price)} = ${formatPrice(product.price * i)}`,
            value: `${productId}:${sizeLabel}:${i}`,
          });
        }

        const qtyMenu = new StringSelectMenuBuilder()
          .setCustomId(`buyer_qty_select:${buyerId}:${ticketId}`)
          .setPlaceholder('How many?')
          .addOptions(qtyOptions);

        const row = new ActionRowBuilder().addComponents(qtyMenu);

        const embed = new EmbedBuilder()
          .setTitle(`🔢 Quantity — ${product.name} (${sizeLabel})`)
          .setDescription(`How many do you want? (${available} available)`)
          .addFields(
            { name: '💰 Price', value: formatPrice(product.price) + ' each', inline: true },
            { name: '📏 Size', value: sizeLabel, inline: true },
          )
          .setColor(0x5865f2);

        if (product.image_url) embed.setThumbnail(product.image_url);

        await interaction.update({ embeds: [embed], components: [row] });
      }

      // --- Buyer selected quantity ---
      if (action === 'buyer_qty_select') {
        const buyerId = args[0];
        const ticketId = parseInt(args[1]);

        const [productIdStr, ...rest] = interaction.values[0].split(':');
        const quantity = parseInt(rest.pop());
        const sizeLabel = rest.join(':');
        const productId = parseInt(productIdStr);

        const { cart } = require('../utils/cart');
        cart.add(interaction.guildId, buyerId, interaction.channelId, productId, sizeLabel, quantity);

        await showCartAndOptions(interaction, buyerId, ticketId);
      }
    }

    // ─── Modals ─────────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const [action, ...args] = interaction.customId.split(':');

      // --- Product add modal submitted ---
      if (action === 'product_add_modal') {
        const name = interaction.fields.getTextInputValue('name')?.trim();
        const priceStr = interaction.fields.getTextInputValue('price')?.trim();
        const description = interaction.fields.getTextInputValue('description')?.trim() || '';
        const imageUrl = interaction.fields.getTextInputValue('image')?.trim() || '';
        const sizesRaw = interaction.fields.getTextInputValue('sizes')?.trim() || '';

        const price = parseFloat(priceStr);
        if (!name || isNaN(price)) {
          return interaction.reply({ content: '❌ Name is required and price must be a number.', ephemeral: true });
        }

        // Detect vendor context
        const { vendors: vendorsDB } = require('../utils/database');
        const vendor = vendorsDB.getByUserId(interaction.user.id, interaction.guildId);
        const vendorId = vendor ? vendor.id : null;

        // Parse sizes
        const sizes = parseSizesInput(sizesRaw);
        const totalStock = sizes.length > 0 ? sizes.reduce((sum, s) => sum + s.stock, 0) : 0;

        const productId = products.add(interaction.guildId, name, description, price, totalStock, imageUrl, 'General');

        // Set vendor_id if applicable
        if (vendorId) {
          const { db } = require('../utils/database');
          db.prepare('UPDATE products SET vendor_id = ? WHERE id = ? AND guild_id = ?').run(vendorId, productId, interaction.guildId);
        }

        // Add sizes if provided
        if (sizes.length > 0) {
          for (const size of sizes) {
            productSizes.add(productId, interaction.guildId, size.label, size.stock);
          }
        }

        const product = products.getById(productId, interaction.guildId);
        const allSizes = productSizes.getByProduct(productId, interaction.guildId);
        const embed = buildProductEmbed(product, allSizes);

        await interaction.reply({
          content: `✅ Product **${name}** added! (ID: ${productId})${sizes.length > 0 ? `\n📏 ${sizes.length} size(s) added` : ''}${vendor ? `\n🏪 Added to **${vendor.name}**'s store` : ''}\nUse \`/inventory-post\` to display it.`,
          embeds: [embed],
          ephemeral: true,
        });
      }

      if (action === 'product_edit_modal') {
        const productId = parseInt(args[0]);
        const name = interaction.fields.getTextInputValue('name');
        const price = parseFloat(interaction.fields.getTextInputValue('price'));
        const description = interaction.fields.getTextInputValue('description') || '';
        const imageUrl = interaction.fields.getTextInputValue('image') || '';
        const sizesRaw = interaction.fields.getTextInputValue('sizes')?.trim() || '';

        if (isNaN(price)) {
          return interaction.reply({ content: '❌ Price must be a valid number.', ephemeral: true });
        }

        const product = products.getById(productId, interaction.guildId);
        if (!product) {
          return interaction.reply({ content: '❌ Product not found.', ephemeral: true });
        }

        // Parse sizes from input
        const newSizes = parseSizesInput(sizesRaw);
        const totalStock = newSizes.length > 0 ? newSizes.reduce((sum, s) => sum + s.stock, 0) : product.stock;

        products.update(productId, interaction.guildId, name, description, price, totalStock, imageUrl, product.category);

        // Update sizes if provided
        if (sizesRaw.length > 0) {
          // Remove all existing sizes and re-add
          const existingSizes = productSizes.getByProduct(productId, interaction.guildId);
          for (const s of existingSizes) {
            productSizes.remove(productId, interaction.guildId, s.label);
          }
          for (const size of newSizes) {
            productSizes.add(productId, interaction.guildId, size.label, size.stock);
          }
        }

        const updated = products.getById(productId, interaction.guildId);
        const allSizes = productSizes.getByProduct(productId, interaction.guildId);
        const embed = buildProductEmbed(updated, allSizes);

        // Update inventory thread
        if (updated.message_id && updated.channel_id) {
          try {
            const totalStk = products.getTotalStock(productId, interaction.guildId);
            const thread = await interaction.guild.channels.fetch(updated.message_id);
            if (thread && thread.isThread()) {
              const threadName = `${updated.name}${totalStk > 0 ? '' : ' [OUT OF STOCK]'}`;
              await thread.setName(threadName.slice(0, 100));

              const messages = await thread.messages.fetch({ limit: 10 });
              const botMsg = messages.find(m => m.author.id === interaction.client.user.id);
              if (botMsg) {
                await botMsg.edit({ embeds: [embed] });
              }
            }
          } catch (e) {}
        }

        await interaction.reply({
          content: `✅ Product **${name}** updated!${newSizes.length > 0 ? ` (${newSizes.length} sizes)` : ''}`,
          embeds: [embed],
          ephemeral: true,
        });
      }

      // --- Shipping info modal submitted ---
      if (action === 'shipping_modal') {
        const orderId = parseInt(args[0]);

        const fullName = interaction.fields.getTextInputValue('full_name').trim();
        const street = interaction.fields.getTextInputValue('street').trim();
        const apt = interaction.fields.getTextInputValue('apt')?.trim() || '';
        const cityState = interaction.fields.getTextInputValue('city_state').trim();
        const zip = interaction.fields.getTextInputValue('zip').trim();

        // Parse city and state from "City, State" format
        let city = cityState;
        let state = '';
        if (cityState.includes(',')) {
          const parts = cityState.split(',').map(s => s.trim());
          city = parts[0];
          state = parts.slice(1).join(',').trim();
        }

        // Build formatted address
        const fullAddress = [street, apt, city, state, zip].filter(Boolean).join('\n');

        // Update all orders in this ticket with shipping info
        const { db } = require('../utils/database');
        const ticketOrders = db.prepare(
          'SELECT * FROM orders WHERE ticket_channel_id = ? AND guild_id = ? AND status = ?'
        ).all(interaction.channelId, interaction.guildId, 'awaiting_shipping');

        if (ticketOrders.length > 0) {
          for (const o of ticketOrders) {
            orders.updateShipping(o.id, interaction.guildId, fullName, fullAddress);
          }
        } else {
          orders.updateShipping(orderId, interaction.guildId, fullName, fullAddress);
        }

        // Build order summary
        const allOrders = ticketOrders.length > 0 ? ticketOrders : [orders.getById(orderId, interaction.guildId)];
        let totalPrice = 0;
        const orderLines = [];
        for (const o of allOrders) {
          if (!o) continue;
          const p = products.getById(o.product_id, interaction.guildId);
          if (!p) continue;
          const lineTotal = p.price * o.quantity;
          totalPrice += lineTotal;
          const sizeStr = o.size_label ? ` (${o.size_label})` : '';
          orderLines.push(`• **${p.name}**${sizeStr} x${o.quantity} — ${formatPrice(lineTotal)}`);
        }

        // Build copy-paste block — each field on its own line
        const copyBlock = [fullName, street, apt || '—', city, state, zip].join('\n');

        const summaryEmbed = new EmbedBuilder()
          .setTitle(`📋 Order Summary — Ready to Ship!`)
          .setColor(0x00ff00)
          .setDescription(
            `**Order Items:**\n${orderLines.join('\n')}\n\n**Total: ${formatPrice(totalPrice)}**`
          )
          .addFields(
            { name: '👤 Buyer', value: `<@${interaction.user.id}>`, inline: true },
            { name: '📛 Name', value: fullName, inline: true },
            { name: '📍 Shipping Address', value: `${street}\n${apt ? apt + '\n' : ''}${city}, ${state} ${zip}`, inline: false },
            { name: '📋 Copy for CSV (one field per line)', value: `\`\`\`\n${copyBlock}\n\`\`\``, inline: false },
          )
          .setFooter({ text: 'Staff: Use /tracking to add tracking number and notify buyer' })
          .setTimestamp();

        await interaction.reply({ embeds: [summaryEmbed] });
      }

      // --- Panel edit modal submitted ---
      if (action === 'panel_edit_modal') {
        const panelId = parseInt(args[0]);

        const newTitle = interaction.fields.getTextInputValue('title')?.trim();
        const newDescription = interaction.fields.getTextInputValue('description')?.trim();
        const newColor = interaction.fields.getTextInputValue('color')?.trim();
        const newImage = interaction.fields.getTextInputValue('image')?.trim();
        const newThumbnail = interaction.fields.getTextInputValue('thumbnail')?.trim();

        const panel = db.prepare('SELECT * FROM ticket_panels WHERE id = ? AND guild_id = ?').get(panelId, interaction.guildId);
        if (!panel) {
          return interaction.reply({ content: '❌ Panel not found.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
          const channel = await interaction.client.channels.fetch(panel.channel_id);
          const message = await channel.messages.fetch(panel.message_id);
          const oldEmbed = message.embeds[0];
          if (!oldEmbed) {
            return interaction.editReply({ content: '❌ Could not find the panel embed.' });
          }

          const embed = EmbedBuilder.from(oldEmbed);

          if (newTitle) {
            embed.setTitle(newTitle);
            db.prepare('UPDATE ticket_panels SET title = ? WHERE id = ?').run(newTitle, panelId);
          }
          if (newDescription) {
            embed.setDescription(newDescription);
            db.prepare('UPDATE ticket_panels SET description = ? WHERE id = ?').run(newDescription, panelId);
          }
          if (newColor) {
            const colorInt = parseColor(newColor);
            if (colorInt !== null) {
              embed.setColor(colorInt);
              db.prepare('UPDATE ticket_panels SET color = ? WHERE id = ?').run(newColor, panelId);
            }
          }
          if (newImage) {
            embed.setImage(newImage);
          }
          if (newThumbnail) {
            embed.setThumbnail(newThumbnail);
          }

          // Get buttons from the new button table (with category info)
          const buttons = db.prepare(`
            SELECT b.*, c.name as category_name, c.emoji as category_emoji, c.description as category_description, c.ticket_type
            FROM ticket_panel_buttons b
            JOIN ticket_categories c ON b.category_id = c.id
            WHERE b.panel_id = ?
            ORDER BY b.button_order
          `).all(panelId);

          // Clear existing fields and add button info
          embed.spliceFields(0, embed.data.fields?.length || 0);

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

          // Rebuild buttons from the button table
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

          await message.edit({ embeds: [embed], components: rows });
          await interaction.editReply({ content: '✅ Panel updated!' });
        } catch (e) {
          // Message was deleted or not found — resend it
          try {
            const channel = await interaction.client.channels.fetch(panel.channel_id);
            
            // Get buttons from the new button table
            const buttons = db.prepare(`
              SELECT b.*, c.name as category_name, c.emoji as category_emoji, c.description as category_description, c.ticket_type
              FROM ticket_panel_buttons b
              JOIN ticket_categories c ON b.category_id = c.id
              WHERE b.panel_id = ?
              ORDER BY b.button_order
            `).all(panelId);

            const freshEmbed = new EmbedBuilder()
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
              freshEmbed.addFields({ name: 'Available Tickets', value: buttonList });
            } else if (panel.blank) {
              freshEmbed.addFields({ name: 'ℹ️ Note', value: 'This panel has no buttons yet. Use `/ticket button-add` to add buttons.' });
            } else {
              freshEmbed.addFields({ name: 'ℹ️ Note', value: 'No buttons configured. Use `/ticket button-add` to add buttons.' });
            }

            // Rebuild buttons from the button table
            let freshRows = [];
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
                  freshRows.push(new ActionRowBuilder().addComponents(buttonComponents.slice(i, i + 5)));
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
                freshRows = [new ActionRowBuilder().addComponents(selectMenu)];
              }
            }

            const newMsg = await channel.send({ embeds: [freshEmbed], components: freshRows });
            db.prepare('UPDATE ticket_panels SET message_id = ? WHERE id = ?').run(newMsg.id, panelId);
            await interaction.editReply({ content: '✅ Panel reposted (old message was deleted)!' });
          } catch (e2) {
            await interaction.editReply({ content: `❌ Could not update panel: ${e2.message}` });
          }
        }
      }

      // --- Payment add modal submitted ---
      if (action === 'payment_add_modal') {
        const name = interaction.fields.getTextInputValue('name')?.trim();
        const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || '💳';
        const contactRaw = interaction.fields.getTextInputValue('contact')?.trim() || '';
        const memo = interaction.fields.getTextInputValue('memo')?.trim() || '';
        const extra = interaction.fields.getTextInputValue('extra')?.trim() || '';

        const details = {};
        for (const line of contactRaw.split('\n')) {
          const trimmed = line.trim().toLowerCase();
          if (trimmed.startsWith('phone:')) details.phone = line.split(':').slice(1).join(':').trim();
          else if (trimmed.startsWith('email:')) details.email = line.split(':').slice(1).join(':').trim();
          else if (trimmed.startsWith('tag:')) details.tag = line.split(':').slice(1).join(':').trim();
          else if (trimmed.startsWith('$') || trimmed.startsWith('@')) details.tag = line.trim();
          else if (trimmed.includes('@')) details.email = line.trim();
          else if (/[\d-()]{7,}/.test(trimmed)) details.phone = line.trim();
        }

        if (memo) details.memo = memo;
        if (extra) details.extra = extra;

        const instructions = JSON.stringify(details);
        const id = paymentMethods.add(interaction.guildId, name, instructions, emoji);

        await interaction.reply({
          content: `✅ Payment method **${emoji} ${name}** added! (ID: ${id})`,
          ephemeral: true,
        });
      }

      // --- Payment edit modal submitted ---
      if (action === 'payment_edit_modal') {
        const methodId = parseInt(args[0]);

        const name = interaction.fields.getTextInputValue('name')?.trim();
        const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || '💳';
        const contactRaw = interaction.fields.getTextInputValue('contact')?.trim() || '';
        const memo = interaction.fields.getTextInputValue('memo')?.trim() || '';
        const extra = interaction.fields.getTextInputValue('extra')?.trim() || '';

        // Parse contact lines
        const details = {};
        for (const line of contactRaw.split('\n')) {
          const trimmed = line.trim().toLowerCase();
          if (trimmed.startsWith('phone:')) details.phone = line.split(':').slice(1).join(':').trim();
          else if (trimmed.startsWith('email:')) details.email = line.split(':').slice(1).join(':').trim();
          else if (trimmed.startsWith('tag:')) details.tag = line.split(':').slice(1).join(':').trim();
          else if (trimmed.startsWith('$') || trimmed.startsWith('@')) details.tag = line.trim();
          else if (trimmed.includes('@')) details.email = line.trim();
          else if (/[\d-()]{7,}/.test(trimmed)) details.phone = line.trim();
        }

        if (memo) details.memo = memo;
        if (extra) details.extra = extra;

        const instructions = JSON.stringify(details);

        // Update in DB
        const { db } = require('../utils/database');
        db.prepare('UPDATE payment_methods SET name = ?, instructions = ?, emoji = ? WHERE id = ? AND guild_id = ?')
          .run(name, instructions, emoji, methodId, interaction.guildId);

        await interaction.reply({
          content: `✅ Payment method **${emoji} ${name}** updated!`,
          ephemeral: true,
        });
      }

      // --- Category edit modal submitted ---
      if (action === 'category_edit_modal') {
        const categoryId = parseInt(args[0]);

        const newName = interaction.fields.getTextInputValue('name')?.trim();
        const newDescription = interaction.fields.getTextInputValue('description')?.trim() || '';
        const newEmoji = interaction.fields.getTextInputValue('emoji')?.trim() || '';
        const newTicketType = interaction.fields.getTextInputValue('ticket_type')?.trim() || 'support';
        const newWelcome = interaction.fields.getTextInputValue('welcome')?.trim() || '';

        const category = db.prepare('SELECT * FROM ticket_categories WHERE id = ? AND guild_id = ?').get(categoryId, interaction.guildId);
        if (!category) {
          return interaction.reply({ content: '❌ Category not found.', ephemeral: true });
        }

        if (newName) db.prepare('UPDATE ticket_categories SET name = ? WHERE id = ?').run(newName, categoryId);
        if (newDescription !== undefined) db.prepare('UPDATE ticket_categories SET description = ? WHERE id = ?').run(newDescription, categoryId);
        if (newEmoji) db.prepare('UPDATE ticket_categories SET emoji = ? WHERE id = ?').run(newEmoji, categoryId);
        if (newTicketType !== undefined) db.prepare('UPDATE ticket_categories SET ticket_type = ? WHERE id = ?').run(newTicketType, categoryId);
        if (newWelcome !== undefined) db.prepare('UPDATE ticket_categories SET welcome_message = ? WHERE id = ?').run(newWelcome, categoryId);

        // Rename Discord category folder if name changed (keep clean name, no emoji or "Tickets" suffix)
        if (newName && category.category_channel_id) {
          try {
            const discordCat = await interaction.guild.channels.fetch(category.category_channel_id);
            if (discordCat) {
              await discordCat.setName(newName);
            }
          } catch (e) {}
        }

        // Refresh all panels using new button system
        await interaction.deferReply({ ephemeral: true });

        const panels = db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ?').all(interaction.guildId);

        for (const panel of panels) {
          if (!panel.message_id || !panel.channel_id) continue;
          try {
            const channel = await interaction.client.channels.fetch(panel.channel_id);
            const message = await channel.messages.fetch(panel.message_id);
            const oldEmbed = message.embeds[0];
            if (!oldEmbed) continue;

            // Get buttons from the new button table (with category info)
            const buttons = db.prepare(`
              SELECT b.*, c.name as category_name, c.emoji as category_emoji, c.description as category_description, c.ticket_type
              FROM ticket_panel_buttons b
              JOIN ticket_categories c ON b.category_id = c.id
              WHERE b.panel_id = ?
              ORDER BY b.button_order
            `).all(panel.id);

            const embed = EmbedBuilder.from(oldEmbed);
            embed.spliceFields(0, embed.data.fields?.length || 0);

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

            await message.edit({ embeds: [embed], components: rows });
          } catch (e) {}
        }

        await interaction.editReply({ content: `✅ Category **${newName || category.name}** updated! Panels refreshed.` });
      }
    }
  },
};

// ─── Shipping Info Collection ───────────────────────────────────────────────

async function collectShippingInfo(channel, order, orderId, guildId) {
  // Step 1: Collect name
  const nameFilter = m => m.author.id === order.buyer_id;
  const nameCollector = channel.createMessageCollector({ filter: nameFilter, time: 600000, max: 1 }); // 10 min

  nameCollector.on('collect', async (message) => {
    const buyerName = message.content.trim();
    orders.updateShipping(orderId, guildId, buyerName, '');

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`📬 Shipping Info — Order #${orderId}`)
          .setDescription(`Thanks **${buyerName}**! Now please provide your **full shipping address**:`)
          .setColor(0x5865f2)
          .setTimestamp()
      ],
    });

    // Step 2: Collect address
    const addrFilter = m => m.author.id === order.buyer_id;
    const addrCollector = channel.createMessageCollector({ filter: addrFilter, time: 600000, max: 1 });

    addrCollector.on('collect', async (addrMessage) => {
      const address = addrMessage.content.trim();
      orders.updateShipping(orderId, guildId, buyerName, address);
      orders.updateStatus(orderId, guildId, 'awaiting_shipping');

      const summaryEmbed = new EmbedBuilder()
        .setTitle(`📋 Order #${orderId} — Ready to Ship!`)
        .setColor(0x00ff00)
        .addFields(
          { name: '👤 Buyer', value: `<@${order.buyer_id}>`, inline: true },
          { name: '📛 Name', value: buyerName, inline: true },
          { name: '📍 Address', value: address, inline: false },
          { name: '📦 Product', value: `ID: ${order.product_id}`, inline: true },
          { name: '💳 Payment', value: order.payment_method || 'N/A', inline: true },
        )
        .setFooter({ text: 'Staff: Use /tracking to add tracking number and notify buyer' })
        .setTimestamp();

      await channel.send({ embeds: [summaryEmbed] });
    });

    addrCollector.on('end', (collected, reason) => {
      if (reason === 'time' && collected.size === 0) {
        channel.send({
          content: `⏰ <@${order.buyer_id}>, address input timed out for Order #${orderId}. Please tell staff your address.`,
        }).catch(() => {});
      }
    });
  });

  nameCollector.on('end', (collected, reason) => {
    if (reason === 'time' && collected.size === 0) {
      channel.send({
        content: `⏰ <@${order.buyer_id}>, name input timed out for Order #${orderId}. Please tell staff your name.`,
      }).catch(() => {});
    }
  });
}

// ─── Show Payment Method Buttons ────────────────────────────────────────────

async function showPaymentButtons(interaction, orderId, buyerId, product, sizeLabel = '') {
  const methods = paymentMethods.getAll(interaction.guildId);

  if (methods.length === 0) {
    return interaction.update({
      content: '❌ No payment methods configured! Staff needs to run `/payment-add` first.',
      embeds: [],
      components: [],
    });
  }

  const buttons = methods.slice(0, 5).map(m =>
    new ButtonBuilder()
      .setCustomId(`payment_select:${orderId}:${m.id}`)
      .setLabel(m.name)
      .setEmoji(parseEmoji(m.emoji))
      .setStyle(ButtonStyle.Primary)
  );

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`order_cancel:${orderId}`)
      .setLabel('Cancel Order')
      .setStyle(ButtonStyle.Danger)
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  const embed = new EmbedBuilder()
    .setTitle(`🛒 Order #${orderId}`)
    .setDescription(`<@${buyerId}>, please select your payment method:`)
    .addFields(
      { name: '📦 Product', value: product.name, inline: true },
      { name: '💰 Price', value: formatPrice(product.price), inline: true },
    )
    .setColor(0x5865f2)
    .setTimestamp();

  if (sizeLabel) {
    embed.addFields({ name: '📏 Size', value: sizeLabel, inline: true });
  }
  if (product.image_url) embed.setThumbnail(product.image_url);

  await interaction.update({
    embeds: [embed],
    components: rows,
  });
}

// ─── Ticket Open Handler ────────────────────────────────────────────────────

async function handleTicketOpen(interaction, categoryId) {
  const { db } = require('../utils/database');
  const { PermissionFlagsBits, ChannelType } = require('discord.js');

  const category = db.prepare('SELECT * FROM ticket_categories WHERE id = ? AND guild_id = ?')
    .get(categoryId, interaction.guildId);

  if (!category) {
    return interaction.reply({ content: '❌ Ticket category not found.', ephemeral: true });
  }

  const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?')
    .get(interaction.guildId);

  // Check for existing open tickets from this user in this category (max 6)
  const existingTickets = db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND category_id = ? AND status = ?')
    .all(interaction.guildId, interaction.user.id, categoryId, 'open');

  if (existingTickets.length >= 6) {
    const ticketLinks = existingTickets.map(t => `<#${t.channel_id}>`).join(', ');
    return interaction.reply({
      content: `❌ You already have **6 open tickets** in this category (max reached):\n${ticketLinks}`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  // Get ticket count for numbering
  const countResult = db.prepare('SELECT COALESCE(MAX(id), 0) as count FROM tickets WHERE guild_id = ?')
    .get(interaction.guildId);
  const ticketNum = (countResult.count || 0) + 1;

  // Create the ticket channel — use server nickname
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const displayName = member.nickname || member.displayName || interaction.user.username;
  const channelName = `${category.emoji}-${displayName}-${ticketNum}`.slice(0, 100).replace(/[^a-z0-9-_]/gi, '-');

  const permissionOverwrites = [
    {
      id: interaction.guildId,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
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

  const staffRoleId = category.staff_role_ids || (ticketSettings ? ticketSettings.staff_role_id : '');
  if (staffRoleId) {
    permissionOverwrites.push({
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

  // Verify category channel exists before using it
  let parentId = undefined;
  if (category.category_channel_id) {
    try {
      const cat = await interaction.guild.channels.fetch(category.category_channel_id);
      if (cat) parentId = cat.id;
    } catch (_) {
      // Category no longer exists, create ticket without a category folder
    }
  }

  const ticketChannel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parentId,
    permissionOverwrites,
    reason: `Ticket opened by ${interaction.user.tag}`,
  });

  const stmt = db.prepare('INSERT INTO tickets (guild_id, channel_id, user_id, category_id, panel_id) VALUES (?, ?, ?, ?, ?)');
  const result = stmt.run(interaction.guildId, ticketChannel.id, interaction.user.id, categoryId, category.panel_id || null);
  const ticketId = result.lastInsertRowid;

  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`${category.emoji} ${category.name} — Ticket #${ticketId}`)
    .setDescription(
      category.welcome_message ||
      `Hey <@${interaction.user.id}>! A staff member will be with you shortly.\n\nPlease describe what you need help with.`
    )
    .addFields(
      { name: '👤 Opened by', value: `<@${interaction.user.id}>`, inline: true },
      { name: '📁 Category', value: category.name, inline: true },
      { name: '🔢 Ticket ID', value: `#${ticketId}`, inline: true },
    )
    .setColor(0x5865f2)
    .setTimestamp();

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_close_confirm:${ticketId}`)
      .setLabel('🔒 Close Ticket')
      .setStyle(ButtonStyle.Danger),
  );

  await ticketChannel.send({
    content: `<@${interaction.user.id}>${staffRoleId ? ` <@&${staffRoleId}>` : ''}`,
    embeds: [welcomeEmbed],
    components: [controlRow],
  });

  // If this is a Purchase category, auto-show the product picker for the buyer
  const catNameLower = category.name.toLowerCase();
  if (category.ticket_type === 'purchase' || catNameLower.includes('purchase') || catNameLower.includes('buy') || catNameLower.includes('order')) {
    const inStockProducts = products.getInStock(interaction.guildId);

    if (inStockProducts.length > 0) {
      const options = inStockProducts.slice(0, 25).map(p => {
        const sizes = productSizes.getByProduct(p.id, interaction.guildId);
        const totalStock = sizes.length > 0
          ? sizes.reduce((sum, s) => sum + s.stock, 0)
          : p.stock;
        return {
          label: p.name.slice(0, 100),
          description: `$${p.price.toFixed(2)} | ${totalStock} in stock`,
          value: String(p.id),
        };
      });

      const productMenu = new StringSelectMenuBuilder()
        .setCustomId(`buyer_product_select:${interaction.user.id}:${ticketId}`)
        .setPlaceholder('👇 What would you like to buy?')
        .addOptions(options);

      const productRow = new ActionRowBuilder().addComponents(productMenu);

      const shopEmbed = new EmbedBuilder()
        .setTitle('🛒 What would you like to purchase?')
        .setDescription('Select a product from the dropdown below:')
        .setColor(0x5865f2);

      await ticketChannel.send({ embeds: [shopEmbed], components: [productRow] });
    }
  }

  await interaction.editReply({
    content: `✅ Your ticket has been created: ${ticketChannel}`,
  });

  // Log
  if (ticketSettings && ticketSettings.log_channel_id) {
    try {
      const logChannel = await interaction.client.channels.fetch(ticketSettings.log_channel_id);
      const logEmbed = new EmbedBuilder()
        .setTitle(`🎫 Ticket #${ticketId} Opened`)
        .addFields(
          { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Category', value: category.name, inline: true },
          { name: 'Channel', value: `<#${ticketChannel.id}>`, inline: true },
        )
        .setColor(0x00ff00)
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    } catch (e) {}
  }
}

// ─── Ticket Close Handler ───────────────────────────────────────────────────

async function handleTicketClose(interaction, ticketId) {
  const { db } = require('../utils/database');
  const { generateTranscript } = require('../utils/transcript');

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ? AND guild_id = ?')
    .get(ticketId, interaction.guildId);

  if (!ticket || ticket.status !== 'open') {
    try {
      await interaction.update({ content: '🔒 Closing and deleting ticket in 5 seconds...', components: [] });
    } catch (e) {
      await interaction.reply({ content: '🔒 Closing and deleting ticket in 5 seconds...', ephemeral: false }).catch(() => {});
    }
    setTimeout(async () => {
      try { await interaction.channel.delete('Ticket closed'); } catch (e) {}
    }, 5000);
    return;
  }

  await interaction.update({ content: '📝 Saving transcript and closing...', components: [] });

  // Fetch all messages (up to 500)
  let allMessages = [];
  try {
    let lastId;
    let fetching = true;
    while (fetching) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;
      const batch = await interaction.channel.messages.fetch(options);
      if (batch.size === 0) break;
      allMessages.push(...batch.values());
      lastId = batch.last().id;
      if (batch.size < 100 || allMessages.length >= 500) fetching = false;
    }
  } catch (e) {}

  // Generate HTML transcript
  const html = generateTranscript(allMessages, interaction.channel, interaction.guild);

  // Send transcript to transcript channel as HTML file
  const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?')
    .get(interaction.guildId);

  const { AttachmentBuilder } = require('discord.js');
  const htmlFile = new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `ticket-${ticketId}-${interaction.channel.name}.html` });

  if (ticketSettings && ticketSettings.transcript_channel_id) {
    try {
      const transcriptChannel = await interaction.client.channels.fetch(ticketSettings.transcript_channel_id);
      const category = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(ticket.category_id);

      const transcriptEmbed = new EmbedBuilder()
        .setTitle(`📝 Transcript — Ticket #${ticketId}`)
        .setDescription(`📎 Download the HTML file below and open it in your browser to view the full transcript.`)
        .addFields(
          { name: 'User', value: `<@${ticket.user_id}>`, inline: true },
          { name: 'Category', value: category ? category.name : 'N/A', inline: true },
          { name: 'Claimed by', value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Unclaimed', inline: true },
          { name: 'Messages', value: `${allMessages.length}`, inline: true },
        )
        .setColor(0xff0000)
        .setTimestamp();

      await transcriptChannel.send({ embeds: [transcriptEmbed], files: [htmlFile] });
    } catch (e) {}
  }

  // Update DB
  const sorted = [...allMessages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const plainTranscript = sorted.map(m => {
    const time = m.createdAt.toISOString();
    const attachments = m.attachments.size > 0 ? ` [${m.attachments.map(a => a.url).join(', ')}]` : '';
    return `[${time}] ${m.author.tag}: ${m.content}${attachments}`;
  }).join('\n');

  db.prepare('UPDATE tickets SET status = ?, transcript = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('closed', plainTranscript, ticketId);

  // Log closure
  if (ticketSettings && ticketSettings.log_channel_id) {
    try {
      const logChannel = await interaction.client.channels.fetch(ticketSettings.log_channel_id);
      const logEmbed = new EmbedBuilder()
        .setTitle(`🔒 Ticket #${ticketId} Closed`)
        .addFields(
          { name: 'User', value: `<@${ticket.user_id}>`, inline: true },
          { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setColor(0xff0000)
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    } catch (e) {}
  }

  // Post close message then delete
  const closeEmbed = new EmbedBuilder()
    .setTitle('🔒 Ticket Closed')
    .setDescription(`Closed by <@${interaction.user.id}>. Transcript saved.\nChannel will be deleted in 5 seconds...`)
    .setColor(0xff0000)
    .setTimestamp();

  await interaction.channel.send({ embeds: [closeEmbed] });

  // Lock the channel immediately
  try {
    await interaction.channel.permissionOverwrites.edit(ticket.user_id, {
      SendMessages: false,
    });
  } catch (e) {}

  // Delete after 5 seconds
  setTimeout(async () => {
    try { await interaction.channel.delete('Ticket closed'); } catch (e) {}
  }, 5000);
}

// ─── Show Cart + Add More / Checkout Buttons ───────────────────────────────

async function showCartAndOptions(interaction, buyerId, ticketId) {
  const { cart } = require('../utils/cart');
  const cartItems = cart.getByTicket(interaction.channelId, interaction.guildId);

  if (cartItems.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('🛒 Your Cart is Empty')
      .setDescription('All items were removed. Pick something to add:')
      .setColor(0x5865f2);

    const inStockProducts = products.getInStock(interaction.guildId);
    if (inStockProducts.length > 0) {
      const options = inStockProducts.slice(0, 25).map(p => ({
        label: p.name.slice(0, 100),
        description: `$${p.price.toFixed(2)}`,
        value: String(p.id),
      }));

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`buyer_product_select:${buyerId}:${ticketId}`)
        .setPlaceholder('👇 Pick a product')
        .addOptions(options);

      await interaction.update({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    } else {
      await interaction.update({ embeds: [embed], components: [] });
    }
    return;
  }

  // Build cart display
  let totalPrice = 0;
  const lines = [];
  const removeButtons = [];

  for (const item of cartItems) {
    const product = products.getById(item.product_id, interaction.guildId);
    if (!product) continue;

    const lineTotal = product.price * item.quantity;
    totalPrice += lineTotal;
    const sizeStr = item.size_label ? ` (${item.size_label})` : '';
    lines.push(`• **${product.name}**${sizeStr} x${item.quantity} — ${formatPrice(lineTotal)}`);

    // Add remove button (max 5 for the row)
    if (removeButtons.length < 4) {
      removeButtons.push(
        new ButtonBuilder()
          .setCustomId(`buyer_remove_item:${buyerId}:${ticketId}:${item.id}`)
          .setLabel(`Remove ${product.name.slice(0, 20)}${sizeStr}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
  }

  const embed = new EmbedBuilder()
    .setTitle('🛒 Your Cart')
    .setDescription(lines.join('\n') + `\n\n**Total: ${formatPrice(totalPrice)}**`)
    .setColor(0x5865f2)
    .setFooter({ text: `${cartItems.length} item(s)` })
    .setTimestamp();

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`buyer_confirm:${buyerId}:${ticketId}`)
      .setLabel(`✅ Checkout — ${formatPrice(totalPrice)}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`buyer_add_more:${buyerId}:${ticketId}`)
      .setLabel('➕ Add More Items')
      .setStyle(ButtonStyle.Primary),
  );

  const rows = [actionRow];
  if (removeButtons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(removeButtons));
  }

  await interaction.update({ embeds: [embed], components: rows });
}
