require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

// Discord client
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Dateien (lokales Backup)
const USERS_FILE = path.join(__dirname, 'users.json');
const USER_CARDS_FILE = path.join(__dirname, 'user_cards.json');
const CARDS_FILE = path.join(__dirname, 'cards.json');

/* ----------------------------------------------------
   Remote + lokal speichern / laden
   (wir speichern ALLES in EINEM jsonbin: { users: ..., user_cards: ..., cards: ... })
---------------------------------------------------- */
async function loadJsonOrRemote(file, fallback) {
  const BIN_KEY = process.env.JSONBIN_KEY;
  const BIN_ID = process.env.JSONBIN_ID;

  // wenn kein jsonbin gesetzt ist → lokal
  if (!BIN_KEY || !BIN_ID) {
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
  }

  // versuchen von jsonbin zu laden
  try {
    const res = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { 'X-Master-Key': BIN_KEY }
    });
    const record = res.data.record;
    if (!record) return fallback;

    if (file === USERS_FILE) return record.users ?? fallback;
    if (file === USER_CARDS_FILE) return record.user_cards ?? fallback;
    if (file === CARDS_FILE) return record.cards ?? fallback;
    return record;
  } catch (err) {
    console.error('JSONBin load failed, using local:', err.message);
    if (!fs.existsSync(file)) return fallback;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return fallback; }
  }
}

async function saveJsonOrRemote(file, data) {
  const BIN_KEY = process.env.JSONBIN_KEY;
  const BIN_ID = process.env.JSONBIN_ID;

  // immer lokal speichern
  fs.writeFileSync(file, JSON.stringify(data, null, 2));

  // wenn kein jsonbin → fertig
  if (!BIN_KEY || !BIN_ID) return;

  try {
    // aktuellen stand holen
    let current = {};
    try {
      const res = await axios.get(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
        headers: { 'X-Master-Key': BIN_KEY }
      });
      current = res.data.record || {};
    } catch {
      current = {};
    }

    // je nachdem welche datei wir speichern, setzen wir das feld im gesamt-json
    if (file === USERS_FILE) current.users = data;
    else if (file === USER_CARDS_FILE) current.user_cards = data;
    else if (file === CARDS_FILE) current.cards = data;

    // wieder hochladen
    await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`, current, {
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': BIN_KEY
      }
    });
  } catch (err) {
    console.error('JSONBin save failed:', err.message);
  }
}

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

// 💜 dein Wunsch: alle Boosts = 45 Minuten, kosten aber unterschiedlich viele 🦋
const BOOST_BUTTERFLY_PRICES = {
  small: 25,
  normal: 40,
  mega: 60
};
const BOOST_DURATION_MS = 45 * 60 * 1000; // 45 Minuten

// 📦 Packs: Coins → 5 / 10 / 20 random Karten
const PACK_COIN_PRICES = {
  small: 350,   // 5 Karten
  medium: 650,  // 10 Karten
  big: 1100     // 20 Karten
};

// 💰 Preise pro Rarity (für /buy Karte per ID)
const RARITY_PRICES = {
  common: 200,
  rare: 400,
  super_rare: 650,
  ultra_rare: 900,
  legendary: 1200
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
    new SlashCommandBuilder().setName('claim').setDescription('Claim a random card (every 90 seconds)'),
    new SlashCommandBuilder().setName('overview').setDescription('Show all Rui commands'),

    // /buy – Karte per ID, aber event/limited nicht
    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Buy a specific card by its card code')
      .addStringOption(o =>
        o.setName('card_id')
          .setDescription('The card code (like xlov-rui-001)')
          .setRequired(true)
      ),

    // /buyboost – 45 min, kostet Butterflies, Auswahl
    new SlashCommandBuilder()
      .setName('buyboost')
      .setDescription('Buy a 45-minute drop boost (costs butterflies)')
      .addStringOption(o =>
        o.setName('type')
          .setDescription('Boost type')
          .setRequired(true)
          .addChoices(
            { name: 'small (25 🦋)', value: 'small' },
            { name: 'normal (40 🦋)', value: 'normal' },
            { name: 'mega (60 🦋)', value: 'mega' }
          )
      ),

    // /buypack – 5 / 10 / 20 Karten
    new SlashCommandBuilder()
      .setName('buypack')
      .setDescription('Buy a card pack (5 / 10 / 20 random cards)')
      .addStringOption(o =>
        o.setName('size')
          .setDescription('How many cards?')
          .setRequired(true)
          .addChoices(
            { name: '5 cards (350 🪙)', value: 'small' },
            { name: '10 cards (650 🪙)', value: 'medium' },
            { name: '20 cards (1100 🪙)', value: 'big' }
          )
      ),

    // /gift
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
  /* ---------------------- BUTTONS ---------------------- */
  if (i.isButton()) {
    if (i.customId.startsWith('drop_pick_')) {
      const users = await loadJsonOrRemote(USERS_FILE, {});
      const id = i.user.id;
      const u = users[id];

      if (!u || !u.pendingDrop) {
        return i.reply({ content: 'You have no active drop.', ephemeral: true });
      }

      const now = Date.now();
      if (u.pendingDrop.expiresAt && now > u.pendingDrop.expiresAt) {
        delete u.pendingDrop;
        await saveJsonOrRemote(USERS_FILE, users);
        return i.reply({ content: 'Your drop expired. Use /drop again.', ephemeral: true });
      }

      const idx = parseInt(i.customId.split('_').pop(), 10);
      const cards = u.pendingDrop.cards || [];
      if (!cards[idx]) {
        return i.reply({ content: 'This card is not available anymore.', ephemeral: true });
      }

      const chosen = cards[idx];

      // Karte ins Inventar
      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      if (!Array.isArray(allUserCards[id])) allUserCards[id] = [];
      allUserCards[id].push(chosen);
      await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);

      // pending weg + cooldown starten
      u.pendingDrop = null;
      u.lastDrop = new Date().toISOString();
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed(
          'Card claimed',
          `You claimed **${chosen.id}** (${chosen.group} — ${chosen.member}) • **${chosen.rarity}**`
        )],
        ephemeral: true
      });
    }
    return;
  }
  /* ------------------- END BUTTONS --------------------- */

  if (!i.isChatInputCommand()) return;

  try {
    const users = await loadJsonOrRemote(USERS_FILE, {});
    const id = i.user.id;
    const name = i.user.username;

    // User initialisieren
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
        lastWork: null,
        lastDrop: null,
        pendingDrop: null,
        lastClaim: null,
        activeBoost: null
      };
      await saveJsonOrRemote(USERS_FILE, users);
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
        lastWork: null,
        lastDrop: null,
        pendingDrop: null,
        lastClaim: null,
        activeBoost: null
      };
      await saveJsonOrRemote(USERS_FILE, users);
      return i.reply({ embeds: [ruiEmbed('Profile created', `Hi ${name}. Your collector profile has been created.`)] });
    }

    /* /balance */
    if (i.commandName === 'balance') {
      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      const myCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];
      return i.reply({
        embeds: [ruiEmbed(
          `${name}'s Balance`,
          `Here’s your current collector data. Keep playing to get more.`,
          [
            { name: '🪙 Coins', value: String(u.coins), inline: true },
            { name: '🦋 Butterflies', value: String(u.butterflies), inline: true },
            { name: '✨ Cards', value: String(myCards.length), inline: true },
            u.activeBoost ? { name: 'Boost', value: `${u.activeBoost.type} (active)`, inline: true } : { name: 'Boost', value: 'none', inline: true }
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
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed('Daily collected', `${name}, here is what I found for you today.`, [
          { name: '🪙 Coins', value: `+${coins}`, inline: true },
          { name: '🦋 Butterflies', value: `+${butterflies}`, inline: true },
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
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed('Weekly collected', `Weekly rewards for ${name}.`, [
          { name: '🪙 Coins', value: `+${coins}`, inline: true },
          { name: '🦋 Butterflies', value: `+${butterflies}`, inline: true },
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
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed('Monthly collected', `Big drop for ${name}.`, [
          { name: '🪙 Coins', value: `+${coins}`, inline: true },
          { name: '🦋 Butterflies', value: `+${butterflies}`, inline: true },
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
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed('Work complete', `${msg}\nYou earned ${coins} 🪙 and ${butterflies} 🦋.\nNew total: ${u.coins} 🪙 / ${u.butterflies} 🦋.`)]
      });
    }

    /* /inventory */
    if (i.commandName === 'inventory') {
      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      const myCards = Array.isArray(allUserCards[id]) ? allUserCards[id] : [];

      if (!myCards.length) {
        return i.reply({
          embeds: [ruiEmbed(
            `${name}'s Inventory`,
            "You don't have any cards yet. Try `/drop`, `/claim` or buy a pack."
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

    /* /buy – Karte per ID */
    if (i.commandName === 'buy') {
      const cardId = i.options.getString('card_id');

      const allCards = await loadJsonOrRemote(CARDS_FILE, []);
      const wanted = allCards.find(c => c.id === cardId);

      if (!wanted) {
        return i.reply({
          embeds: [ruiEmbed('Not found', `There is no card with ID **${cardId}**.`)],
          ephemeral: true
        });
      }

      const rarity = wanted.rarity || 'common';

      // event / limited sperren
      if (rarity === 'event' || rarity === 'limited') {
        return i.reply({
          embeds: [ruiEmbed('Not buyable', `Cards with rarity **${rarity}** cannot be bought. Try drops or events.`)],
          ephemeral: true
        });
      }

      const price = RARITY_PRICES[rarity];
      if (!price) {
        return i.reply({
          embeds: [ruiEmbed('Not buyable', `Cards with rarity **${rarity}** cannot be bought.`)],
          ephemeral: true
        });
      }

      if (u.coins < price) {
        return i.reply({
          embeds: [ruiEmbed('Not enough coins', `This card costs **${price}** 🪙 but you only have **${u.coins}**.`)],
          ephemeral: true
        });
      }

      // coins abziehen
      u.coins -= price;

      // karte ins inventar
      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      if (!Array.isArray(allUserCards[id])) allUserCards[id] = [];
      allUserCards[id].push(wanted);

      // speichern
      await saveJsonOrRemote(USERS_FILE, users);
      await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);

      return i.reply({
        embeds: [ruiEmbed(
          'Card bought',
          `You bought **${wanted.id}** (${wanted.group} — ${wanted.member}) • **${rarity}** for **${price}** 🪙`
        )]
      });
    }

    /* /buyboost – 45 min, kostet Butterflies */
    if (i.commandName === 'buyboost') {
      const boostType = i.options.getString('type');
      const price = BOOST_BUTTERFLY_PRICES[boostType];

      if (!price) {
        return i.reply({ embeds: [ruiEmbed('Unknown boost', 'This boost does not exist.')], ephemeral: true });
      }

      if (u.butterflies < price) {
        return i.reply({
          embeds: [ruiEmbed('Not enough butterflies', `This boost costs **${price}** 🦋 but you only have **${u.butterflies}**.`)],
          ephemeral: true
        });
      }

      // abziehen
      u.butterflies -= price;

      // 45 Minuten lang aktiv
      u.activeBoost = {
        type: boostType,
        expiresAt: Date.now() + BOOST_DURATION_MS
      };

      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed(
          'Boost activated',
          `You activated a **${boostType}** boost for **45 minutes**.\nIt will affect your **/drop** pulls.\nCost: **${price}** 🦋`
        )],
        ephemeral: true
      });
    }

    /* /buypack – 5 / 10 / 20 cards → direkt ins Inventar */
    if (i.commandName === 'buypack') {
      const size = i.options.getString('size'); // small / medium / big
      const price = PACK_COIN_PRICES[size];

      if (!price) {
        return i.reply({ embeds: [ruiEmbed('Unknown pack', 'This pack does not exist.')], ephemeral: true });
      }

      if (u.coins < price) {
        return i.reply({
          embeds: [ruiEmbed('Not enough coins', `This pack costs **${price}** 🪙 but you only have **${u.coins}**.`)],
          ephemeral: true
        });
      }

      const COUNT_MAP = {
        small: 5,
        medium: 10,
        big: 20
      };
      const amount = COUNT_MAP[size] || 5;

      const allCards = await loadJsonOrRemote(CARDS_FILE, []);
      if (!allCards.length) {
        return i.reply({ embeds: [ruiEmbed('No cards', 'There are no cards to buy right now.')], ephemeral: true });
      }

      // nur droppable und nicht event / limited
      const pool = allCards.filter(c =>
        c.droppable !== false &&
        c.rarity !== 'event' &&
        c.rarity !== 'limited'
      );

      if (!pool.length) {
        return i.reply({ embeds: [ruiEmbed('No cards', 'There are no normal cards to buy right now.')], ephemeral: true });
      }

      // Coins abziehen
      u.coins -= price;

      // Karten ins Inventar
      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      if (!Array.isArray(allUserCards[id])) allUserCards[id] = [];

      const won = [];
      for (let n = 0; n < amount; n++) {
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        allUserCards[id].push(chosen);
        won.push(chosen);
      }

      await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed(
          'Pack opened',
          `You bought a **${size}** pack for **${price}** 🪙 and received **${amount}** card(s).`
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

      // sicherstellen, dass der Empfänger existiert
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
          lastWork: null,
          lastDrop: null,
          pendingDrop: null,
          lastClaim: null,
          activeBoost: null
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

        await saveJsonOrRemote(USERS_FILE, users);

        return i.reply({
          embeds: [ruiEmbed(
            'Gift sent',
            `${name} sent **${amount}** ${what === 'coins' ? '🪙 coins' : '🦋 butterflies'} to ${targetUser.username}.`
          )]
        });
      }

      // card
      if (what === 'card') {
        const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
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
        await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);

        return i.reply({
          embeds: [ruiEmbed(
            'Card sent',
            `${name} sent **${cardToSend.id}** (${cardToSend.group} — ${cardToSend.member}) to ${targetUser.username}.`
          )]
        });
      }

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

      const cards = await loadJsonOrRemote(CARDS_FILE, []);

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
      await saveJsonOrRemote(CARDS_FILE, cards);

      return i.reply({
        embeds: [ruiEmbed(
          'Card created',
          `New card was added.\nID: **${cardId}**\nGroup: **${group}**\nIdol: **${idol}**\nRarity: **${rarity}**\nType: **${ctype}**\nDroppable: **${droppable ? 'yes' : 'no'}**\nEra: **${era || '—'}**\nVersion: **${version || '—'}**`
        )]
      });
    }

    /* /claim */
    if (i.commandName === 'claim') {
      const now = Date.now();
      const COOLDOWN = 90 * 1000; // 1,5 Minuten
      const cards = await loadJsonOrRemote(CARDS_FILE, []);

      if (!cards.length) {
        return i.reply({ embeds: [ruiEmbed('No cards available', 'There are no cards to claim yet.')] });
      }

      if (u.lastClaim && now - new Date(u.lastClaim).getTime() < COOLDOWN) {
        const left = Math.ceil((COOLDOWN - (now - new Date(u.lastClaim).getTime())) / 1000);
        return i.reply({
          embeds: [ruiEmbed('Cooldown', `Please wait **${left} seconds** before claiming again.`)],
          ephemeral: true
        });
      }

      // Pool: droppable, kein event/limited
      const pool = cards.filter(c => c.droppable !== false && c.rarity !== 'event' && c.rarity !== 'limited');
      if (!pool.length) {
        return i.reply({ embeds: [ruiEmbed('No cards available', 'There are no claimable cards right now.')] });
      }

      const chosen = pool[Math.floor(Math.random() * pool.length)];

      const allUserCards = await loadJsonOrRemote(USER_CARDS_FILE, {});
      if (!Array.isArray(allUserCards[id])) allUserCards[id] = [];
      allUserCards[id].push(chosen);
      await saveJsonOrRemote(USER_CARDS_FILE, allUserCards);

      u.lastClaim = new Date().toISOString();
      await saveJsonOrRemote(USERS_FILE, users);

      return i.reply({
        embeds: [ruiEmbed(
          'Card claimed',
          `You got **${chosen.id}** (${chosen.group} — ${chosen.member}) • **${chosen.rarity.toUpperCase()}**! 🎉`
        )]
      });
    }

    /* /drop */
    if (i.commandName === 'drop') {
      const cards = await loadJsonOrRemote(CARDS_FILE, []);
      if (!cards.length) {
        return i.reply({ embeds: [ruiEmbed('No cards available', 'Add some cards to cards.json first.')] });
      }

      const now = Date.now();

      // wenn noch eine Auswahl offen ist
      if (u.pendingDrop && u.pendingDrop.expiresAt && now < u.pendingDrop.expiresAt) {
        const opts = u.pendingDrop.cards;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('drop_pick_0').setLabel('1').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('drop_pick_1').setLabel('2').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('drop_pick_2').setLabel('3').setStyle(ButtonStyle.Primary)
        );

        const files = opts.map((c, idx) => ({
          attachment: c.image,
          name: `drop_${idx + 1}.png`
        }));

        return i.reply({
          content: `Choose **one** of the 3 cards below:\n1️⃣ ${opts[0].group} — ${opts[0].member}\n2️⃣ ${opts[1].group} — ${opts[1].member}\n3️⃣ ${opts[2].group} — ${opts[2].member}`,
          files,
          components: [row],
          ephemeral: true
        });
      }

      // cooldown
      if (u.lastDrop) {
        const diff = now - new Date(u.lastDrop).getTime();
        const COOLDOWN = 60 * 1000;
        if (diff < COOLDOWN) {
          const left = Math.ceil((COOLDOWN - diff) / 1000);
          return i.reply({
            embeds: [ruiEmbed('Cooldown', `You can drop again in **${left}** seconds.`)],
            ephemeral: true
          });
        }
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

      u.pendingDrop = {
        cards: pulled,
        expiresAt: now + 60 * 1000
      };
      await saveJsonOrRemote(USERS_FILE, users);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('drop_pick_0').setLabel('1').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('drop_pick_1').setLabel('2').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('drop_pick_2').setLabel('3').setStyle(ButtonStyle.Primary)
      );

      const files = pulled.map((c, idx) => ({
        attachment: c.image,
        name: `drop_${idx + 1}.png`
      }));

      return i.reply({
        content: `${boostType ? `Drop (boost: ${boostType})` : 'Drop'} – choose **one**:\n1️⃣ ${pulled[0].group} — ${pulled[0].member}\n2️⃣ ${pulled[1].group} — ${pulled[1].member}\n3️⃣ ${pulled[2].group} — ${pulled[2].member}`,
        files,
        components: [row],
        ephemeral: true
      });
    }

    /* /overview */
    if (i.commandName === 'overview') {
      return i.reply({
        embeds: [ruiEmbed(
          'Rui Command Overview',
          'Here’s a quick summary of all available commands:',
          [
            { name: '/start', value: 'Create your collector profile' },
            { name: '/balance', value: 'Show your coins, butterflies, and cards' },
            { name: '/daily /weekly /monthly', value: 'Claim your rewards' },
            { name: '/work', value: 'Earn coins and butterflies (15min cooldown)' },
            { name: '/drop', value: 'Drop 3 random cards and choose 1 (1min cooldown, affected by boost)' },
            { name: '/claim', value: 'Claim 1 random card every 90 seconds' },
            { name: '/buy', value: 'Buy a specific card by ID (not event or limited)' },
            { name: '/buyboost', value: 'Buy a 45min drop boost for butterflies' },
            { name: '/buypack', value: 'Buy 5 / 10 / 20 random cards for coins' },
            { name: '/gift', value: 'Send coins, butterflies, or cards to other players' },
            { name: '/inventory', value: 'View your collected cards' }
          ]
        )],
        ephemeral: true
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
