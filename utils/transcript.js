const fs = require('fs');
const path = require('path');

const TRANSCRIPTS_DIR = path.join(__dirname, '..', 'transcripts');
if (!fs.existsSync(TRANSCRIPTS_DIR)) fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });

/**
 * Generate an HTML transcript that looks like Discord chat
 */
function generateTranscript(messages, channel, guild) {
  const sorted = [...messages].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const messageHTML = sorted.map(msg => {
    const time = new Date(msg.createdTimestamp).toLocaleString('en-US', {
      month: '2-digit', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

    const avatar = msg.author.displayAvatarURL({ size: 64, extension: 'png' });
    const name = msg.member?.displayName || msg.author.displayName || msg.author.username;
    const nameColor = msg.member?.displayHexColor !== '#000000' ? msg.member?.displayHexColor : '#ffffff';

    // Process content — basic markdown
    let content = escapeHtml(msg.content || '');
    content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    content = content.replace(/\*(.+?)\*/g, '<em>$1</em>');
    content = content.replace(/~~(.+?)~~/g, '<del>$1</del>');
    content = content.replace(/`(.+?)`/g, '<code>$1</code>');
    content = content.replace(/\n/g, '<br>');
    // User mentions
    content = content.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@user</span>');
    // Channel mentions
    content = content.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#channel</span>');

    // Attachments
    let attachmentHTML = '';
    if (msg.attachments.size > 0) {
      for (const [, att] of msg.attachments) {
        if (att.contentType?.startsWith('image/')) {
          attachmentHTML += `<div class="attachment"><img src="${escapeHtml(att.url)}" alt="attachment" /></div>`;
        } else {
          attachmentHTML += `<div class="attachment"><a href="${escapeHtml(att.url)}" target="_blank">📎 ${escapeHtml(att.name)}</a></div>`;
        }
      }
    }

    // Embeds
    let embedHTML = '';
    if (msg.embeds.length > 0) {
      for (const embed of msg.embeds) {
        const color = embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#5865f2';
        embedHTML += `<div class="embed" style="border-left-color: ${color}">`;
        if (embed.title) embedHTML += `<div class="embed-title">${escapeHtml(embed.title)}</div>`;
        if (embed.description) embedHTML += `<div class="embed-desc">${escapeHtml(embed.description)}</div>`;
        if (embed.fields?.length > 0) {
          embedHTML += '<div class="embed-fields">';
          for (const field of embed.fields) {
            embedHTML += `<div class="embed-field${field.inline ? ' inline' : ''}">`;
            embedHTML += `<div class="field-name">${escapeHtml(field.name)}</div>`;
            embedHTML += `<div class="field-value">${escapeHtml(field.value)}</div>`;
            embedHTML += '</div>';
          }
          embedHTML += '</div>';
        }
        if (embed.image) embedHTML += `<div class="embed-image"><img src="${escapeHtml(embed.image.url)}" /></div>`;
        if (embed.thumbnail) embedHTML += `<div class="embed-thumb"><img src="${escapeHtml(embed.thumbnail.url)}" /></div>`;
        embedHTML += '</div>';
      }
    }

    const isBot = msg.author.bot;

    return `
      <div class="message${isBot ? ' bot-message' : ''}">
        <div class="avatar"><img src="${avatar}" alt="" /></div>
        <div class="content">
          <div class="header">
            <span class="name" style="color: ${nameColor}">${escapeHtml(name)}</span>
            ${isBot ? '<span class="bot-tag">BOT</span>' : ''}
            <span class="time">${time}</span>
          </div>
          ${content ? `<div class="text">${content}</div>` : ''}
          ${attachmentHTML}
          ${embedHTML}
        </div>
      </div>`;
  }).join('\n');

  const channelName = channel.name || 'ticket';
  const guildName = guild.name || 'Server';
  const guildIcon = guild.iconURL({ size: 64, extension: 'png' }) || '';
  const msgCount = sorted.length;
  const created = channel.createdAt ? new Date(channel.createdAt).toLocaleString('en-US') : 'Unknown';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>#${escapeHtml(channelName)} — ${escapeHtml(guildName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #313338;
      color: #dbdee1;
      font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.375;
    }

    .header-bar {
      background: #2b2d31;
      border-bottom: 1px solid #1e1f22;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header-bar img.guild-icon {
      width: 40px; height: 40px; border-radius: 50%;
    }

    .header-bar .info h1 {
      font-size: 16px; font-weight: 600; color: #f2f3f5;
    }

    .header-bar .info .meta {
      font-size: 12px; color: #949ba4;
    }

    .messages {
      padding: 16px 0;
      max-width: 100%;
    }

    .message {
      display: flex;
      padding: 2px 48px 2px 72px;
      position: relative;
      min-height: 44px;
    }

    .message:hover { background: #2e3035; }

    .message .avatar {
      position: absolute;
      left: 16px;
      width: 40px; height: 40px;
    }

    .message .avatar img {
      width: 40px; height: 40px; border-radius: 50%;
    }

    .message .content { flex: 1; min-width: 0; }

    .message .header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 2px;
    }

    .message .name {
      font-weight: 600;
      font-size: 15px;
      cursor: pointer;
    }

    .message .name:hover { text-decoration: underline; }

    .bot-tag {
      background: #5865f2;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      padding: 1px 4px;
      border-radius: 3px;
      text-transform: uppercase;
      vertical-align: middle;
    }

    .message .time {
      color: #949ba4;
      font-size: 12px;
    }

    .message .text {
      color: #dbdee1;
      word-wrap: break-word;
    }

    .message .text code {
      background: #2b2d31;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13.6px;
    }

    .mention {
      background: rgba(88, 101, 242, 0.3);
      color: #c9cdfb;
      padding: 0 2px;
      border-radius: 3px;
      font-weight: 500;
    }

    .attachment { margin-top: 8px; }

    .attachment img {
      max-width: 400px;
      max-height: 300px;
      border-radius: 8px;
    }

    .attachment a {
      color: #00a8fc;
      text-decoration: none;
    }

    .embed {
      margin-top: 8px;
      background: #2b2d31;
      border-left: 4px solid #5865f2;
      border-radius: 4px;
      padding: 12px;
      max-width: 520px;
    }

    .embed-title {
      font-weight: 700;
      color: #f2f3f5;
      margin-bottom: 4px;
    }

    .embed-desc {
      color: #dbdee1;
      font-size: 14px;
      white-space: pre-wrap;
    }

    .embed-fields {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .embed-field { flex: 0 0 100%; }
    .embed-field.inline { flex: 0 0 calc(33.3% - 8px); }

    .field-name {
      font-weight: 700;
      color: #f2f3f5;
      font-size: 13px;
      margin-bottom: 2px;
    }

    .field-value {
      color: #dbdee1;
      font-size: 14px;
      white-space: pre-wrap;
    }

    .embed-image img, .embed-thumb img {
      max-width: 400px;
      max-height: 300px;
      border-radius: 4px;
      margin-top: 8px;
    }

    .footer-bar {
      background: #2b2d31;
      border-top: 1px solid #1e1f22;
      padding: 16px 24px;
      text-align: center;
      color: #949ba4;
      font-size: 13px;
    }

    @media (max-width: 600px) {
      .message { padding: 2px 12px 2px 56px; }
      .message .avatar { left: 8px; }
      .embed { max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="header-bar">
    ${guildIcon ? `<img class="guild-icon" src="${guildIcon}" alt="" />` : ''}
    <div class="info">
      <h1># ${escapeHtml(channelName)}</h1>
      <div class="meta">${escapeHtml(guildName)} • ${msgCount} messages • Created ${created}</div>
    </div>
  </div>
  <div class="messages">
    ${messageHTML}
  </div>
  <div class="footer-bar">
    Transcript generated ${new Date().toLocaleString('en-US')} • ${msgCount} messages
  </div>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Save transcript and return filename
 */
function saveTranscript(html, channelName) {
  const timestamp = Date.now();
  const safeName = channelName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const filename = `${safeName}-${timestamp}.html`;
  const filepath = path.join(TRANSCRIPTS_DIR, filename);
  fs.writeFileSync(filepath, html, 'utf-8');
  return filename;
}

module.exports = { generateTranscript, saveTranscript, TRANSCRIPTS_DIR };
