require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check if Rui is awake'),
  new SlashCommandBuilder().setName('start').setDescription('Create your collector profile'),
  new SlashCommandBuilder().setName('balance').setDescription('Show your coins, butterflies and cards'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),
  new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward'),
  new SlashCommandBuilder().setName('monthly').setDescription('Claim your monthly reward'),
  new SlashCommandBuilder().setName('work').setDescription('Do a small task for Rui and earn rewards'),
  new SlashCommandBuilder().setName('packs').setDescription('Show your unopened card packs'),
  new SlashCommandBuilder()
    .setName('openpack')
    .setDescription('Open one of your card packs')
    .addStringOption(o =>
      o.setName('size')
        .setDescription('Which pack?')
        .setRequired(true)
        .addChoices(
          { name: '5-card pack', value: 'pack5' },
          { name: '10-card pack', value: 'pack10' },
          { name: '20-card pack', value: 'pack20' }
        )
    )
  new SlashCommandBuilder().setName('drop').setDescription('Drop 3 random cards')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, '1433981066372317194'),
    { body: commands }
  );
  console.log('Guild slash commands registered');
}
main();
