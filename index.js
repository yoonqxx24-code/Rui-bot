require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');

// Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Dateien
const USERS_FILE = path.join(__dirname, 'users.json');
const USER_CARDS_FILE = path.join(__dirname, 'user_cards.json');
const CARDS_FILE = path.join(__dirname, 'cards.json');

/* ----------------------------------------------------
   BOOST / DROP – Hilfsdaten
---------------------------------------------------- */

const BASE_RARITY_WEIGHTS = {
  common: 44,
  rare: 20,
  super_rare: 15,
  ultra_rare: 7,
  legendary: 6,
  event: 5,
  limited: 3
};

const BOOST_MULTIPLIERS = {
  small: {
    common: 0.9,
    rare: 1.1,
    super_rare: 1.2,
    ultra_rare: 1.25,
    legendary: 1.3,
    event: 1.3,
    limited: 1.3
  },
  normal: {
    common: 0.75,
    rare: 1.25,
    super_rare: 1.4,
    ultra_rare: 1.5,
    legendary: 1.6,
    event: 1.6,
    limited: 1.6
  },
  mega: {
    common: 0.5,
    rare: 1.4,
    super_rare: 1.6,
    ultra_rare: 1.8,
    legendary: 2.0,
    event: 2.2,
    limited: 2.3
  }
};

function getActiveBoost(user) {
  if (!user || !user.activeBoost) return null;
  if (!user.activeBoost.expiresAt) return null;
  if (Date.now() > user.activeBoost.expiresAt) {
    delete user.activeBoost;
    return null;
  }
  return user.activeBoost.type;
}

function pickRarityWithBoost(baseWeights, boostName = null) {
  const weights = { ...baseWeights };

  if (boostName && BOOST_MULTIPLIERS[boostName]) {
    const multi = BOOST_MULTIPLIERS[boostName];
    for (const r in weights) {
      if (multi[r]) {
        weights[r] = weights[r] * multi[r];
      }
    }
  }

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const roll = Math.random() * total;

  let acc = 0;
  for (const [rarity, weight] of Object.entries(weights)) {
    acc += weight;
    if (roll <= acc) return rarity;
  }
  return 'common';
}

/* ----------------------------------------------------
   Helpers
---------------------------------------------------- */
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

/* ----------------------------------------------------
   Slash Commands registrieren
---------------------------------------------------- */
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Check if Rui is awake'),
    new SlashCommandBuilder().setName('start').setDescription('Create your collector profile'),
    new SlashCommandBuilder().setName('balance').setDescription('Show your coins, butterflies and cards'),
    new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),
    new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward'),
    new SlashCommandBuilder().setName('monthly').setDescription('Claim your monthly reward'),
    new SlashCommandBuilder().setName('drop').setDescription('Drop 3 random cards'),
    new SlashCommandBuilder().setName('work').setDescription('Help around the XLOV studio to earn rewards'),
    new SlashCommandBuilder().setName('inventory').setDescription('Show your collected cards'),

    // NEW: /gift
    new SlashCommandBuilder()
      .setName('gift')
      .setDescription('Send coins, butterflies or a card to another player')
      .addUserOption(o =>
        o.setName('target')
          .setDescription('Who should receive it?')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('what')
          .setDescription('What do you want to gift?')
          .setRequired(true)
          .addChoices(
            { name: 'Coins', value: 'coins' },
            { name: 'Butterflies', value: 'butterflies' },
            { name: 'Card', value: 'card' }
          )
      )
      .addIntegerOption(o =>
        o.setName('amount')
          .setDescription('Amount (for coins/butterflies)')
          .setRequired(false)
      )
      .addStringOption(o =>
        o.setName('card_id')
          .setDescription('Card ID (for card gifts)')
          .setRequired(false)
      ),

    // STAFF: addcard
    new SlashCommandBuilder()
      .setName('addcard')
      .setDescription('STAFF ONLY – create a new card')
      .addStringOption(o =>
        o.setName('card_id')
          .setDescription('Unique card ID (e.g. xlov-rui-001)')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('group')
          .setDescription('Group name (XLOV, etc.)')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('idol')
          .setDescription('Idol / member name')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('rarity')
          .setDescription('Card rarity')
          .setRequired(true)
          .addChoices(
            { name: 'common', value: 'common' },
            { name: 'rare', value: 'rare' },
            { name: 'super_rare', value: 'super_rare' },
            { name: 'ultra_rare', value: 'ultra_rare' },
            { name: 'legendary', value: 'legendary' },
            { name: 'event', value: 'event' },
            { name: 'limited', value: 'limited' }
          )
      )
      .addStringOption(o =>
        o.setName('type')
          .setDescription('Card type (reg, event, limited)')
          .setRequired(true)
          .addChoices(
            { name: 'Regular', value: 'reg' },
            { name: 'Event', value: 'event' },
            { name: 'Limited', value: 'limited' }
          )
      )
      .addStringOption(o =>
        o.setName('era')
          .setDescription('Era / concept (e.g. Bloom, Winter)')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('version')
          .setDescription('Version inside that era (e.g. Ver. A, PC 03)')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('image')
          .setDescription('Image URL')
          .setRequired(true)
      )
      .addBooleanOption(o =>
        o.setName('droppable')
          .setDescription('Should this card drop in /drop?')
          .setRequired(true)
      )
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log('Slash commands registered (global)');
}

/* ----------------------------------------------------
   Events
---------------------------------------------------- */

const WORK_MESSAGES = [
  "You’ve been working so hard again... Hyun said you deserve a break.",
  "You showed up again. I’m proud of you — even if Haru keeps stealing your snacks during breaks.",
  "Work done! Don’t tell Noa I said this, but you might actually be more productive than him today.",
  "I helped count your coins. Muti said it looks like you’re saving for something big.",
  "That look of determination suits you.",
  "You’ve been putting in so much effort lately… the others noticed too. We’re all cheering for you.",
  "You did well again today. Small steps, right? Isn’t that what they always say?",
  "Here, I saved a few butterflies for you.",
  "Another day, another job done. Don’t forget to rest, okay? Even the strongest need a pause.",
  "You earned these coins and butterflies fair and square. Keep them safe."
];

client.once(Events.ClientReady, async (c) => {
  console.log("Logged in as " + c.user.tag);
  try {
    await registerCommands();
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

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
        lastMonthly: null,
        lastWork: null
      };
      saveJson(USERS_FILE, users);
    }
    const u = users[id];

    /* /ping */
    if (i.commandName === 'ping') {
      return i.reply({ embeds: [ruiEmbed('Pong', 'Rui is awake.')] });
    }

    /* /start */
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
        lastMonthly: null,
        lastWork: null
      };
      saveJson(USERS_FILE, users);
      return i.reply({ embeds: [ruiEmbed('Profile created', `Hi ${name}. Your collector profile has been created.`)] });
    }

    /* /balance */
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

    /* /daily */
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

    /* /weekly */
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

    /* /monthly */
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

    /* /work */
    if (i.commandName === 'work') {
      const now = Date.now();
      const COOLDOWN = 15 * 60 * 1000;

      if (u.lastWork && now - new Date(u.lastWork).getTime() < COOLDOWN) {
        const leftMs = COOLDOWN - (now - new Date(u.lastWork).getTime());
        const leftMins = Math.ceil(leftMs / (60 * 1000));
        return i.reply({
          embeds: [ruiEmbed('Not yet', `You already helped out recently. Come back in ${leftMins} minute(s).`)]
        });
      }

      const coins = rand(200, 750);
      const butterflies = rand(3, 20);
      const msg = WORK_MESSAGES[Math.floor(Math.random() * WORK_MESSAGES.length)];

      u.coins += coins;
      u.butterflies += butterflies;
      u.lastWork = new Date().toISOString();
      saveJson(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed('Work complete', `${msg}\nYou earned ${coins} 🪙 and ${butterflies} 🦋.\nNew total: ${u.coins} 🪙 / ${u.butterflies} 🦋.`)]
      });
    }

    /* /inventory */
    if (i.commandName === 'inventory') {
      const allUserCards = loadJson(USER_CARDS_FILE, {});
      const myCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];

      if (!myCards.length) {
        return i.reply({
          embeds: [ruiEmbed(
            `${name}'s Inventory`,
            "You don't have any cards yet. Try `/drop` or buy a pack later."
          )]
        });
      }

      const firstTen = myCards.slice(0, 10);

      return i.reply({
        embeds: [ruiEmbed(
          `${name}'s Inventory`,
          `You currently own **${myCards.length}** card(s). Showing first ${firstTen.length}:`,
          firstTen.map((c, idx) => ({
            name: `#${idx + 1} • ${c.group} — ${c.member}`,
            value: `ID: ${c.id} • Rarity: **${c.rarity || 'unknown'}**`,
            inline: false
          }))
        )]
      });
    }

    /* /gift */
    if (i.commandName === 'gift') {
      const targetUser = i.options.getUser('target');
      const what = i.options.getString('what');
      const amount = i.options.getInteger('amount');
      const cardId = i.options.getString('card_id');

      if (!targetUser) {
        return i.reply({ embeds: [ruiEmbed('No target', 'You have to pick someone to gift to.')] });
      }

      if (targetUser.id === id) {
        return i.reply({ embeds: [ruiEmbed('…No.', 'You can’t gift to yourself 😒')] });
      }

      // sicherstellen, dass der Empfänger in users.json existiert
      if (!users[targetUser.id]) {
        users[targetUser.id] = {
          id: targetUser.id,
          name: targetUser.username,
          coins: 0,
          butterflies: 0,
          created: new Date().toISOString(),
          lastDaily: null,
          lastWeekly: null,
          lastMonthly: null,
          lastWork: null
        };
      }

      const receiver = users[targetUser.id];

      // coins / butterflies
      if (what === 'coins' || what === 'butterflies') {
        if (!amount || amount <= 0) {
          return i.reply({ embeds: [ruiEmbed('Missing amount', 'Tell me how many you want to send.')] });
        }

        if (what === 'coins') {
          if (u.coins < amount) {
            return i.reply({ embeds: [ruiEmbed('Not enough', `You only have ${u.coins} coins.`)], ephemeral: true });
          }
          u.coins -= amount;
          receiver.coins += amount;
        } else {
          if (u.butterflies < amount) {
            return i.reply({ embeds: [ruiEmbed('Not enough', `You only have ${u.butterflies} butterflies.`)], ephemeral: true });
          }
          u.butterflies -= amount;
          receiver.butterflies += amount;
        }

        saveJson(USERS_FILE, users);

        return i.reply({
          embeds: [ruiEmbed(
            'Gift sent',
            `${name} sent **${amount}** ${what === 'coins' ? '🪙 coins' : '🦋 butterflies'} to ${targetUser.username}.`
          )]
        });
      }

      // card
      if (what === 'card') {
        const allUserCards = loadJson(USER_CARDS_FILE, {});
        const senderCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];
        const receiverCards = Array.isArray(allUserCards[targetUser.id]) ? allUserCards[targetUser.id] : [];

        if (!cardId) {
          return i.reply({
            embeds: [ruiEmbed('Missing card', 'Tell me which card ID you want to send.')],
            ephemeral: true
          });
        }

        const idx = senderCards.findIndex(c => c.id === cardId);
        if (idx === -1) {
          return i.reply({
            embeds: [ruiEmbed('Not found', `You don’t own a card with ID **${cardId}**.`)],
            ephemeral: true
          });
        }

        const cardToSend = senderCards.splice(idx, 1)[0];
        receiverCards.push(cardToSend);

        allUserCards[id] = senderCards;
        allUserCards[targetUser.id] = receiverCards;
        saveJson(USER_CARDS_FILE, allUserCards);

        return i.reply({
          embeds: [ruiEmbed(
            'Card sent',
            `${name} sent **${cardToSend.id}** (${cardToSend.group} — ${cardToSend.member}) to ${targetUser.username}.`
          )]
        });
      }

      // falls jemand was schreibt was wir nicht kennen
      return i.reply({ embeds: [ruiEmbed('Unknown thing', 'You can gift `coins`, `butterflies` or `card`.')] });
    }

    /* /addcard (STAFF) */
    if (i.commandName === 'addcard') {
      const staffEnv = process.env.STAFF_IDS || '';
      const staffList = staffEnv.split(',').map(s => s.trim()).filter(Boolean);

      if (!staffList.includes(id)) {
        return i.reply({
          embeds: [ruiEmbed('Not allowed', 'This command is for Rui staff only.')],
          ephemeral: true
        });
      }

      const cardId = i.options.getString('card_id');
      const rarity = i.options.getString('rarity');
      const group = i.options.getString('group');
      const idol = i.options.getString('idol');
      const era = i.options.getString('era') || null;
      const version = i.options.getString('version') || null;
      const image = i.options.getString('image') || null;
      const ctype = i.options.getString('type');
      const droppable = i.options.getBoolean('droppable');

      const cards = loadJson(CARDS_FILE, []);

      if (cards.find(c => c.id === cardId)) {
        return i.reply({
          embeds: [ruiEmbed('Already exists', `There is already a card with ID **${cardId}**.`)],
          ephemeral: true
        });
      }

      const newCard = {
        id: cardId,
        group: group,
        member: idol,
        era: era,
        version: version,
        image: image,
        rarity: rarity,
        type: ctype,
        droppable: droppable
      };

      cards.push(newCard);
      saveJson(CARDS_FILE, cards);

      return i.reply({
        embeds: [ruiEmbed(
          'Card created',
          `New card was added.\nID: **${cardId}**\nGroup: **${group}**\nIdol: **${idol}**\nRarity: **${rarity}**\nType: **${ctype}**\nDroppable: **${droppable ? 'yes' : 'no'}**\nEra: **${era || '—'}**\nVersion: **${version || '—'}**`
        )]
      });
    }

    /* /drop */
    if (i.commandName === 'drop') {
      const cards = loadJson(CARDS_FILE, []);
      if (!cards.length) {
        return i.reply({ embeds: [ruiEmbed('No cards available', 'Add some cards to cards.json first.')] });
      }

      const boostType = getActiveBoost(u);
      const pulled = [];

      for (let n = 0; n < 3; n++) {
        const rarity = pickRarityWithBoost(BASE_RARITY_WEIGHTS, boostType);

        const pool = cards.filter(
          c => c.rarity === rarity && c.droppable !== false
        );

        const finalPool = pool.length
          ? pool
          : cards.filter(c => c.rarity === 'common' && c.droppable !== false);

        const chosen = finalPool[Math.floor(Math.random() * finalPool.length)];
        pulled.push({ ...chosen });
      }

      return i.reply({
        embeds: [ruiEmbed(
          boostType ? `Drop (boost: ${boostType})` : 'Drop',
          boostType ? 'Your boost affected the pool.' : 'Three cards appeared.',
          pulled.map((c, idx) => ({
            name: `Card ${idx + 1}`,
            value: `${c.id} • ${c.group} — ${c.member} • **${c.rarity}**${c.version ? ` • ${c.version}` : ''}`
          }))
        )]
      });
    }

  } catch (err) {
    console.error(err);
    return i.reply({ embeds: [ruiEmbed('Error', 'Something went wrong in Rui. Check Render for details.')] });
  }
});

/* ----------------------------------------------------
   Render keep-alive
---------------------------------------------------- */
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("Rui is alive"));
app.listen(process.env.PORT || 3000);

// start bot
client.login(process.env.DISCORD_TOKEN);
