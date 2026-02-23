const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require('discord.js');
const { paymentMethods } = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('payment')
    .setDescription('Manage payment methods')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Add a payment method — opens a popup form')
    )
    .addSubcommand(sub =>
      sub.setName('edit')
        .setDescription('Edit a payment method — opens a popup form')
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a payment method')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const modal = new ModalBuilder()
        .setCustomId('payment_add_modal')
        .setTitle('💳 Add Payment Method');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('name').setLabel('Payment Method Name')
            .setPlaceholder('Zelle, CashApp, PayPal, Venmo...').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('emoji').setLabel('Button Emoji')
            .setPlaceholder('💸').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('contact').setLabel('Phone / Email / Tag (one per line)')
            .setPlaceholder('Phone: 743-232-1234\nEmail: pay@me.com\nTag: $MyTag').setStyle(TextInputStyle.Paragraph).setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('memo').setLabel('Memo / Note instructions')
            .setPlaceholder('Write "gift" in the memo').setStyle(TextInputStyle.Short).setRequired(false)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('extra').setLabel('Extra Instructions')
            .setPlaceholder('Any additional info for the buyer').setStyle(TextInputStyle.Paragraph).setRequired(false)
        ),
      );

      await interaction.showModal(modal);
    }

    if (sub === 'edit') {
      const methods = paymentMethods.getAll(interaction.guildId);
      if (methods.length === 0) {
        return interaction.reply({ content: '❌ No payment methods found.', ephemeral: true });
      }

      const options = methods.map(m => ({
        label: `${m.emoji} ${m.name}`,
        description: `ID: ${m.id}`,
        value: String(m.id),
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('payment_edit_select')
        .setPlaceholder('Select a payment method to edit')
        .addOptions(options);

      await interaction.reply({
        content: '✏️ Which payment method do you want to edit?',
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        ephemeral: true,
      });
    }

    if (sub === 'remove') {
      const methods = paymentMethods.getAll(interaction.guildId);
      if (methods.length === 0) {
        return interaction.reply({ content: '❌ No payment methods found.', ephemeral: true });
      }

      const options = methods.map(m => ({
        label: `${m.emoji} ${m.name}`,
        description: m.instructions.slice(0, 100),
        value: String(m.id),
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('payment_remove_select')
        .setPlaceholder('Select a payment method to remove')
        .addOptions(options);

      await interaction.reply({
        content: '🗑️ Which payment method do you want to remove?',
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        ephemeral: true,
      });
    }
  },
};
