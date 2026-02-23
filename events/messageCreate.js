const { EmbedBuilder } = require('discord.js');
const { settings } = require('../utils/database');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Ignore bots
    if (message.author.bot) return;
    if (!message.guild) return;

    // Check if this is the image channel
    const guildSettings = settings.get(message.guildId);
    if (!guildSettings || !guildSettings.image_channel_id) return;
    if (message.channelId !== guildSettings.image_channel_id) return;

    // Check for attachments (images)
    const images = message.attachments.filter(a =>
      a.contentType && a.contentType.startsWith('image/')
    );

    if (images.size === 0) return;

    const urls = images.map((img, index) => {
      return `**Image ${index + 1}:** \`${img.url}\``;
    });

    const embed = new EmbedBuilder()
      .setTitle('🖼️ Image URL(s) Ready')
      .setDescription(
        urls.join('\n\n') +
        '\n\n**Copy the URL above** and use it with:\n`/product-add image:PASTE_URL_HERE`\nor `/product-edit`'
      )
      .setColor(0x5865f2)
      .setFooter({ text: 'Click the URL to copy it' })
      .setTimestamp();

    // Show first image as thumbnail
    const firstImage = images.first();
    if (firstImage) embed.setThumbnail(firstImage.url);

    await message.reply({ embeds: [embed] });
  },
};
