require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");
const ytSearch = require("yt-search");

/* ---------------------------
Railway keep-alive
--------------------------- */
http.createServer((req, res) => res.end("VinRadio running")).listen(process.env.PORT || 3000);

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
Lavalink Node
--------------------------- */
const nodes = [{
  name: "railway",
  url: "yamabiko.proxy.rlwy.net:17895",
  auth: "vinradio",
  secure: false
}];

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  nodes
);

let lavalinkReady = false;

/* ---------------------------
Lavalink Events
--------------------------- */
shoukaku.on("ready", name => {
  console.log(`Connected to Lavalink node: ${name}`);
  lavalinkReady = true;
});

shoukaku.on("error", (name, error) => {
  console.error(`Lavalink node ${name} error:`, error);
});

shoukaku.on("close", (name, code) => {
  console.log(`Lavalink node ${name} closed with code ${code}`);
});

shoukaku.on("disconnect", name => {
  console.log(`Lavalink node ${name} disconnected`);
});

/* Forward raw voice packets */
client.on("raw", packet => {
  shoukaku.connector.raw(packet);
});

/* ---------------------------
State
--------------------------- */
const queues = new Map();

/* ---------------------------
Ready Event
--------------------------- */
client.once("clientReady", () => {
  console.log(`VinRadio online as ${client.user.tag}`);
});

/* ---------------------------
Commands
--------------------------- */
client.on("messageCreate", async message => {

  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  /* ---------------------------
  PLAY
  --------------------------- */

  if (command === "!play") {

    if (!lavalinkReady) {
      return message.reply("Music system is starting. Try again in a moment.");
    }

    const query = args.join(" ");

    if (!query) {
      return message.reply("Provide a song name or URL.");
    }

    if (!message.member.voice.channel) {
      return message.reply("Join a voice channel first.");
    }

    try {

      let player = shoukaku.players.get(message.guild.id);

      if (!player) {

        player = await shoukaku.joinVoiceChannel({
          guildId: message.guild.id,
          channelId: message.member.voice.channel.id,
          shardId: 0,
          adapterCreator: message.guild.voiceAdapterCreator
        });

        /* Attach queue handler once */
        player.on("end", async () => {

          const queue = queues.get(message.guild.id);
          if (!queue) return;

          queue.shift();

          if (queue.length > 0) {
            await playNext(message.guild.id, player);
          }

        });

      }

      /* Detect URL vs search */

      let identifier = query;

      if (!query.startsWith("http")) {

        const result = await ytSearch(query);

        if (!result.videos.length) {
          return message.reply("No results found.");
        }

        identifier = result.videos[0].url;
      }

      /* Resolve track */

      const res = await player.node.rest.resolve(identifier);

      if (!res || res.loadType === "empty") {
        return message.reply("No playable track found.");
      }

      let track;

      if (Array.isArray(res.data)) {
        track = res.data[0];
      } else {
        track = res.data;
      }

      if (!track) {
        return message.reply("No playable track found.");
      }

      /* Queue system */

      if (!queues.has(message.guild.id)) {
        queues.set(message.guild.id, []);
      }

      const queue = queues.get(message.guild.id);

      queue.push(track);

      await message.reply(`Added to queue: **${track.info.title}**`);

      if (queue.length === 1) {
        await playNext(message.guild.id, player);
      }

    } catch (err) {

      console.error("Playback error:", err);
      message.reply("Playback failed.");

    }
  }

  /* ---------------------------
  STOP
  --------------------------- */

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

  try {

    if (!track || !track.encoded) {
      console.log("Invalid track:", track);
      return;
    }

    await player.update({
      track: { encoded: track.encoded }
    });

  } catch (err) {
    console.error("Error playing track:", err);
  }

}

/* ---------------------------
Login
--------------------------- */
client.login(process.env.BOT_TOKEN);
