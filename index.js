require("dotenv").config();
const fs = require("fs");
const http = require("http");
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

// Railway Keep-alive
http.createServer((req, res) => res.end("VinRadio active")).listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const nodes = [
    { name: "Railway-Internal", url: "yamabiko.proxy.rlwy.net:17895", auth: "vinradio", secure: false },
    { name: "Public-Backup", url: "lavalink.dev:2333", auth: "youshallnotpass", secure: false }
];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 10,
    moveOnDisconnect: true
});

const queues = new Map();

/* ---------------------------
   Correct Ready Event
--------------------------- */
client.on("ready", async () => {
    console.log(`✅ ${client.user.tag} is online`);

    // Load state safely
    let state = {};
    try {
        state = JSON.parse(fs.readFileSync("state.json", "utf8"));
    } catch (e) { return; }

    if (state.guildId && state.channelId) {
        console.log("🔄 Auto-restarting 24/7 Radio...");
        const player = await shoukaku.joinVoiceChannel({
            guildId: state.guildId,
            channelId: state.channelId,
            shardId: 0
        });
        await playMusic(state.guildId, player, "lofi hip hop radio");
    }
});

/* ---------------------------
   Improved Play Logic
--------------------------- */
async function playMusic(guildId, player, query, isAuto = false) {
    const res = await player.node.rest.resolve(`ytsearch:${query}`);
    if (!res?.data?.length) return;

    const track = res.data[0];
    
    if (!queues.has(guildId)) queues.set(guildId, []);
    const queue = queues.get(guildId);
    
    queue.push(track);
    
    // Only play immediately if the queue was empty
    if (queue.length === 1) {
        await player.playTrack({ track: track.encoded });
    }
}

shoukaku.on("trackEnd", async (player) => {
    const queue = queues.get(player.guildId);
    if (!queue) return;

    queue.shift();

    if (queue.length > 0) {
        await player.playTrack({ track: queue[0].encoded });
    } else {
        // 24/7 Mode: If queue is empty, restart the lofi stream
        console.log("Empty queue, looping lofi...");
        await playMusic(player.guildId, player, "lofi hip hop radio");
    }
});

/* ---------------------------
   Simple Command Handler
--------------------------- */
client.on("messageCreate", async (msg) => {
    if (msg.author.bot || !msg.content.startsWith("!")) return;
    const [cmd, ...args] = msg.content.slice(1).split(/\s+/);

    if (cmd === "play") {
        const vc = msg.member?.voice.channel;
        if (!vc) return msg.reply("Join a VC!");

        const player = await shoukaku.joinVoiceChannel({
            guildId: msg.guild.id,
            channelId: vc.id,
            shardId: 0
        });

        // Save state for Railway restarts
        fs.writeFileSync("state.json", JSON.stringify({ guildId: msg.guild.id, channelId: vc.id }));
        
        await playMusic(msg.guild.id, player, args.join(" ") || "lofi hip hop radio");
        msg.reply("🎶 Added to queue.");
    }

    if (cmd === "stop") {
        const player = shoukaku.players.get(msg.guild.id);
        if (player) {
            queues.delete(msg.guild.id);
            try { fs.unlinkSync("state.json"); } catch(e) {}
            await player.disconnect();
            msg.reply("Stopped.");
        }
    }
});

client.login(process.env.BOT_TOKEN);