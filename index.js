require('dotenv').config();
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ─── Load Commands ──────────────────────────────────────────────────────────

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
    console.log(`  ✅ Loaded command: /${command.data.name}`);
  }
}

// ─── Load Events ────────────────────────────────────────────────────────────

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  console.log(`  ✅ Loaded event: ${event.name}`);
}

// ─── Ready ──────────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`\n🚀 Bot is online! Logged in as ${client.user.tag}`);
  console.log(`   Serving ${client.guilds.cache.size} server(s)`);
  console.log(`   ${client.commands.size} commands loaded\n`);
});

// ─── Login ──────────────────────────────────────────────────────────────────

if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'your-bot-token-here') {
  console.error('❌ No bot token! Copy .env.example to .env and add your token.');
  console.error('   See README.md for setup instructions.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
