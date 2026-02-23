const { EmbedBuilder } = require('discord.js');

/**
 * Build a product embed for display in inventory channels
 */
function buildProductEmbed(product, sizes = []) {
  const hasSizes = sizes.length > 0;
  const totalStock = hasSizes
    ? sizes.reduce((sum, s) => sum + s.stock, 0)
    : product.stock;

  const stockStatus = totalStock > 0
    ? `🟢 In Stock (${totalStock} total)`
    : '🔴 Out of Stock';

  const embed = new EmbedBuilder()
    .setTitle(product.name)
    .setDescription(product.description || 'No description')
    .addFields(
      { name: '💰 Price', value: `$${product.price.toFixed(2)}`, inline: true },
      { name: '📦 Stock', value: stockStatus, inline: true },
      { name: '📁 Category', value: product.category || 'General', inline: true },
    )
    .setColor(totalStock > 0 ? 0x00ff00 : 0xff0000)
    .setFooter({ text: `Product ID: ${product.id}` })
    .setTimestamp();

  // Show sizes breakdown
  if (hasSizes) {
    const sizeLines = sizes.map(s => {
      const icon = s.stock > 0 ? '🟢' : '🔴';
      return `${icon} **${s.label}** — ${s.stock} in stock`;
    });
    embed.addFields({ name: '📏 Sizes', value: sizeLines.join('\n') || 'None', inline: false });
  }

  if (product.image_url) {
    embed.setImage(product.image_url);
  }

  return embed;
}

/**
 * Build an order summary embed
 */
function buildOrderEmbed(order, product, buyer) {
  const statusEmoji = {
    pending: '⏳',
    awaiting_payment: '💰',
    payment_submitted: '📸',
    payment_approved: '✅',
    awaiting_shipping: '📬',
    shipped: '🚚',
    completed: '✅',
    cancelled: '❌',
    denied: '🚫',
  };

  const embed = new EmbedBuilder()
    .setTitle(`Order #${order.id}`)
    .setColor(order.status === 'cancelled' || order.status === 'denied' ? 0xff0000 : 0x5865f2)
    .addFields(
      { name: '🛒 Product', value: product ? product.name : 'Unknown', inline: true },
      { name: '💰 Price', value: product ? `$${product.price.toFixed(2)}` : 'N/A', inline: true },
      { name: '📊 Status', value: `${statusEmoji[order.status] || '❓'} ${order.status.replace(/_/g, ' ').toUpperCase()}`, inline: true },
      { name: '👤 Buyer', value: buyer ? `<@${buyer.id}>` : `<@${order.buyer_id}>`, inline: true },
    )
    .setTimestamp(new Date(order.created_at));

  if (order.size_label) {
    embed.addFields({ name: '📏 Size', value: order.size_label, inline: true });
  }
  if (order.payment_method) {
    embed.addFields({ name: '💳 Payment Method', value: order.payment_method, inline: true });
  }
  if (order.buyer_name) {
    embed.addFields({ name: '📛 Name', value: order.buyer_name, inline: true });
  }
  if (order.buyer_address) {
    embed.addFields({ name: '📍 Address', value: order.buyer_address, inline: false });
  }
  if (order.tracking_number) {
    embed.addFields({ name: '📦 Tracking', value: order.tracking_number, inline: false });
  }
  if (order.staff_id) {
    embed.addFields({ name: '👨‍💼 Staff', value: `<@${order.staff_id}>`, inline: true });
  }

  return embed;
}

/**
 * Check if a member has admin/management permissions
 */
function isStaff(member) {
  return member.permissions.has('ManageGuild') || member.permissions.has('Administrator');
}

/**
 * Format currency
 */
function formatPrice(price) {
  return `$${Number(price).toFixed(2)}`;
}

/**
 * Format payment instructions for display
 */
function formatPaymentInstructions(method, totalPrice) {
  let details;
  try {
    details = JSON.parse(method.instructions);
  } catch (e) {
    // Old format — plain text instructions
    return method.instructions;
  }

  const lines = [];

  if (details.tag) lines.push(`🏷️ **Tag:** \`${details.tag}\``);
  if (details.phone) lines.push(`📱 **Phone:** \`${details.phone}\``);
  if (details.email) lines.push(`📧 **Email:** \`${details.email}\``);
  if (totalPrice) lines.push(`💵 **Amount:** \`${formatPrice(totalPrice)}\``);
  if (details.memo) lines.push(`📝 **Memo:** ${details.memo}`);
  if (details.extra) lines.push(`\n📋 ${details.extra}`);

  return lines.join('\n');
}

/**
 * Parse color — accepts hex codes (#ff0000) or color names (red, blue, etc.)
 */
function parseColor(input) {
  if (!input) return null;
  input = input.trim().toLowerCase();

  const colorNames = {
    red: '#ff0000', darkred: '#8b0000', orange: '#ff8c00', yellow: '#ffd700',
    gold: '#ffd700', green: '#00ff00', darkgreen: '#006400', lime: '#00ff00',
    teal: '#008080', cyan: '#00ffff', blue: '#0099ff', darkblue: '#00008b',
    navy: '#000080', purple: '#9b59b6', violet: '#8b00ff', pink: '#ff69b4',
    hotpink: '#ff69b4', magenta: '#ff00ff', white: '#ffffff', black: '#000001',
    gray: '#808080', grey: '#808080', silver: '#c0c0c0', brown: '#8b4513',
    blurple: '#5865f2', discord: '#5865f2', greyple: '#99aab5',
    aqua: '#1abc9c', coral: '#e74c3c', crimson: '#dc143c', indigo: '#4b0082',
    peach: '#ffb7a1', mint: '#98ff98', lavender: '#b57edc', salmon: '#fa8072',
    sky: '#87ceeb', forest: '#228b22', wine: '#722f37', rose: '#ff007f', ice: '#a5f2f3',
  };

  if (colorNames[input]) return parseInt(colorNames[input].replace('#', ''), 16);
  const hex = input.replace('#', '');
  const parsed = parseInt(hex, 16);
  if (!isNaN(parsed) && hex.length === 6) return parsed;
  return null;
}

// ─── Size Sorting ───────────────────────────────────────────────────────────

const CLOTHING_ORDER = {
  'xxxs': 1, '3xs': 1,
  'xxs': 2, '2xs': 2,
  'xs': 3,
  's': 4, 'small': 4, 'sm': 4,
  'm': 5, 'medium': 5, 'med': 5,
  'l': 6, 'large': 6, 'lg': 6,
  'xl': 7,
  'xxl': 8, '2xl': 8,
  'xxxl': 9, '3xl': 9,
  'xxxxl': 10, '4xl': 10,
  'xxxxxl': 11, '5xl': 11,
  'os': 50, 'one size': 50, 'onesize': 50, 'free': 50,
};

function getSizeSortKey(label) {
  const lower = label.toLowerCase().trim();
  if (CLOTHING_ORDER[lower] !== undefined) return CLOTHING_ORDER[lower];
  const sizeMatch = lower.match(/^size\s+(\d+\.?\d*)$/);
  if (sizeMatch) return 100 + parseFloat(sizeMatch[1]);
  const num = parseFloat(lower);
  if (!isNaN(num)) return 100 + num;
  const numMatch = lower.match(/(\d+\.?\d*)/);
  if (numMatch) return 100 + parseFloat(numMatch[1]);
  return 1000;
}

function sortSizeLabels(labels) {
  return [...labels].sort((a, b) => {
    const keyA = getSizeSortKey(a);
    const keyB = getSizeSortKey(b);
    if (keyA !== keyB) return keyA - keyB;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

/**
 * Parse sizes from text input — supports "Small:5, Medium:8" or "Small:5\nMedium:8"
 */
function parseSizesInput(text) {
  if (!text || !text.trim()) return [];
  // Split by newlines or commas
  const parts = text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  const sizes = [];
  for (const part of parts) {
    const colonIdx = part.lastIndexOf(':');
    if (colonIdx > 0) {
      const label = part.slice(0, colonIdx).trim();
      const stock = parseInt(part.slice(colonIdx + 1).trim());
      if (label && !isNaN(stock)) {
        sizes.push({ label, stock });
      }
    }
  }
  // Sort them
  const sortedLabels = sortSizeLabels(sizes.map(s => s.label));
  return sortedLabels.map(label => sizes.find(s => s.label === label));
}

/**
 * Parse emoji string — handles standard emoji, custom <:name:id>, and animated <a:name:id>
 * Returns the string as-is for standard emoji, or { id, name, animated } for custom
 */
function parseEmoji(str) {
  if (!str) return null;
  str = str.trim();

  // Custom emoji format: <:name:id> or <a:name:id>
  const customMatch = str.match(/^<(a?):(\w+):(\d+)>$/);
  if (customMatch) {
    return {
      animated: customMatch[1] === 'a',
      name: customMatch[2],
      id: customMatch[3],
    };
  }

  // Just an ID (numbers only)
  if (/^\d+$/.test(str)) {
    return { id: str };
  }

  // Standard unicode emoji — return as-is
  return str;
}

module.exports = { buildProductEmbed, buildOrderEmbed, isStaff, formatPrice, formatPaymentInstructions, parseColor, getSizeSortKey, sortSizeLabels, parseSizesInput, parseEmoji };
