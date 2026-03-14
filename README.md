\# VinRadio — Discord Music Bot



A 24/7 Discord music bot using discord.js, Shoukaku (Lavalink client), and yt-search.



\## Architecture



\- \*\*Runtime:\*\* Node.js 20

\- \*\*Framework:\*\* discord.js v14

\- \*\*Audio:\*\* Shoukaku v4 (Lavalink client)

\- \*\*Search:\*\* yt-search (YouTube search), ytsearch:/scsearch: prefixes via Lavalink

\- \*\*Keep-alive:\*\* Built-in HTTP server on port 5000



\## Lavalink Node



External node hosted on Railway: `yamabiko.proxy.rlwy.net:17895`

\- Auth: `vinradio`

\- Shoukaku reconnect: 20 retries, 5s interval



\## Commands



| Command | Description |

|---------|-------------|

| `!play <song/url>` | Play from YouTube or SoundCloud |

| `!skip` | Skip current track |

| `!stop` | Stop and disconnect |

| `!queue` / `!q` | Show queue |

| `!np` | Now playing |

| `!pause` / `!resume` | Pause/resume |

| `!volume <0-200>` | Set volume |

| `!help` | Show commands |



\## Search Fallback



1\. Tries `ytsearch:` (YouTube via Lavalink plugin) first

2\. Falls back to `scsearch:` (SoundCloud) if YouTube unavailable



\## Environment Variables



\- `BOT\_TOKEN` — Discord bot token (required, set as secret)

\- `PORT` — Keep-alive HTTP port (default: 5000)



\## Deployment



Configured as \*\*VM deployment\*\* (always-on) for 24/7 operation.

State (last voice channel) persisted to `state.json`.



