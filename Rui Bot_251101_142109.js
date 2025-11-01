require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js'); 

const client = new Client({ intents: [GatewayIntentBits.Guilds] }); 

const USERS_FILE = path.join(__dirname, 'users.json');
const USER_CARDS_FILE = path.join(__dirname, 'user_cards.json');
const CARDS_FILE = path.join(__dirname, 'cards.json'); 

function ruiEmbed(title, desc, fields = []) {
  const e = new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(0xFFB6C1);
  if (fields.length) e.addFields(...fields);
  return e;
} 

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
} 

client.once(Events.ClientReady, (c) => {
  console.log("Logged in as " + c.user.tag);
});
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return; 

  // safety wrapper
  try {
    const users = loadJson(USERS_FILE, {});
    const id = i.user.id;
    const name = i.user.username; 

    if (!users[id]) {
      users[id] = {
        id,
        name,
        coins: 0,
        butterflies: 0,
        created: new Date().toISOString(),
        lastDaily: null,
        lastWeekly: null,
        lastMonthly: null
      };
      saveJson(USERS_FILE, users);
    }
    const u = users[id]; 

    // /ping
    if (i.commandName === 'ping') {
      return i.reply({ embeds: [ruiEmbed('Pong', 'Rui is awake.')] });
    } 

    // /start
    if (i.commandName === 'start') {
      if (u && u.created) {
        return i.reply({ embeds: [ruiEmbed('Profile already exists', `Oh! Seems like you already created a profile, ${name}. Have fun playing.`)] });
      }
      users[id] = {
        id,
        name,
        coins: 0,
        butterflies: 0,
        created: new Date().toISOString(),
        lastDaily: null,
        lastWeekly: null,
        lastMonthly: null
      };
      saveJson(USERS_FILE, users);
      return i.reply({ embeds: [ruiEmbed('Profile created', `Hi ${name}. Your collector profile has been created.`)] });
    } 

    // /balance
    if (i.commandName === 'balance') {
      const allUserCards = loadJson(USER_CARDS_FILE, {});
      const myCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];
      return i.reply({
        embeds: [ruiEmbed(
          `${name}'s Balance`,
          `Here’s your current collector data. Keep playing to get more.`,
          [
            { name: '🪙 Coins', value: String(u.coins), inline: true },
            { name: '🦋 Butterflies', value: String(u.butterflies), inline: true },
            { name: '✨ Cards', value: String(myCards.length), inline: true }
          ]
        )]
      });
    }
    // /daily
    if (i.commandName === 'daily') {
      const DAY = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const last = u.lastDaily ? new Date(u.lastDaily).getTime() : 0; 

      if (u.lastDaily && (now - last) < DAY) {
        const leftH = Math.ceil((DAY - (now - last)) / (60 * 60 * 1000));
        return i.reply({ embeds: [ruiEmbed('Daily already claimed', `You already picked up today’s rewards, ${name}. Come back in about ${leftH} hour(s).`)] });
      } 

      const coins = rand(200, 750);
      const butterflies = rand(3, 20);
      u.coins += coins;
      u.butterflies += butterflies;
      u.lastDaily = new Date().toISOString();
      saveJson(USERS_FILE, users); 

      return i.reply({
        embeds: [ruiEmbed('Daily collected', `${name}, here is what I found for you today.`, [
          { name: '🪙 Coins', value: `+${coins}`, inline: true },
          { name: '🦋 Butterflies', value: `+${butterflies}`, inline: true },
          { name: '✨ Cards', value: 'No cards available yet', inline: false },
          { name: 'New total', value: `${u.coins} 🪙 / ${u.butterflies} 🦋`, inline: false }
        ])]
      });
    } 

    // /weekly
    if (i.commandName === 'weekly') {
      const WEEK = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const last = u.lastWeekly ? new Date(u.lastWeekly).getTime() : 0; 

      if (u.lastWeekly && (now - last) < WEEK) {
        const leftD = Math.ceil((WEEK - (now - last)) / (24 * 60 * 60 * 1000));
        return i.reply({ embeds: [ruiEmbed('Weekly already claimed', `That one is only once per week, ${name}. Come back in about ${leftD} day(s).`)] });
      } 

      const coins = rand(900, 1800);
      const butterflies = rand(10, 35);
      u.coins += coins;
      u.butterflies += butterflies;
      u.lastWeekly = new Date().toISOString();
      saveJson(USERS_FILE, users); 

      return i.reply({
        embeds: [ruiEmbed('Weekly collected', `Weekly rewards for ${name}.`, [
          { name: '🪙 Coins', value: `+${coins}`, inline: true },
          { name: '🦋 Butterflies', value: `+${butterflies}`, inline: true },
          { name: '✨ Cards', value: 'No cards available yet', inline: false },
          { name: 'New total', value: `${u.coins} 🪙 / ${u.butterflies} 🦋`, inline: false }
        ])]
      });
    } 

    // /monthly
    if (i.commandName === 'monthly') {
      const MONTH = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const last = u.lastMonthly ? new Date(u.lastMonthly).getTime() : 0; 

      if (u.lastMonthly && (now - last) < MONTH) {
        const leftD = Math.ceil((MONTH - (now - last)) / (24 * 60 * 60 * 1000));
        return i.reply({ embeds: [ruiEmbed('Monthly already claimed', `You already took your monthly pack, ${name}. Come back in about ${leftD} day(s).`)] });
      } 

      const coins = rand(2500, 5000);
      const butterflies = rand(25, 70);
      u.coins += coins;
      u.butterflies += butterflies;
      u.lastMonthly = new Date().toISOString();
      saveJson(USERS_FILE, users); 

      return i.reply({
        embeds: [ruiEmbed('Monthly collected', `Big drop for ${name}.`, [
          { name: '🪙 Coins', value: `+${coins}`, inline: true },
          { name: '🦋 Butterflies', value: `+${butterflies}`, inline: true },
          { name: '✨ Cards', value: 'No cards available yet', inline: false },
          { name: 'New total', value: `${u.coins} 🪙 / ${u.butterflies} 🦋`, inline: false }
        ])]
      });
    } 

    // /drop — safe
    if (i.commandName === 'drop') {
      const cards = loadJson(CARDS_FILE, []);
      if (!cards.length) {
        return i.reply({ embeds: [ruiEmbed('No cards available', 'Add some cards to cards.json first.')] });
      }
      const show = cards.slice(0, 3);
      return i.reply({
        embeds: [ruiEmbed('Three cards appeared', 'Claiming will be added next.', show.map((c, n) => ({
          name: `Card ${n + 1}`,
          value: `${c.id} • ${c.group} — ${c.member} • ${c.rarity}`
        })))]
      });
    } 

  } catch (err) {
    console.error(err);
    // show error in Discord so you see it
    return i.reply({ embeds: [ruiEmbed('Error', 'Something went wrong in Rui. Check Termux for details.')] });
  }
}); 

client.login(process.env.DISCORD_TOKEN);