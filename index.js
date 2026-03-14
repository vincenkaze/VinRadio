require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

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
   Reliable Lavalink v4 Nodes
--------------------------- */
const nodes = [
  {
    name: "scarlettx",
    url: "lava-v4.ajieblogs.eu.org",
    auth: "https://dsc.gg/ajidevserver",
    secure: true,
    restVersion: "v4"
  },
  {
    name: "nextgen",
    url: "publicnode.nextgencoders.xyz",
    auth: "nextgencoders",
    port: 2336,
    secure: false,
    restVersion: "v4"
  },
  {
    name: "railway",
    url: "yamabiko.proxy.rlwy.net:17895",
    auth: "vinradio",
    secure: false
  }
];

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  nodes,
  {
    resume: true,
    resumeTimeout: 30,
    reconnectTries: 5,
    reconnectInterval: 10,
    restTimeout: 120,
    moveOnDisconnect: true,
    structures: {
      player: {
        restVersion: "v4"
      }
    }
  }
);

shoukaku.on("debug", (name, info) => {
  console.log(`[Lavalink ${name}] ${info}`);
});

shoukaku.on("ready", (name) => {
  console.log(`✅ Connected to Lavalink node: ${name}`);
});

shoukaku.on("error", (name, error) => {
  console.error(`❌ Lavalink node ${name} error:`, error);
});

/* ---------------------------
   State & Queue
--------------------------- */
const queues = new Map();

let state = {};
try {
  state = JSON.parse(fs.readFileSync("state.json"));
} catch {
  state = {};
}

/* ---------------------------
   Ready Event - Auto Resume
--------------------------- */
client.once("clientReady", async () => {
  console.log(`🎵 VinRadio online as ${client.user.tag}`);

  if (state.guildId && state.channelId && !shoukaku.players.has(state.guildId)) {
    try {
      console.log("🔄 Reconnecting to voice channel...");
      const connection = await shoukaku.joinVoiceChannel({
        guildId: state.guildId,
        channelId: state.channelId,
        shardId: 0
      });

      const res = await connection.node.rest.resolve("ytmsearch:lofi hip hop radio");
      console.log("Auto-resume track:", res?.data?.[0]?.info?.title || "Failed");
      
      if (res?.data?.length) {
        const track = res.data[0];
        queues.set(state.guildId, [track]);
        await playNext(state.guildId, connection);
        console.log("✅ Radio resumed!");
      }
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

  // !play <song>
  if (command === "!play") {
    const query = args.join(" ");
    if (!message.member?.voice?.channel) {
      return message.reply("❌ **Join a voice channel first!**");
    }
    if (!query) {
      return message.reply("❌ **Usage:** `!play gangnam style`");
    }

    try {
      let player = shoukaku.players.get(message.guild.id);

      if (!player) {
        player = await shoukaku.joinVoiceChannel({
          guildId: message.guild.id,
          channelId: message.member.voice.channel.id,
          shardId: 0
        });
        state.guildId = message.guild.id;
        state.channelId = message.member.voice.channel.id;
        fs.writeFileSync("state.json", JSON.stringify(state));
        console.log(`🎤 New connection: ${message.guild.id} → ${player.node.name}`);
      } else if (player.channelId !== message.member.voice.channel.id) {
        await player.setVoiceChannel(message.member.voice.channel.id);
        message.reply("🔄 **Switched channel** - adding to queue.");
      } else {
        message.reply("✅ **Connected** - adding to queue.");
      }

      // Search with fallback
      let res = await player.node.rest.resolve(`ytmsearch:${query}`);
      if (!res?.data?.length) {
        res = await player.node.rest.resolve(`ytsearch:${query}`);
      }
      
      console.log(`Search "${query}" on ${player.node.name}:`, res?.data?.length || 0, "results");
      
      if (!res?.data?.length) {
        return message.reply("❌ **No results.** Try different words!");
      }

      const track = res.data[0];
      if (!queues.has(message.guild.id)) queues.set(message.guild.id, []);
      queues.get(message.guild.id).push(track);

      message.reply(`➕ **Added:** ${track.info.title}\n👤 **${track.info.author}**`);

      if (queues.get(message.guild.id).length === 1) {
        await playNext(message.guild.id, player);
      }

    } catch (err) {
      console.error("❌ Play error:", err);
      message.reply("❌ **Failed to play.** Check console.");
    }
  }

  // !stop
  if (command === "!stop") {
    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("❌ **Nothing playing.**");

    queues.delete(message.guild.id);
    state = {};
    fs.writeFileSync("state.json", JSON.stringify(state));
    await player.disconnect();
    message.reply("⏹️ **Stopped & disconnected.**");
  }

  // !test (debug)
  if (command === "!test") {
    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("❌ **No connection.**");
    
    const res = await player.node.rest.resolve("ytsearch:gangnam style");
    message.reply(`🔍 **Node:** ${player.node.name}\n📊 **Results:** ${res?.data?.length || 0}`);
    console.log("TEST:", player.node.name, res?.data?.[0]?.info?.title);
  }
});

/* ---------------------------
   Global Track End
--------------------------- */
shoukaku.on("playerEnd", async (player) => {
  const guildId = player.guildId;
  const queue = queues.get(guildId);
  if (!queue?.length) return;

  queue.shift();
  if (queue.length > 0) {
    await playNext(guildId, player);
  }
});

/* ---------------------------
   Play Next
--------------------------- */
async function playNext(guildId, player) {
  const queue = queues.get(guildId);
  if (!queue?.length) return;

  const track = queue[0];
  try {
    await player.playTrack({ track: track.encoded });
    console.log(`▶️ Playing "${track.info.title}" on ${player.node.name}`);
  } catch (err) {
    console.error("PlayNext failed:", err);
  }
}

/* ---------------------------
   Login
--------------------------- */
client.login(process.env.BOT_TOKEN);
