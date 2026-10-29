# Poster 🤖📰

🇬🇧 **English** · 🇵🇱 [Polski](README.pl.md)

**Poster LITE** – free, open source (AGPL) social media automation running 24/7 on a NAS or a server:
a **web control panel** + **n8n (Community Edition)** in Docker.
The bot collects the latest news from RSS feeds, Google News and X profiles, and AI (Google Gemini or a model on your own
hardware, e.g. Ollama) picks the most important story and writes the posts. The image is **the photo from the article** (free),
and when there is none – a post with a link. The package lands in **Telegram** with ✅/❌ buttons. After approval the bot
publishes to **X and Facebook**, and you can post the image, text and video script from the draft to Instagram and TikTok by hand.

You can also **write your own post** at any time (*✍️ New post* in the panel): AI adapts it to X and Facebook, and you
edit the versions and publish right away or after approval in Telegram ([“📣 Your own post”](#-your-own-post)).

You set everything up in the panel at **`http://NAS_IP:7080`**, without SSH and without editing `.env`:
- the bot (topic, sources, pause, “Run now”);
- the schedule (“every 4 h from 8 to 20”, “at 9:05, 13:05 and 18:05 on weekdays”);
- the AI model, API keys and the X and Facebook accounts.

> ⭐ **The PRO version** adds multiple bots, a website/blog mode, a YouTube channel bot, Instagram, Threads, Bluesky, a Telegram channel, TikTok with video, a
> brand image, scheduling your own posts (also on repeat) with a content calendar, an autopilot (publishing news without approval) and more
> AI providers with a fallback provider –
> [edition comparison](#-pro-version) and the [product page](https://posterapp.pl/en/).

**Installation** is one command pasted over SSH on a NAS with Docker or a Linux server – on a clean Ubuntu or Debian the installer installs Docker itself: `curl -fsSL https://posterapp.pl/install.sh | sudo bash`
(details: [“🚀 Installation in one command”](#-installation-in-one-command)).

![Poster dashboard: the bot card, service status and recent activity](docs/img/lite-dashboard-en.webp)

```mermaid
flowchart LR
  subgraph NAS["NAS / server · Docker"]
    subgraph panel["Panel :7080"]
      UI["🖥️ Web panel<br/>bot · schedule · accounts"]
      SCH["⏰ Schedule"]
      TGP["📥 ✅/❌ buttons<br/>Telegram long-poll"]
      GW["🔐 API gateway + AI router<br/>adds the bot's keys"]
    end
    subgraph n8n["n8n · Poster workflow"]
      G["Sources → dedup → AI → photo → draft"]
      P["Publishing X → FB → report"]
    end
    RSSHub["RSSHub<br/>X → RSS"]
  end
  SCH == "generate job" ==> G
  TGP == "publish job" ==> P
  G & P == "API requests" ==> GW
  GW ==> API["Gemini · Ollama · OpenAI-compatible API<br/>Telegram · X · Meta"]
  RSSHub ==> G
```

| Part | How it works |
|---|---|
| Control panel | Its own `poster-panel` container (Node.js, no libraries or CDN), English and Polish interface, password, light/dark theme, works on a phone |
| Bot | Topic, post language, instructions for AI, sources, schedule, AI model, platforms and its own X / Facebook accounts |
| Schedule | In the panel: every N hours within a from–to window or selected hours, minute, weekdays; pause; “Run now” |
| Your own post | Panel → *✍️ New post*: your text (+ link, a photo from the disk or the camera) → AI writes versions for X and Facebook (or the text goes without AI) → you edit them → approval in Telegram or **Publish now** |
| Keys and tokens | Only in the panel (`data/panel/secrets.json`, chmod 600). n8n **stores no keys**: it calls APIs through the panel gateway, which adds the keys and refreshes the X token itself |
| Reading X without the paid API | **RSSHub** (self-hosted, `auth_token` cookie of a separate account) → RSS feed. Alternatives: Apify, Nitter |
| Deduplication | In the panel: key `x:<tweet id>` or the URL without `utm_*`, plus a filter of identical titles and a list of recent topics passed to the LLM |
| Text (AI) | **Gemini** or any OpenAI-compatible API, e.g. **Ollama** on your own hardware. Always clean JSON by schema: `post_x`, `post_fb_insta`, `script_tiktok` |
| Image | Mode in the bot: **📷 photo from the article** (RSS / og:image / tweet), **🔗 post with a link** or **🚫 no image**. When the article has no photo, X and Facebook get a post with a link |
| Costs | “Cost of one post” card: AI text and publishing on X. Images are always free |
| Human-in-the-Loop | Telegram bot with buttons. The panel **polls** Telegram (long polling), so a click works instantly and **the NAS does not have to be exposed to the internet** |
| Publishing | X API v2 (OAuth2 + `media.write`), Meta Graph API (FB `/{page}/photos` or `/{page}/feed`). Instagram and TikTok: image, texts and video script in the draft for manual posting |
| Archive | Every draft (JSON + image) is saved in `data/files` on the NAS; the panel shows a draft gallery |

## ⭐ PRO version

Poster LITE is free and open source (AGPL). The PRO version is the same program with more features:

| Feature | LITE | PRO |
|---|:---:|:---:|
| Bots | 1 | unlimited, with copying settings and a separate Telegram chat |
| Sources: RSS, Google News, X profiles (RSSHub / Apify) | ✅ | ✅ |
| Schedule, pause, “Run now” | ✅ | ✅ |
| Draft approval in Telegram | ✅ | ✅ |
| Publishing news without approval (autopilot) | – | ✅ |
| Your own post: AI adapts your text to the platforms, “Publish now” | X and Facebook | X, Facebook, Instagram, Threads, Bluesky, Telegram channel, TikTok |
| Scheduling your own posts for a date and time, several bots at once | – | ✅ |
| Recurring posts (series) with an AI rewrite before every repeat, content calendar | – | ✅ |
| Posting from your phone: `/post` in Telegram – AI adapts the text, the draft comes back with ✅/❌ | – | ✅ |
| X and Facebook | ✅ | ✅ |
| Instagram | by hand | ✅ |
| Threads and Bluesky (text, image, link card) | – | ✅ |
| Telegram channel (a photo with a caption or a post with a link preview) | – | ✅ |
| TikTok: video from the post image (animation, free) | script to record by hand | ✅ |
| Website / blog mode: every new article on your site becomes posts | – | ✅ |
| YouTube channel: every new video from your channel becomes posts (no YouTube login) | – | ✅ |
| AI text: Gemini, Ollama, custom OpenAI-compatible API | ✅ | ✅ |
| Groq, OpenRouter, Mistral and a fallback provider | – | ✅ |
| Image: photo from the article, post with a link | ✅ | ✅ |
| Brand image (when the article has no photo, or for every post) | – | ✅ |
| Monthly AI usage counter | – | ✅ |
| PL/EN panel, drafts, history, alerts, cost per post | ✅ | ✅ |

Details and price: **[posterapp.pl](https://posterapp.pl/en/)**.

**After the purchase** open the order page (the *Access purchase* button in the email from Polar), copy the license key,
paste it in the panel (*Settings → PRO edition*) and click *Check the key*. The panel checks it and shows one command to run over SSH – your bots, keys and history stay unchanged:

```bash
sudo bash scripts/upgrade-to-pro.sh
```

The script takes the key from the panel (when it is not there – it asks for it), activates the license on this NAS,
waits for access to the PRO repository (usually a few minutes) and switches the installation to PRO. If access is not ready yet, run the
script again a few minutes later – it will not use a second device. The license covers 2 devices and 12 months of
updates; after that the installed version keeps working, and renewing the license brings the updates back.

**Refund.** Within 14 days of the purchase you can return the license without giving a reason, as long as you have not
activated it – only `upgrade-to-pro.sh` activates it (checking the key in the panel does not). Write to
kontakt@posterapp.pl. Details: [PRO license terms](https://posterapp.pl/license.html?lang=en).

## Repository contents

```
poster/
├── docker-compose.yml          # panel + n8n + RSSHub, volumes, time zone, healthcheck
├── .env.example                # template: NAS IP, ports, time zone, auto-generated keys
├── README.md · README.pl.md        # description in English and in Polish
├── CHANGELOG.md · CHANGELOG.pl.md  # change history and manual steps for updates, if any
├── SECURITY.md · CONTRIBUTING.md   # reporting vulnerabilities, contributing (in Polish: *.pl.md)
├── CLA.md · LICENSE                # contributor agreement, GNU AGPL v3 license
├── .github/workflows/ci.yml    # automated tests (GitHub Actions)
├── docs/                       # installer (install.sh), extra guides (deploy key), screenshots, product page
├── panel/                      # control panel (Node.js, Dockerfile, no npm dependencies)
│   ├── server.js · lib/        # API, scheduler, API gateway, AI router, images, Telegram, OAuth accounts
│   ├── public/                 # web interface
│   └── test/                   # tests: node --test panel/test/*.test.js
├── workflows/
│   ├── poster_workflow.json    # workflow to import into n8n (generated – do not edit by hand)
│   └── src/                    # workflow sources: build.py + code/*.js (Code nodes), validate.js
└── scripts/
    ├── init-nas.sh             # .env, keys, data/ directories owned by 1000:1000
    ├── import-to-n8n.sh        # import + publish the workflow in n8n (n8n CLI)
    ├── update.sh               # one-command update
    ├── upgrade-to-pro.sh       # moving from LITE to PRO after buying a license
    └── setup-deploy-key.sh     # one-off: pulling from GitHub without a password/token (deploy key)
```

---

## ⬆️ Updating

```bash
cd /volume1/docker/poster          # project directory (on UGOS also /volume2/…, on a server e.g. /opt/poster)
sudo bash scripts/update.sh
```

`update.sh` runs, in order:
1. pulls the new version from GitHub (`git pull` in the `alpine/git` container, no git installation needed);
2. `init-nas.sh`: adds missing auto-generated keys to `.env` and fixes the permissions of `data/`, without changing existing values;
3. `docker compose up -d --build`: rebuilds the panel image and restarts the containers;
4. `import-to-n8n.sh`: imports the new workflow (same ID, replaces the old one), publishes it and restarts n8n.

What changed and whether a version needs anything more – [CHANGELOG.md](CHANGELOG.md).
Installing from a private copy of the repository (e.g. your own fork)? Updating without typing a token is described in [docs/deploy-key.md](docs/deploy-key.md).


---

## 🚀 Installation in one command

On a NAS with Docker and Docker Compose v2 (see “Step 0”) or a Linux server, log in over SSH (see “How to connect to the
NAS over SSH”) and paste:

```bash
curl -fsSL https://posterapp.pl/install.sh | sudo bash
```

The installer, in order:
1. checks Docker and Docker Compose v2. On an Ubuntu or Debian server without Docker it installs Docker itself from
   Docker's official repository (usually 1–3 min). When the server clock is wrong (common in a virtual machine), apt
   rejects the package lists – the installer then tells you how to set the time;
2. downloads Poster into the NAS's `docker` folder – `/volume1/docker/poster`, or e.g. `/volume2/docker/poster` when
   that folder is on another volume – or to `/opt/poster` (server). Choose another place with `--dir` (below). Git runs
   in the `alpine/git` container, so you do not need to install it;
3. runs `scripts/init-nas.sh` (`.env`, keys, `data/` directories) and writes the NAS IP address, the host's time zone
   and free ports into the new `.env`;
4. starts the containers (`docker compose up -d --build`) – the first time it downloads about 1 GB, usually 3–15 min;
5. creates the n8n owner account (login `admin@poster.local`, random password) so that nobody on your network can take
   over n8n, then imports and publishes the workflow (`scripts/import-to-n8n.sh`);
6. prints the panel address with a one-time code for setting the password and the n8n password – **save them**, the
   installer shows them only once.

Then open the panel and continue with [Step 7](#step-7-panel-password-keys-first-bot): password, keys and the first bot.

- **Another directory or language of the messages:**
  `curl -fsSL https://posterapp.pl/install.sh | sudo bash -s -- --dir /opt/poster --lang pl`.
- **Server with a public IP address (VPS):** the installer sets `BIND_ADDRESS=127.0.0.1` and prints the SSH tunnel
  command at the end (see “Remote access and servers on the internet”).
- **Interrupted installation** (e.g. no internet): run the same command again – it finishes the installation. It does
  not change a finished installation, it only points to the update.
- **Read the script first:** `curl -fsSLO https://posterapp.pl/install.sh`, look through it (`less install.sh`) and
  run it: `sudo bash install.sh`. Without `curl`: `wget -qO- https://posterapp.pl/install.sh | sudo bash`.

Prefer to do everything by hand? The step-by-step guide is below.

---

## 🧭 Step-by-step installation (NAS or a server with Docker)

> This guide was written on a **UGREEN DXP2800 (UGOS Pro)** NAS, so its menus and paths (`/volume1/docker/poster`)
> serve as the example. On another NAS or a Linux server with Docker and Docker Compose v2 the steps are the same:
> use your own project directory (e.g. `/opt/poster`) and skip the UGOS notes.
> Tested on x86-64 (the DXP2800 has an Intel N100 CPU). The stack uses about 0.6–1.2 GB of RAM.
> Menu names may differ slightly between UGOS Pro versions.

### Step 0. Preparing the NAS or server (once)

1. **Docker with Docker Compose v2**: on UGOS *App Center* → install **Docker**. On an Ubuntu or Debian server the [one-command installer](#-installation-in-one-command) installs it, on another Linux install Docker Engine with the `docker compose` plugin.
2. **SSH**: on UGOS *Control Panel → Terminal* → enable **SSH** (port 22). Log in with an administrator account.
3. **Fixed IP address**: reserve a DHCP address for the NAS in your router (e.g. `192.168.1.50`). You will use it in `NAS_IP` and in the browser.
4. **Time zone**: on UGOS *Control Panel → Date & Time* → your time zone (e.g. `Europe/Warsaw`) + NTP sync.
5. **Shared folder `docker`** (UGOS): if the Docker app did not create it, add it in *File Manager* or in *Control Panel → Shared Folders*. It usually lives at `/volume1/docker`. Check the volume number over SSH: `ls -d /volume*/docker`.

#### How to connect to the NAS over SSH
You open the terminal **on your computer**, not on the NAS. After logging in, every command you paste runs on the NAS.

1. Open a terminal on your PC:
   - **Windows 10/11:** *Start* → **PowerShell** or **Terminal**. The `ssh` client is built in.
   - **macOS / Linux:** the **Terminal** app.
2. Connect with the UGOS administrator login and the NAS IP:
   ```bash
   ssh your_login@192.168.1.50
   ```
   On the first connection confirm the key fingerprint (`yes`) and enter the UGOS account password. The password characters are not shown.
3. The prompt changes to e.g. `your_login@DXP2800:~$`: you are on the NAS. Paste the commands from this guide one by one (in PowerShell with the right mouse button). `sudo` asks for the same UGOS account password.
4. End the session with `exit`.

### Step 1. Where to put the project files

Target layout:

```
/volume1/docker/poster/
├── docker-compose.yml
├── .env                         ← NAS configuration (chmod 600)
├── panel/  workflows/  scripts/
└── data/                        ← created by scripts/init-nas.sh, owner 1000:1000
    ├── n8n/                     → n8n: /home/node/.n8n        (SQLite database, config)
    ├── files/                   → n8n: /home/node/.n8n-files  (drafts *.json, images, video)
    └── panel/                   → panel: /data                (bots, keys, history, duplicate memory)
```

There are two ways to copy the files:

- **Over SSH (recommended; git in a container, no git installation needed)**. The repository is public, so no login is needed:
  ```bash
  cd /volume1/docker          # or /volume2/docker – wherever your docker folder is (on a server e.g. /opt)
  sudo docker run --rm -v "$PWD":/git alpine/git clone https://github.com/imdangro/poster-app.git poster
  cd poster                   # run the next commands in the project directory
  ```
  A copy downloaded this way updates with a single command (section “Updating”). Installing from a private copy of the
  repository (e.g. your own fork) is described in [docs/deploy-key.md](docs/deploy-key.md).
- **Over SMB from your computer**: download the repository as a ZIP (GitHub → *Code → Download ZIP*), unpack it and copy the contents to `\\NAS_IP\docker\poster`.
  Such a copy has no `.git` directory, so `update.sh` cannot pull changes by itself: to update, copy the new files
  and run `sudo bash scripts/update.sh --no-pull`.

### Step 2. Permissions (UID/GID 1000:1000) and `.env`

The n8n and panel processes run in the containers as the user with **UID 1000 and GID 1000**. The directories in `data/` must belong to it.
Otherwise the logs show e.g. `EACCES: permission denied` or `SQLITE_CANTOPEN`.

```bash
cd /volume1/docker/poster
sudo bash scripts/init-nas.sh
```

The script:
1. creates `.env` from `.env.example` (if it does not exist) and sets `chmod 600` on it;
2. generates `N8N_ENCRYPTION_KEY` and `PANEL_INTERNAL_TOKEN` if they are empty;
3. creates `data/n8n`, `data/files`, `data/panel` and runs `chown -R 1000:1000 data` + `chmod -R u+rwX,g+rwX,o-rwx data`.

You can run the script many times. If `EACCES` persists, the share may have restrictive UGOS ACLs.
Then add an ACL for UID 1000: `sudo setfacl -R -m u:1000:rwx,d:u:1000:rwx data`. Do not run the containers as root and do not set `chmod 777`.

Fill in `.env` (`sudo nano .env`). That really is all, because everything else is set in the panel:

| Variable | Example | Notes |
|---|---|---|
| `NAS_IP` | `192.168.1.50` | LAN address of the NAS (links in the panel, X callback) |
| `PANEL_PORT` | `7080` | control panel |
| `N8N_PORT` | `5678` | n8n editor |
| `TZ` | `Europe/Warsaw` | bot schedules and dates in posts |
| `N8N_ENCRYPTION_KEY`, `PANEL_INTERNAL_TOKEN` | *(generated)* | **back up `.env` and never change `N8N_ENCRYPTION_KEY`** |
| `TWITTER_AUTH_TOKEN` | `a1b2…` | for RSSHub, when a bot follows X profiles (see “X source”) |
| `RSSHUB_PROXY_URI` | empty | optional proxy for reading X only (see “X source”) |

### Step 3a. Starting the stack over SSH (recommended)

```bash
cd /volume1/docker/poster
sudo docker compose pull              # n8n and RSSHub images
sudo docker compose up -d --build     # builds the panel and starts everything; restart: unless-stopped → comes back after a NAS reboot
sudo docker compose ps                # poster-panel, poster-n8n: Up … (healthy), poster-rsshub: Up
```

After changing `.env` or `docker-compose.yml`, just run `sudo docker compose up -d --build` again.

### Step 3b. Alternative: the Docker app in UGOS (no console)

1. Copy the files over SMB to `docker/poster`. Save `.env.example` as `.env` and fill it in on your computer. Generate `N8N_ENCRYPTION_KEY` and `PANEL_INTERNAL_TOKEN` e.g. with a password generator (at least 32 characters, letters and digits only).
2. Create the directories `data/n8n`, `data/files` and `data/panel` in *File Manager*. **You will still set the 1000:1000 permissions over SSH (Step 2)**, because the UGOS interface does not change the owner to UID 1000.
3. *Docker → Project → Create*: name `poster`, path `/docker/poster` (the folder with `docker-compose.yml`), then **Deploy**. Compose builds the panel image from the `panel/` folder. If your UGOS version cannot build images in projects, start the stack over SSH (Step 3a).
4. The logs are in *Container → poster-panel / poster-n8n → Log*.

### Step 4. Network, ports and time zone

- **Panel**: `http://<NAS_IP>:7080`. **n8n**: `http://<NAS_IP>:5678`.
- **Do not forward these ports on your router.** The bot needs no incoming traffic, because it handles Telegram, AI and the social media platforms with outgoing connections. For remote access a VPN is best (e.g. Tailscale) – see “Remote access and servers on the internet”.
- `BIND_ADDRESS` in `.env` sets the host address the panel and n8n listen on: `0.0.0.0` (default) means all IPv4 addresses, `127.0.0.1` – the host only.
- Port `7081` (the panel API for n8n) and RSSHub (`1200`) are available **only inside the Docker network**.
- If a port is taken, change `PANEL_PORT` or `N8N_PORT` in `.env` and run `sudo docker compose up -d`.
- An enabled **UGOS firewall** (*Control Panel → Security → Firewall*) needs rules: TCP `7080` and `5678`, source: the LAN subnet (e.g. `192.168.1.0/24`).
- **Time zone**: `TZ` from `.env` goes to the panel (schedule) and n8n, with automatic daylight saving changes. Check: `sudo docker exec poster-panel date`.

#### Remote access and servers on the internet
The panel and n8n run over HTTP and are meant for the local network, so do not expose them directly to the internet.
- **NAS at home**: connect remotely over a VPN, e.g. [Tailscale](https://tailscale.com) (an app on the NAS and on your phone).
- **Server on the internet (VPS)**: set `BIND_ADDRESS=127.0.0.1` and `NAS_IP=localhost` in `.env` (the one-command
  installer does it by itself when the server has a public IP address), run `sudo docker compose up -d`, then connect
  from your computer through an SSH tunnel:
  ```bash
  ssh -L 7080:127.0.0.1:7080 -L 5678:127.0.0.1:5678 your_login@server_address
  ```
  While the tunnel is open, the panel works at `http://localhost:7080` and n8n at `http://localhost:5678` (also the X
  callback address from the panel). Instead of a tunnel you can run Tailscale on the server.
- Behind a reverse proxy with HTTPS (e.g. Caddy) the panel adds the `Secure` flag to the session cookie by itself
  (header `X-Forwarded-Proto: https`). Links in the panel are still built from `NAS_IP` and the ports, so a tunnel or a VPN is the simpler way.

### Step 5. Logs: is everything up

```bash
cd /volume1/docker/poster
sudo docker compose logs --tail=50 panel         # “Panel: http://…:7080”, “API for n8n: port 7081”
sudo docker compose logs -f --tail=200 n8n       # “Editor is now accessible via: …” (Ctrl+C ends the view)
sudo docker compose ps                           # poster-panel / poster-n8n … (healthy)
curl -s http://127.0.0.1:5678/healthz/readiness  # {"status":"ok"} = the n8n database is connected
```

These messages in the n8n logs are **harmless**:
- `Failed to start Python task runner … Python 3 is missing`: Poster uses JavaScript nodes only.
- `There are deprecations related to your n8n setup …`: announcements of changes in future n8n versions.
- `ExperimentalWarning: localStorage is not available`: a Node.js warning from the task runner process.

| Message in the logs | Cause | Fix |
|---|---|---|
| `EACCES: permission denied …` (n8n) / `Cannot use the data directory /data` (panel) | wrong owner of `data/` | `sudo bash scripts/init-nas.sh` |
| `SQLITE_CANTOPEN` / `SQLITE_READONLY` | as above, or no free space | as above; `df -h /volume1` |
| `Mismatching encryption keys` | `N8N_ENCRYPTION_KEY` in `.env` ≠ the key in `data/n8n/config` | restore the previous key |
| `required variable … is missing` | missing key in `.env` | `sudo bash scripts/init-nas.sh` |
| `port is already allocated` | port taken | change `PANEL_PORT` / `N8N_PORT` |

### Step 6. n8n: owner account and workflow import

1. Open `http://NAS_IP:5678` and create the **owner account** right away – until it exists, anyone on your network
   can create it. The one-command installer creates it by itself.
2. Import and publish the workflow: `sudo bash scripts/import-to-n8n.sh`. The workflow needs no n8n credentials.

### Step 7. Panel: password, keys, first bot

1. Open **`http://NAS_IP:7080`** and set the panel password. The panel asks for a **one-time code** – the one-command
   installer shows it at the end, and you can print it from the logs with `sudo docker compose logs panel | grep -i code`
   (without a console: the Docker app in UGOS → *Container → poster-panel → Log*). This way nobody else on the network can set the password before you.
   On the same screen you choose the **panel language** – English or Polish (you can change it later in *Settings*).
   Password reset: `sudo docker compose exec panel node reset-password.js` (prints a new code).
2. **Settings → Google Gemini**: paste the key and click *Check the key*.
   A key from a project without billing is free (see “Costs”). Instead of Gemini you can use a model on your own hardware (*Settings → AI providers*, e.g. Ollama).
3. **Settings → Telegram**: paste the bot token, send `/start` to the bot and click **Detect**, then *Send test* and *Save*.
4. **Add a bot** (or use the one migrated from `.env`) and fill in, in order:
   - topic and sources – *Add Google News* is the quickest start;
   - schedule;
   - the *Publishing* tab. Leave the platforms off for now: drafts will only come to Telegram.
5. **Run now**, and when the draft looks good, click **Resume**. The bot will run on its schedule.
6. Connect the platform accounts in the bot's **Accounts** tab and turn them on in the *Publishing* tab (see “Accounts and API keys”).

---

## 🎛️ Control panel

| Place | What is there |
|---|---|
| **Dashboard** | Status of n8n, Telegram, Gemini and the X reader account. The bot card with the next run, the last result and the platforms. *Write a post*, *Run now* and *Pause/Resume* buttons. A table of recent activity with links to the draft and to the n8n execution |
| **New post** | Your own post: text, link, photo (from the disk or the camera), X and Facebook, a hint for AI. *Adapt to platforms* – AI writes a version for every platform, *No AI* – your text within the platform limits. You edit the versions before sending: *Send for approval* or *Publish now* |
| **Bot → General** | Name, topic, brand name, post language, **additional instructions for AI** (tone, audience, topics to avoid) |
| **Bot → Sources** | RSS feeds with a *Test* button (a website address is enough – the panel finds its feed) and a Google News wizard. X profiles (RSSHub / Apify / off) with a test via RSSHub. Maximum news age, number of candidates for AI |
| **Bot → Schedule** | Active / paused. *Every few hours* (every 1–24 h within a from–to window) or *At selected hours* (0–23 grid). Minute, **random offset** (up to 15/30/45 min), weekdays, preview of the next runs |
| **Bot → Text & images** | Cost of one post. Text provider and model, Gemini “thinking”. **Where the image comes from** (photo from the article / post with a link / no image) |
| **Bot → Publishing** | Switches for X and Facebook – publishing after clicking ✅ in Telegram |
| **Bot → Accounts** | Connecting accounts: X (OAuth2) and a Facebook page (page token) |
| **Bot → History** | The bot's runs and drafts |
| **Bot → Advanced** | Duplicate memory (reset), **deleting the bot** |
| **Drafts** | Draft gallery with images, texts to copy (also for posting to Instagram and TikTok by hand), publishing results and downloading the image |
| **Settings** | Gemini key, **AI providers** (Ollama, custom OpenAI-compatible API), Telegram bot (+ chat ID detection, admins), X app, Graph API version, Apify, **panel language**, panel password, **PRO edition** (license key after the purchase) |

<details>
<summary>📸 Screenshots: new post, schedule, text and costs, drafts, phone</summary>

![New post: your text and versions for X and Facebook](docs/img/lite-compose-en.webp)

![Schedule: every few hours or at selected hours, random offset, weekdays](docs/img/lite-schedule-en.webp)

![Text & images: cost of one post, text provider and model](docs/img/lite-ai-en.webp)

![Draft: image, texts for X and Facebook, TikTok script](docs/img/lite-draft-en.webp)

<img src="docs/img/lite-phone-en.webp" width="320" alt="The panel on a phone">

</details>

**Panel language** (English / polski) covers the interface, the Telegram messages (drafts, reports, alerts) and error
messages. The post language is a separate setting in every bot (*Bot → General*), and the instructions for AI stay in Polish.

**Schedule.**
- The panel checks the slots every 20 s in the `TZ` time zone. Every slot runs the bot **exactly once** – also with a random offset.
- After a failure or a NAS restart the panel does not catch up on slots older than 10 min, so there is no burst of overdue posts.
- Changing the schedule does not run the bot for a slot that has just passed.
- A new bot starts **paused**.
- *Run now* always works, also for a paused bot.

**Security.**
- API keys and account tokens are stored only in `data/panel/secrets.json` (chmod 600). The panel does not send them to the browser: it only shows the ending `••••abcd`.
- n8n gets the bot configuration from the panel **without secrets** and calls APIs through the gateway `http://panel:7081/gw/<bot>/<service>/…`. The gateway adds the right key or token, so secrets do not end up in the n8n execution history.
- The n8n webhook and the gateway are protected by a shared secret `PANEL_INTERNAL_TOKEN`, and the gateway is reachable only in the Docker network.
- Login: password (scrypt), session in a signed cookie (30 days), limited login attempts. You can set the first password only with a one-time code from the panel logs.
- More about security and reporting vulnerabilities: [SECURITY.md](SECURITY.md).

**Panel backup**: the `data/panel` directory (bot, keys, history). A full backup is described in “Maintenance”.

---

## 📣 Your own post

Besides the posts from news, you can publish your own at any time: an announcement, a promotion, an invitation, an opinion.

1. Panel → **✍️ New post** (or *Write a post* on the Dashboard and ✍️ on the bot card).
2. Type the text, optionally a link and a photo (from the disk or straight from the phone's camera – the panel
   shrinks large photos itself) and choose the platforms. You can choose the platforms turned on in the bot
   (*Publishing* tab).
3. **Adapt to platforms** – AI writes a separate version for every platform:
   - **X** – short, up to 280 characters; the link goes at the end and counts as 23 characters;
   - **Facebook** – a longer text in paragraphs, a question or a call to action, the link at the end;

   AI sticks to your content – it adds no facts, prices or promises – and writes in the bot's language, following its
   instructions. The *hint for AI* changes the tone of this post only (e.g. “more casual, with humour”).
   **No AI – my text** gives versions without AI: your text trimmed to the platform limits.
4. Edit the versions and choose:
   - **Send for approval** – the draft comes to Telegram with the ✅/❌ buttons, like any other;
   - **Publish now** – the post goes out right away, and a report with links goes to Telegram and the panel.

For your own posts only, the bot needs no sources or schedule (it can stay paused) – Telegram and the connected
accounts are enough. Cost: one AI text request per *Adapt* click (the same as one news draft), without AI – free;
publishing on X costs according to the X API pricing.
The PRO version adds your own posts on Instagram, Threads, Bluesky, a Telegram channel and TikTok, a brand image, choosing the bot, scheduling posts for a date and time (also on repeat), a content calendar, several bots at once and posting from your phone with the `/post` command in Telegram.

---

## 💸 Costs

Only **AI text** can cost money – and it usually fits within a free quota. The *Cost of one post* card
in **Bot → Text & images** shows what costs money with the current settings. Images are always free.

Publishing on **X** is paid separately: new X apps are billed for every post, and a post with a link costs
many times more than a post with a photo (see “X”). The *Cost of one post* card shows the approximate X cost
for the bot's settings.

**Image – where the bot takes it from** (chosen in the bot):

| Mode | What it does | Cost |
|---|---|---|
| 📷 Photo from the article (default) | The photo from RSS (`enclosure`, `media:content`, `<img>`), from the tweet or from the article page (`og:image`). Skips logos, small pictures (< 600 px) and a picture repeated in consecutive posts | free |
| 🔗 Post with a link | X and Facebook get the text with a link – the platform builds the article preview. The article photo comes with the draft in Telegram | free |
| 🚫 No image | X and Facebook: text with a link | free |

When the article has no photo, X and Facebook get a post with a link.
Google News links do not lead straight to the article – for photos add the portal's direct RSS feed.

⚖️ Photos from articles are protected by copyright. Publish them only when you have the right to (your own sources, an agency license). When in doubt, choose a **post with a link** – it is the standard, safe way to share news.

**Text – free options** (*Settings*, then the choice in the bot):
- **Gemini with a key from a project without billing**: create the key in AI Studio in a project **without billing**. Texts then use Google's free quota (Google may use this data to improve its services).
- **Ollama** – a model on your own computer/NAS (`http://IP:11434/v1`); free, but slow on weak hardware.
- **A custom OpenAI-compatible API** – e.g. LM Studio, vLLM or a cloud provider with a free plan.
- Gemini “thinking” is **low** by default – picking the news and writing posts needs no long reasoning, and this lowers the cost.

---

## Accounts and API keys

### Telegram (draft approval and alerts)
1. In [@BotFather](https://t.me/BotFather) send `/newbot`. Paste the token in **panel → Settings → Telegram** and click *Check token*.
2. Send `/start` to your bot. The bot replies with the chat ID, and the **Detect** button fills it in for you.
   For a group, add the bot to the group and send `/start` there.
3. In a group also enter the **admin IDs** (your user ID), so that only you can click ✅.
4. If the Telegram bot had a webhook before, remove it: `curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`.

### Google Gemini
You create the key in [Google AI Studio](https://aistudio.google.com/apikey) and paste it in **panel → Settings → Google Gemini**.
A key from a project **without billing** is enough – texts then fit within Google's free quota. You choose the model
in *Bot → Text & images* (suggestions from the list fetched for your key). Choose stable names (e.g. `gemini-3.8-flash`).
Aliases like `gemini-flash-latest` return 503 more often. When the model is temporarily overloaded (503) or the request
limit is used up (429), a bot run retries with growing pauses for about 2 minutes and only then sends an alert.

### X (publishing via API v2)
You need an X developer app to publish.

**Cost.** Since February 2026 new X developer accounts get no free plan: you pay for usage by buying
credits in the *X Developer Console*. According to 2026 overviews a regular post costs about USD 0.015, and **a post with a link
about USD 0.20**. X may change its prices – check them in the console before you turn publishing on.
The link goes into the X post in the *🔗 post with a link* image mode and in a post without an image; a post with a *📷 photo from the article* has no link.

1. In [developer.x.com](https://developer.x.com) open *Projects & Apps → your app → User authentication settings → Set up*:
   - **App permissions**: *Read and write*
   - **Type of App**: *Web App, Automated App or Bot* (confidential client)
   - **Callback URI**: the address from **panel → Settings → X (Twitter) app** (`http://<NAS_IP>:7080/oauth/x/callback`)
   - **Website URL**: e.g. the address of your website or profile
2. *Keys and tokens → OAuth 2.0 Client ID and Client Secret*: paste them in **panel → Settings → X (Twitter) app**.
3. In the bot open the **Accounts → Connect X account** tab, log in to the account this bot should publish from and click *Authorize*.
   The panel saves the tokens and refreshes them (scope `offline.access`).
4. If the X portal does not accept the `http://IP…` address:
   - register any address, e.g. `http://localhost/poster-x`;
   - enter it in the panel as the *Custom Callback URI*;
   - after authorization the browser shows a page error. Copy **the whole address from the address bar** and paste it in the panel in the field that appears under the *Connect* button.

### Meta: Facebook page
1. In [Meta for Developers](https://developers.facebook.com) create an app of the *Business* type. You can generate the token in one of two ways:
   - best: *Business Manager → System users* → a token for the app with the permissions
     `pages_show_list, pages_read_engagement, pages_manage_posts, business_management`
     and the page assigned. Such a token does not expire;
   - or: *Graph API Explorer* → a user token with the permissions above, exchanged for a long-lived one.
2. In the bot open **Accounts → Facebook**, paste the token and click **Check and connect**. The panel finds the page itself
   (with many pages it lets you choose) and fetches the page token.
3. Switch the Meta app to **Live** mode (requires a privacy policy URL). In development mode posts may be visible only to the app's roles.

### X source: RSSHub (default)
1. Create a **separate** X account. Do not use your main one, because scraping may end with the account being blocked.
2. Log in with it on x.com in a browser, open *DevTools (F12) → Application → Cookies → https://x.com* and copy the value of `auth_token` to `TWITTER_AUTH_TOKEN` in `.env`. Separate several tokens with commas.
   Then run `sudo docker compose up -d`.
3. Test: *Bot → Sources → Check profiles via RSSHub*.
- **Alternatives**: Apify (token in *Settings*, source *Apify* in the bot) or your own Nitter or RSS-Bridge (*RSS address template* in the bot).

**How to protect accounts from being blocked.**
- **Reader account ≠ publishing account.** Reading X goes through a separate account (the cookie in `.env`), and publishing – through the official X API v2 on the account connected in the bot. If X blocks the reader, the publishing accounts stay untouched. Best create the reader with a separate e-mail and a regular prepaid number; log in to it in a browser from time to time.
- **Spare reader**: enter two tokens separated by a comma right away (`TWITTER_AUTH_TOKEN=token1,token2`) – RSSHub spreads the requests over them.
- **Mark the publishing account as automated**: in X *Settings → Your account → Automation → “Automated by @…”* – X rules require this for bots.
- **Random times**: *Bot → Schedule → Random offset* (up to 15/30/45 min) – every slot starts a random number of minutes later (e.g. 8:00 → 8:17, 12:00 → 12:41), so the bot does not poll X and publish to the minute. The drawn times are shown in the preview and do not change after a restart.
- **Few requests**: every followed profile is one request on every bot run (5 profiles × 4 runs = 20 a day). With many profiles add a second token.
- **Alert about a dead reader**: when 3 runs in a row fetch **no** X profile, the panel sends a Telegram alert (with instructions to replace the token), shows a warning in the bot and a red *X – reader account* tile on the Dashboard. After replacing the token click *Check profiles via RSSHub* – a successful test clears the alert, and the panel confirms “Reading X works again”. You can change the number of runs in `.env`: `POSTER_X_ALERT_AFTER=3`.
- **Proxy for reading X (optional)**: `RSSHUB_PROXY_URI=socks5h://user:password@host:port` (or `http://…`) in `.env`, then `sudo docker compose up -d rsshub`. Only RSSHub, i.e. only reading X, goes through the proxy – publishing and everything else stay on your connection. Choose a proxy with a **fixed IP** (sticky), ideally residential or mobile: X blocks data center addresses most often, and an IP that changes with every request looks suspicious. After the change, check the profiles with the button in the bot.

⚖️ Separating the accounts limits the damage, but it does not change the X terms, which forbid collecting content without consent. Fully “clean” sources are portal RSS feeds, Apify (it collects on its side) or paid reading via the official X API.

---

## How it works under the hood

1. **Schedule / “Run now”.** The panel sends `POST http://n8n:5678/webhook/poster` with the `x-poster-token` header.
   The request body is `{ kind: "generate", runId, config: {…the full bot configuration without secrets…} }`.
   n8n immediately replies with the execution ID, which becomes a link in the panel history.
2. **n8n** runs, in order:
   - fetches the sources;
   - asks the panel for new news (`/internal/bots/<id>/candidates`, the bot's duplicate memory);
   - asks the panel for the text (`/internal/bots/<id>/llm` – the provider chosen in the bot) and for the article photo
     (`/internal/bots/<id>/image`, by the bot's image mode);
   - saves the draft in `data/files`;
   - sends Telegram the image (or just the header when the draft has no image), then the post texts, and finally the script with the buttons (one by one, so the buttons are always under the last message);
   - reports the draft to the panel.
3. **The ✅ click** is received by the panel (long polling `getUpdates`): it replies “⏳ Publishing…” right away and gives n8n a `kind: "publish"` job for this draft with the current bot configuration.
4. **Your own post** (*✍️ New post*): the panel writes the versions for the platforms (AI router, see below), and n8n
   gets `kind: "compose"` with the finished texts. The photo waits in `data/panel/compose` and n8n gets it through
   `/internal/bots/<id>/image`. The *Post własny: przygotuj* node builds the draft (no sources and no AI), then as above:
   Telegram with the buttons or – with “Publish now” – publishing right away.
5. **Publishing**: X → Facebook. Without an image (or in *link* mode) X and Facebook get text with a link. An error on one platform does not block the other. The report goes to Telegram (with a 🔁 button for failed ones) and to the panel history.
6. **Errors**: the workflow is its own *Error Workflow*. It reports the error to the panel, which saves it with the bot and sends a Telegram alert.

### Text and images through the panel (AI router)

The **“AI: wybierz news i napisz posty”** and **“Grafika: panel”** nodes are ordinary *HTTP Request* nodes (`POST`, header
`x-poster-token: {{ $env.PANEL_INTERNAL_TOKEN }}`, JSON body). Only the panel knows the API keys. (n8n node names stay in Polish.)

| Node | URL | Body | Response |
|---|---|---|---|
| AI: wybierz news… | `{{ panelUrl }}/internal/bots/{{ botId }}/llm` | `{ system, user, schema, maxTokens }` (built by *Przygotuj prompt LLM*) | `{ text, provider, model }` – `text` is JSON by the schema |
| Grafika: panel | `{{ panelUrl }}/internal/bots/{{ botId }}/image` | `{ news: { url, title, images }, compose }` (`compose` – the photo of your own post) | `{ source: source\|upload\|none, data (base64), mimeType, width, height, url, warnings }` |

The *Grafika: przygotuj* node turns `data` into a binary file (it goes to `sendPhoto` in Telegram, `media/upload` in X,
`/{page}/photos` in the Graph API) and adds to the Telegram caption where the photo comes from (📷 source / 🚫 none).

---

## Maintenance

| Task | How |
|---|---|
| Updating Poster | `sudo bash scripts/update.sh` (pull, fill in `.env`, rebuild, import the workflow) |
| Changing the schedule, topic, models, platforms | panel → bot. Changes apply from the next run, without restarts |
| Changing the LLM prompt | style: *Bot → General → Additional instructions for AI*; the whole prompt: `workflows/src/code/build_prompt.js` + `python3 workflows/src/build.py` (a change made only in n8n disappears with the next workflow import) |
| Resetting deduplication | panel → bot → *Advanced → Clear memory* |
| Updating n8n | back up, then `N8N_VERSION=…` in `.env` → `sudo docker compose pull && sudo docker compose up -d` |
| Backup | `sudo tar czf poster-backup-$(date +%F).tgz data .env`: `data/` holds the n8n database, the panel settings and keys, and the drafts; `.env` holds the encryption key |
| Viewing drafts | panel → *Drafts*, or the `docker/poster/data/files` folder (SMB) |
| n8n execution history | pruned after 7 days (`EXECUTIONS_DATA_MAX_AGE=168`) |
| Resetting the panel password | `sudo docker compose exec panel node reset-password.js` – logs out all sessions and prints a code to set a new password in the browser (no panel restart) |
| Forgotten n8n password | `sudo docker compose exec n8n n8n user-management:reset`, then right away open `http://NAS_IP:5678` and create the owner account again. The workflow and the execution history stay |

## Troubleshooting

- **Dashboard: “n8n is not responding” / “n8n does not know the “poster” webhook”.** The n8n container is not running or the workflow is not published. Run `sudo docker compose ps` and `sudo bash scripts/import-to-n8n.sh`.
- **“n8n rejected the request – PANEL_INTERNAL_TOKEN…”.** The containers have different tokens: after changing `.env` run `sudo docker compose up -d` (restarts both).
- **No new drafts.** The Dashboard shows the status of every run:
  - *No new news*: the sources have nothing fresh or everything was already used. Check the feeds with the *Test* button.
  - *Skipped*: AI decided that no news fits the topic.
  - *Error*: a description with the node name and a link to the n8n execution.
- **Telegram: “another program receives this bot's messages”.** An old n8n workflow that polls every minute is still running. Import the new one (`scripts/import-to-n8n.sh`) or delete the bot's webhook (`deleteWebhook`).
- **X: “rejected the token refresh”.** The authorization expired or was revoked. Click *Reconnect* in *Accounts*.
- **X: 403 on upload.** The app has *Read only* permissions or the token lacks `media.write`. Fix the settings in the X portal and connect the account again.
- **“Reading X is down” (alert / red tile).** The reader account was logged out or blocked, or the proxy does not work. Replace `TWITTER_AUTH_TOKEN` (see “X source”), run `sudo docker compose up -d rsshub` and click *Check profiles via RSSHub*.
- **Posts without photos, although the articles have them.** The source is Google News (the links do not lead to the article) or the portal blocks downloading. Add the portal's direct RSS feed; the warning is visible in the draft caption in Telegram.
- **SSRF protection (optional).** After enabling `N8N_SSRF_PROTECTION_ENABLED=true` add `N8N_SSRF_ALLOWED_HOSTNAMES=rsshub,panel`, otherwise n8n cannot connect to RSSHub and the panel in the Docker network.
- **Buttons do not react.** Check the Telegram tile on the Dashboard. Clicks are accepted only from the chat in Settings; with an admin list, only from them.
- **“Bot … has no connected X account/Facebook page”.** The platform is on in *Publishing*, but the account is not connected in the bot's *Accounts* tab.
- **FB: `(#200)` or `(#10)` permissions.** The page token lacks the required permissions or the app is not in Live mode.

## License

Copyright © 2026 Daniel Grodowski.

Poster is released under the **GNU Affero General Public License v3.0** (`AGPL-3.0-only`) – the full text is
in the [LICENSE](LICENSE) file. You may use, change and distribute it, also commercially. However, a changed version
that you make available to others – also as a service over a network – must be made available with its source code under the same license.
The panel shows a *Source code* link; if you make a changed version available, put the address of your code in `PROJECT_URL` (`panel/lib/util.js`).

- Do you need Poster in a closed product or service without the AGPL obligations? A separate commercial license
  is possible – write to kontakt@posterapp.pl.
- Poster does not include n8n or RSSHub: `docker compose` pulls their official images, which have their own licenses
  (n8n – Sustainable Use License, RSSHub – MIT).
- How to report bugs and send fixes: [CONTRIBUTING.md](CONTRIBUTING.md).
