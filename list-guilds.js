import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log('Guilds I am in:');
  c.guilds.cache.forEach(g => {
    console.log(`${g.name} -> ${g.id}`);
  });
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
