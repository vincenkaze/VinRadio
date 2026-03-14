require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");
const ytSearch = require("yt-search");

/* ---------------------------
Keep-alive server
--------------------------- */
http.createServer((req, res) => res.end("VinRadio running")).listen(process.env.PORT || 5000);

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
Lavalink Nodes
--------------------------- */
const nodes = [
  {
    name: "main",
    url: "yamabiko.proxy.rlwy.net:17895",
    auth: "vinradio",
    secure: false
  }
];

const shoukaku = new Shoukaku(
  new Connectors.DiscordJS(client),
  nodes,
  {
    reconnectTries: 20,
    reconnectInterval: 5000,
    restTimeout: 15000,
    moveOnDisconnect: false
  }
);

/* ---------------------------
State
--------------------------- */
const queues = new Map();
let lavalinkReady = false;

let state = {};
try {
  state = JSON.parse(fs.readFileSync("state.json"));
} catch {
  state = {};
}

/* ---------------------------
Lavalink Events
--------------------------- */
shoukaku.on("ready", name => {
  console.log(`[Lavalink] Connected to node: ${name}`);
  lavalinkReady = true;
});

shoukaku.on("error", (name, error) => {
  console.error(`[Lavalink] Node ${name} error: ${error.message}`);
});

shoukaku.on("close", (name, code) => {
  console.log(`[Lavalink] Node ${name} closed (code: ${code})`);
  lavalinkReady = false;
});

shoukaku.on("disconnect", name => {
  console.log(`[Lavalink] Node ${name} disconnected — will retry...`);
  lavalinkReady = false;
});

/* Forward raw voice packets */
client.on("raw", packet => {
  shoukaku.connector.raw(packet);
});

/* ---------------------------
Player Event Setup
--------------------------- */
function setupPlayerEvents(player, guildId) {
  player.on("end", async () => {
    const queue = queues.get(guildId);
    if (!queue) return;
    queue.shift();
    if (queue.length > 0) {
      await playNext(guildId, player);
    } else {
      console.log(`[Queue] Guild ${guildId} queue finished.`);
    }
  });

  player.on("exception", async exception => {
    console.error(`[Player] Exception in ${guildId}:`, exception?.message || exception);
    const queue = queues.get(guildId);
    if (!queue) return;
    queue.shift();
    if (queue.length > 0) await playNext(guildId, player);
  });

  player.on("stuck", async () => {
    console.log(`[Player] Stuck in ${guildId}, skipping...`);
    const queue = queues.get(guildId);
    if (!queue) return;
    queue.shift();
    if (queue.length > 0) await playNext(guildId, player);
  });
}

/* ---------------------------
Resolve Track (YouTube + SoundCloud fallback)
--------------------------- */
async function resolveTrack(player, query) {
  const isUrl = query.startsWith("http");

  if (isUrl) {
    const res = await player.node.rest.resolve(query);
    if (res && res.loadType !== "empty" && res.loadType !== "error") return res;
    return null;
  }

  /* Try YouTube first via Lavalink plugin */
  let res = await player.node.rest.resolve(`ytsearch:${query}`);
  if (res && res.loadType !== "empty" && res.loadType !== "error" && res.data?.length) {
    return res;
  }

  /* Fall back to SoundCloud */
  res = await player.node.rest.resolve(`scsearch:${query}`);
  if (res && res.loadType !== "empty" && res.loadType !== "error" && res.data?.length) {
    return res;
  }

  return null;
}

/* ---------------------------
Extract Track from Response
--------------------------- */
function extractTrack(res) {
  if (!res) return null;
  if (res.loadType === "playlist") return res.data?.tracks?.[0] || null;
  if (Array.isArray(res.data)) return res.data[0] || null;
  return res.data || null;
}

/* ---------------------------
Play Next
--------------------------- */
async function playNext(guildId, player) {
  const queue = queues.get(guildId);
  if (!queue || queue.length === 0) return;

  const track = queue[0];
  if (!track?.encoded) {
    console.log(`[Queue] Invalid track in guild ${guildId}`);
    queue.shift();
    if (queue.length > 0) await playNext(guildId, player);
    return;
  }

  try {
    await player.update({ track: { encoded: track.encoded } });
    console.log(`[Player] Playing: ${track.info?.title} in ${guildId}`);
  } catch (err) {
    console.error("[Player] Error playing track:", err.message);
  }
}

/* ---------------------------
Ready Event
--------------------------- */
client.once("clientReady", () => {
  console.log(`[Bot] VinRadio online as ${client.user.tag}`);
});

/* ---------------------------
Commands
--------------------------- */
client.on("messageCreate", async message => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  /* ---- PLAY ---- */
  if (command === "!play") {
    if (!lavalinkReady) return message.reply("Music system is reconnecting. Try again in a moment.");

    const query = args.join(" ");
    if (!query) return message.reply("Usage: `!play <song name or URL>`");
    if (!message.member.voice.channel) return message.reply("Join a voice channel first.");

    try {
      let player = shoukaku.players.get(message.guild.id);

      if (!player) {
        player = await shoukaku.joinVoiceChannel({
          guildId: message.guild.id,
          channelId: message.member.voice.channel.id,
          shardId: 0,
          adapterCreator: message.guild.voiceAdapterCreator
        });
        setupPlayerEvents(player, message.guild.id);
      }

      state.guildId = message.guild.id;
      state.channelId = message.member.voice.channel.id;
      fs.writeFileSync("state.json", JSON.stringify(state));

      const loading = await message.reply("Searching...");

      const res = await resolveTrack(player, query);
      if (!res) return loading.edit("No playable track found. Try a different search or link.");

      const track = extractTrack(res);
      if (!track?.info) return loading.edit("Could not load track info. Try another search.");

      if (!queues.has(message.guild.id)) queues.set(message.guild.id, []);
      const queue = queues.get(message.guild.id);
      queue.push(track);

      const source = track.info.sourceName || "unknown";
      if (queue.length === 1) {
        await loading.edit(`Now playing: **${track.info.title}** [${source}]`);
        await playNext(message.guild.id, player);
      } else {
        await loading.edit(`Added to queue (#${queue.length}): **${track.info.title}** [${source}]`);
      }

    } catch (err) {
      console.error("[Command] Playback error:", err.message);
      message.reply("Playback failed. The music server may be temporarily unavailable.");
    }
  }

  /* ---- STOP ---- */
  if (command === "!stop") {
    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("Nothing is playing.");

    queues.delete(message.guild.id);
    await player.disconnect();
    message.reply("Stopped and disconnected.");
  }

  /* ---- SKIP ---- */
  if (command === "!skip") {
    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("Nothing is playing.");

    const queue = queues.get(message.guild.id);
    if (!queue || queue.length === 0) return message.reply("Queue is empty.");

    queue.shift();

    if (queue.length === 0) {
      await player.stopTrack();
      return message.reply("Skipped! Queue is now empty.");
    }

    await playNext(message.guild.id, player);
    message.reply(`Skipped! Now playing: **${queue[0].info.title}**`);
  }

  /* ---- QUEUE ---- */
  if (command === "!queue" || command === "!q") {
    const queue = queues.get(message.guild.id);
    if (!queue || queue.length === 0) return message.reply("Queue is empty.");

    const list = queue
      .slice(0, 10)
      .map((t, i) => `${i === 0 ? "▶" : i + 1 + "."} ${t.info.title}`)
      .join("\n");

    const extra = queue.length > 10 ? `\n*...and ${queue.length - 10} more*` : "";
    message.reply(`**Queue (${queue.length} tracks):**\n${list}${extra}`);
  }

  /* ---- NOW PLAYING ---- */
  if (command === "!np" || command === "!nowplaying") {
    const queue = queues.get(message.guild.id);
    if (!queue || queue.length === 0) return message.reply("Nothing is playing.");
    message.reply(`Now playing: **${queue[0].info.title}**`);
  }

  /* ---- PAUSE ---- */
  if (command === "!pause") {
    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("Nothing is playing.");
    await player.setPaused(true);
    message.reply("Paused.");
  }

  /* ---- RESUME ---- */
  if (command === "!resume") {
    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("Nothing is playing.");
    await player.setPaused(false);
    message.reply("Resumed.");
  }

  /* ---- VOLUME ---- */
  if (command === "!volume" || command === "!vol") {
    const player = shoukaku.players.get(message.guild.id);
    if (!player) return message.reply("Nothing is playing.");

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 200) return message.reply("Volume must be between 0 and 200.");

    await player.setGlobalVolume(vol);
    message.reply(`Volume set to **${vol}%**`);
  }

  /* ---- HELP ---- */
  if (command === "!help") {
    message.reply(
      "**VinRadio Commands:**\n" +
      "`!play <song/url>` — Play a song (YouTube or SoundCloud)\n" +
      "`!skip` — Skip current song\n" +
      "`!stop` — Stop and disconnect\n" +
      "`!queue` / `!q` — Show queue\n" +
      "`!np` — Now playing\n" +
      "`!pause` — Pause\n" +
      "`!resume` — Resume\n" +
      "`!volume <0-200>` — Set volume"
    );
  }
});

/* ---------------------------
Login
--------------------------- */
client.login(process.env.BOT_TOKEN);
