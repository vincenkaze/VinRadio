require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const nodes = [
  {
    name: "local",
    url: "localhost:2333",
    auth: "vinradio"
  }
];

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  nodes
);

const volumes = new Map();
const queues = new Map();

client.once("clientReady", () => {
  console.log(`VinRadio online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  const args = message.content.split(" ");
  const command = args.shift();

  // PLAY
  if (command === "!play") {

    const query = args.join(" ");

    if (!message.member.voice.channel) {
      return message.reply("Join a voice channel first.");
    }

    try {

      const connection = await shoukaku.joinVoiceChannel({
        guildId: message.guild.id,
        channelId: message.member.voice.channel.id,
        shardId: 0
      });

      const res = await connection.node.rest.resolve(`ytsearch:${query}`);
      const tracks = res?.data || [];

      if (!tracks.length) {
        return message.reply("No results found.");
      }

      const track = tracks[0];

      if (!queues.has(message.guild.id)) {
        queues.set(message.guild.id, []);
      }

      const queue = queues.get(message.guild.id);
      queue.push(track);

      message.reply(`Added to queue: **${track.info.title}**`);

      if (queue.length === 1) {
        await playNext(message.guild.id, connection);
      }

      connection.on("end", async () => {
        const queue = queues.get(message.guild.id);
        if (!queue) return;

        queue.shift();

        if (queue.length > 0) {
          await playNext(message.guild.id, connection);
        }
      });

    } catch (err) {
      console.error("Playback error:", err);
      message.reply("Playback failed.");
    }
  }

  // SKIP
  if (command === "!skip") {

    const player = shoukaku.players.get(message.guild.id);
    const queue = queues.get(message.guild.id);

    if (!player || !queue || queue.length <= 1) {
      return message.reply("Nothing else in the queue.");
    }

    queue.shift();

    await player.update({
      track: { encoded: queue[0].encoded }
    });

    message.reply(`Now playing: **${queue[0].info.title}**`);
  }

  // STOP
  if (command === "!stop") {

    const player = shoukaku.players.get(message.guild.id);

    if (!player) return message.reply("Nothing playing.");

    queues.delete(message.guild.id);

    await player.disconnect();

    message.reply("Stopped music.");
  }

  // VOLUME UP
  if (command === "!volumeup") {

    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("Nothing playing.");

    let volume = volumes.get(message.guild.id) || 100;

    volume += 10;
    if (volume > 200) volume = 200;

    volumes.set(message.guild.id, volume);

    await player.update({ volume });

    message.reply(`Volume: ${volume}%`);
  }

  // VOLUME DOWN
  if (command === "!volumedown") {

    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("Nothing playing.");

    let volume = volumes.get(message.guild.id) || 100;

    volume -= 10;
    if (volume < 0) volume = 0;

    volumes.set(message.guild.id, volume);

    await player.update({ volume });

    message.reply(`Volume: ${volume}%`);
  }

});

async function playNext(guildId, player) {

  const queue = queues.get(guildId);

  if (!queue || queue.length === 0) return;

  const track = queue[0];

  await player.update({
    track: { encoded: track.encoded }
  });
}

client.login(process.env.BOT_TOKEN);