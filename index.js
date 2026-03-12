require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

/* ---------------------------
   Railway keep alive
--------------------------- */
http.createServer((req,res)=>res.end("VinRadio running")).listen(process.env.PORT || 3000);

/* ---------------------------
   Discord Client
--------------------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ---------------------------
   Lavalink
--------------------------- */
const nodes = [
  {
    name: "lavalink",
    url: "wss://lavalink.jirayu.net",
    auth: "youshallnotpass"
  }
]; 

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  nodes
);

shoukaku.on("error", (name, error) => {
  console.error(`Lavalink node ${name} error:`, error);
});

/* ---------------------------
   State
--------------------------- */
const queues = new Map();
const volumes = new Map();

let state = {};
try {
  state = JSON.parse(fs.readFileSync("state.json"));
} catch {
  state = {};
}

/* ---------------------------
   Ready Event
--------------------------- */
client.once("clientReady", async () => {
  console.log(`VinRadio online as ${client.user.tag}`);

  // auto reconnect
  if (state.guildId && state.channelId) {
    try {

      console.log("Reconnecting to voice channel...");

      const connection = await shoukaku.joinVoiceChannel({
        guildId: state.guildId,
        channelId: state.channelId,
        shardId: 0
      });

      const res = await connection.node.rest.resolve(`ytsearch:lofi hip hop radio`);
      const track = res.data[0];

      queues.set(state.guildId, [track]);

      await playNext(state.guildId, connection);

      console.log("Radio resumed automatically");

    } catch (err) {
      console.error("Auto reconnect failed:", err);
    }
  }
});

/* ---------------------------
   Commands
--------------------------- */
client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

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

      /* save channel for restart */
      state.guildId = message.guild.id;
      state.channelId = message.member.voice.channel.id;
      fs.writeFileSync("state.json", JSON.stringify(state));

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

  if (command === "!stop") {

    const player = shoukaku.players.get(message.guild.id);

    if (!player) return message.reply("Nothing playing.");

    queues.delete(message.guild.id);

    await player.disconnect();

    message.reply("Stopped music.");
  }
});

/* ---------------------------
   Play Next Track
--------------------------- */
async function playNext(guildId, player) {

  const queue = queues.get(guildId);

  if (!queue || queue.length === 0) return;

  const track = queue[0];

  await player.update({
    track: { encoded: track.encoded }
  });
}

/* ---------------------------
   Login
--------------------------- */
client.login(process.env.BOT_TOKEN);