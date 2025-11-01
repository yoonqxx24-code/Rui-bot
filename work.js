const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('work')
    .setDescription('Work hard to earn some ✨ Rui Coins!'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));

    const cooldownTime = 1000 * 60 * 30; // 30 minutes
    const now = Date.now();

    if (users[userId]?.lastWork && now - users[userId].lastWork < cooldownTime) {
      const remaining = Math.ceil((cooldownTime - (now - users[userId].lastWork)) / 60000);
      return interaction.reply({ content: `You need to rest! Come back in **${remaining} minutes** 💼`, ephemeral: true });
    }

    const earnings = Math.floor(Math.random() * 20) + 10; // 10–30 Rui Coins

    if (!users[userId]) users[userId] = { coins: 0, cards: 0 };
    users[userId].coins += earnings;
    users[userId].lastWork = now;

    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));

    const messages = [
      `You helped the staff with a photo shoot 📸 and earned **${earnings} Rui Coins**!`,
      `You sorted fan mail 💌 and made **${earnings} Rui Coins**!`,
      `You cleaned up after rehearsal 🧹 and got **${earnings} Rui Coins**!`,
      `You updated the fan page 💻 and earned **${earnings} Rui Coins**!`,
      `You handled a merch delivery 📦 and received **${earnings} Rui Coins**!`
    ];

    const randomMsg = messages[Math.floor(Math.random() * messages.length)];

    const embed = new EmbedBuilder()
      .setColor(0xFFC0CB)
      .setTitle('💼 Work Completed!')
      .setDescription(randomMsg)
      .setFooter({ text: 'Work hard, dream big ✨' });

    await interaction.reply({ embeds: [embed] });
  },
};
