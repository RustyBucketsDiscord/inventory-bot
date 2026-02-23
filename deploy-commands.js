require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`  📦 Registered: /${command.data.name}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\n🔄 Deploying ${commands.length} slash commands...\n`);

    // Global commands (available in all servers)
    const data = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );

    console.log(`\n✅ Successfully deployed ${data.length} commands globally!`);
    console.log('⏳ Note: Global commands can take up to 1 hour to appear in Discord.\n');
    console.log('💡 Tip: For instant testing, use guild-specific deployment:');
    console.log('   node deploy-commands.js --guild YOUR_GUILD_ID\n');
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
})();

// Support guild-specific deployment for instant testing
if (process.argv.includes('--guild')) {
  const guildIndex = process.argv.indexOf('--guild');
  const guildId = process.argv[guildIndex + 1];

  if (!guildId) {
    console.error('❌ Please provide a guild ID: node deploy-commands.js --guild YOUR_GUILD_ID');
    process.exit(1);
  }

  (async () => {
    try {
      console.log(`\n🔄 Deploying to guild ${guildId}...\n`);

      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
        { body: commands },
      );

      console.log(`\n✅ Deployed ${data.length} commands to guild ${guildId} (instant!)\n`);
    } catch (error) {
      console.error('❌ Error deploying guild commands:', error);
    }
  })();
}
