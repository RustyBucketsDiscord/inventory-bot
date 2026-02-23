const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { settings, db } = require('../utils/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Server setup')
    .addSubcommand(sub =>
      sub.setName('brand')
        .setDescription('Set bot name and avatar')
        .addStringOption(opt => opt.setName('name').setDescription('Bot display name').setRequired(false))
        .addStringOption(opt => opt.setName('avatar').setDescription('Avatar image URL').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('image-channel')
        .setDescription('Set or create the image hosting channel')
        .addChannelOption(opt => opt.setName('channel').setDescription('Existing channel (leave empty to auto-create)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('staff-channel')
        .setDescription('Create a staff-only channel')
        .addStringOption(opt => opt.setName('name').setDescription('Channel name').setRequired(true))
        .addStringOption(opt => opt.setName('emoji').setDescription('Emoji prefix').setRequired(false))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'brand') {
      const name = interaction.options.getString('name') || '';
      const avatar = interaction.options.getString('avatar') || '';

      if (!name && !avatar) {
        return interaction.reply({ content: '⚠️ Provide a name or avatar URL.', ephemeral: true });
      }

      settings.set(interaction.guildId, { botName: name, botAvatar: avatar });

      const parts = [];

      if (name) {
        try {
          const me = await interaction.guild.members.fetchMe();
          await me.setNickname(name);
          parts.push(`📛 Name: **${name}**`);
        } catch (e) {
          parts.push(`📛 Name saved but could not set nickname`);
        }
      }

      if (avatar) {
        try {
          const me = await interaction.guild.members.fetchMe();
          await me.setAvatar(avatar);
          parts.push('🖼️ Per-server avatar set!');
        } catch (e) {
          try {
            await interaction.client.user.setAvatar(avatar);
            parts.push('🖼️ Global avatar set! (Per-server needs bot in 2+ servers)');
          } catch (e2) {
            parts.push(`⚠️ Could not set avatar: ${e2.message?.includes('rate') ? 'Rate limited' : 'Error'}`);
          }
        }
      }

      await interaction.reply({ content: `✅ Branding updated!\n${parts.join('\n')}`, ephemeral: true });
    }

    if (sub === 'image-channel') {
      await interaction.deferReply({ ephemeral: true });

      const channelOption = interaction.options.getChannel('channel');
      let channel;

      if (channelOption) {
        channel = channelOption;
      } else {
        // Auto-create
        const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
        const staffRoleId = ticketSettings?.staff_role_id;

        const perms = [
          { id: interaction.guildId, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
        ];
        if (staffRoleId) {
          perms.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] });
        }

        channel = await interaction.guild.channels.create({
          name: '🖼️-image-hosting',
          type: ChannelType.GuildText,
          permissionOverwrites: perms,
          reason: 'Image hosting channel',
        });
      }

      settings.set(interaction.guildId, { imageChannelId: channel.id });

      await interaction.editReply({
        content: `✅ Image hosting channel set: ${channel}\n📸 Upload images there and the bot will return the URL to use in products.`,
      });
    }

    if (sub === 'staff-channel') {
      await interaction.deferReply({ ephemeral: true });

      const name = interaction.options.getString('name');
      const emoji = interaction.options.getString('emoji') || '';

      const ticketSettings = db.prepare('SELECT * FROM ticket_settings WHERE guild_id = ?').get(interaction.guildId);
      if (!ticketSettings || !ticketSettings.staff_role_id) {
        return interaction.editReply({ content: '❌ No staff role configured. Run `/ticket setup` first.' });
      }

      const channelName = emoji ? `${emoji}-${name}` : name;

      const channel = await interaction.guild.channels.create({
        name: channelName.toLowerCase().replace(/[^a-z0-9-_\p{Emoji}]/giu, '-').slice(0, 100),
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guildId, deny: [PermissionFlagsBits.ViewChannel] },
          { id: ticketSettings.staff_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
          { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
        ],
        reason: `Staff channel created by ${interaction.user.tag}`,
      });

      const roleName = interaction.guild.roles.cache.get(ticketSettings.staff_role_id)?.name || 'Staff';
      await interaction.editReply({ content: `✅ Staff-only channel created: ${channel}\n🔒 Only **${roleName}** and admins can see it.` });
    }
  },
};
