# Changelog

🇬🇧 **English** · 🇵🇱 [Polski](CHANGELOG.pl.md)

The newest changes are at the top. You always update the same way: `sudo bash scripts/update.sh`
([README](README.md) → “Updating”). If a version needs anything more, it is described with it.

## Unreleased

## 1.5.2 – 2026-11-13

- **n8n 2.47.5:** the update pulls a new n8n image – version 2.40.7 is covered by the n8n security advisories of
  28 October 2026. With an empty `N8N_VERSION` in `.env` (the default) you do nothing; a deliberately pinned other
  version stays, and `update.sh` reminds you about it. On its first start the new n8n upgrades its database. **Manual
  step – only if you want to be able to go back to an older n8n:** make a backup before updating
  ([README](README.md) → “Maintenance” → Backup), because an older n8n cannot open the upgraded database.
- **“Log out” really ends the session:** the panel remembers the sessions of signed-in browsers, and logging out removes
  the session on its side too – a cookie copied earlier stops working (until now it stayed valid for up to 30 days).
  Other devices stay signed in; “Log out on all devices” works as before. **After this update sign in to the panel
  again** (once on every device).
- **RSSHub without kernel capabilities:** the RSSHub container now runs without kernel capabilities and with a process
  limit, like the panel and n8n.

## 1.5.1 – 2026-11-12

- **Sign-in security:** the limit of failed password attempts (8 from one address, 40 in total per 15 minutes) now also
  holds for attempts sent at the same time – before, a burst of parallel requests got past the limit before the first
  failure was recorded. Passwords are checked one at a time, so such a burst no longer slows the rest of the panel.
- **A hostile page cannot stall the panel:** an article page from a link in a feed (or an address entered in “Check”
  next to a source) with thousands of unclosed tags could stall the whole panel for over a minute – the schedule,
  Telegram clicks and `/healthz`. The panel now reads page tags and feed entries in time proportional to the size of
  the content.
- **An AI provider key stays with its address:** changing a text provider's *API address* to another server removes
  that provider's saved key – enter the key again or send it together with the new address (the panel reminds you).
  Before, the saved key would go to the new address with the first request. Changing only the path on the same server
  removes nothing.
- **Panel resilience:** a read error on a draft file (e.g. a failing disk) no longer ends the panel process, settings
  sent in the wrong shape give a clear error instead of a server error, errors of background tasks go to the logs, and
  `/healthz` no longer reports a stalled schedule while the panel waits for a slow n8n.
- **Small hardening:** the `data/n8n` directory (the n8n database) is accessible only to its owner, like `data/panel` –
  if you copy it from another NAS account, use `sudo`. The panel image no longer contains npm, the panel rejects images
  larger than 120 megapixels before ffmpeg starts decoding them, and API responses carry the `nosniff` header.

## 1.5.0 – 2026-11-09

- **X without the paid API – by hand via a link:** in *Bot → Publishing → X* you choose "Via API (automatic)" or "By
  hand via link (free)". In link mode the draft in Telegram gets a **📝 Open on X** button – X's official link to a new
  post with the text and link ready. You post it yourself, with no credits in the X Developer Console and no connected
  X account. ✅ publishes the other platforms, the X button stays under the draft, the report shows "📝 manual" for X,
  and the link is also in the draft details in the panel. You attach the photo yourself. The default is unchanged – X
  via the API.
- **Facebook: link in the first comment** (option in *Bot → Publishing → Facebook*, off by default): the post goes out
  without the link – with the photo if the draft has one – and the Page immediately adds a comment with the link under
  it. A failed comment does not break publishing: the post is on the Page, and the report shows a warning. Own posts
  use the same bot setting.
  **Manual step – only when you turn this option on:** the Meta token needs the `pages_manage_engagement` and
  `pages_read_user_content` permissions (Meta requires both), and the system user needs the "Community activity" right
  (or full control) on the Page. Generate a new token and
  save it in **Accounts → Facebook** ([README](README.md) → "Meta").
- **Accounts → Facebook shows the token permissions** and the rights on the Page (read when you save the token) and
  what is missing for the link comment. With the option on, the gaps are also a warning on the bot, and the Telegram
  report points to this card.
- **Repeat check before approval:** the panel compares a new draft with the bot's posts from the last 60 days and with
  drafts waiting for a decision – keywords and word pairs, no AI and no cost. When the same story was already in a post
  (e.g. the same news from another site, or told by the AI in other words), the draft in Telegram gets
  "🔁 Similar to the post from …" with a link to the post, and in the panel – a 🔁 badge and a list of similar posts.
  Settings in *Bot → Publishing → Repeat check*: a switch (on by default), a window of 30, 60 or 90 days and the
  sensitivity. At the start the panel fills the post memory with the drafts on disk.
- **Your own photo in a draft:** in Telegram, reply to any message of the draft with your photo (or a JPG, PNG or WebP
  file, up to 20 MB). The bot replaces the draft's image (JPG up to 2048 px) and sends back a preview, and ✅ then
  publishes your photo – also on the platforms that were skipped without a photo. It works before publishing and only
  for people who can click ✅. The draft details in the panel show "📷 Your photo".

## 1.4.1 – 2026-11-03

- **A draft only has texts for the platforms you publish to:** the draft message in Telegram and the draft details in
  the panel have texts only for the platforms enabled in the bot (*Bot → Publishing*), and AI writes only these texts –
  the draft is shorter and the AI request cheaper. Before, a draft always had an X text and a TikTok video script, also
  when the bot published e.g. only to Facebook and Instagram. The TikTok video script and caption are written only when
  TikTok is enabled (PRO edition), and you can still paste the Facebook text on Instagram by hand. Publishing a draft
  skips a platform enabled after the draft was created, with a note in the report – new drafts already have it.

## 1.4.0 – 2026-11-03

- **Panel security:** the panel accepts changes only from its own page. Another app at the NAS address (another port),
  a page open in the browser while you use an SSH tunnel (`localhost`) or a neighbouring subdomain behind a reverse proxy
  can no longer send a request on behalf of the signed-in user – before, the content type check could be bypassed.
  Scripts that write files in `data/panel` as root also no longer follow symbolic links planted there.
- **No double publishing:** a second ✅ click on the same draft (a double tap, two admins in the chat) before the first
  publishing ends no longer sends the post again – Telegram answers “⏳ This draft is being published right now”. The
  same goes for the same own post sent twice at once (e.g. from two tabs): the second request gets the message that the
  post was just sent.
- **A power cut no longer stops the panel:** settings, keys, history and the duplicate memory are written with a forced
  flush to disk, and the panel keeps the previous version of the files (`*.bak` in `data/panel`). The panel moves a
  damaged file (e.g. cut off by a power cut on the NAS) aside as `*.corrupt-<date>` and starts from the previous version
  – before, a damaged `state.json` stopped the panel and all bots. When the settings or keys are damaged and there is no
  copy, the panel does not start with empty settings but names the file to fix in the logs; a damaged password file –
  it asks for a new password with a code from the logs, as after a reset.
- An article address with a quotation mark in an RSS feed no longer breaks the draft message in Telegram.
- **Updates with security fixes:** `update.sh` pulls new n8n and RSSHub images with every update and builds the panel on
  an up-to-date base image (fixes of Node.js, Alpine and ffmpeg) – before, the images stayed in the version from the
  installation day. The update therefore takes longer by the download time; without a connection to Docker Hub it
  finishes on the current images, and `--no-images` skips this step.
- **n8n is updated together with Poster:** `.env` no longer pins the n8n version – the version tested with the workflow
  of the release runs. `update.sh` clears the value `N8N_VERSION=2.40.7` written at installation by itself; another,
  deliberately pinned version stays, with a reminder (if you pinned exactly 2.40.7 on purpose, enter it again).
- **n8n webhook only with the panel token:** n8n accepts jobs only with the panel token (the “Poster: token panelu”
  credential created by `import-to-n8n.sh` – `update.sh` runs it). A foreign request from the network is refused before
  n8n creates an execution. A workflow imported in n8n by hand needs `sudo bash scripts/import-to-n8n.sh`.
- **The script creates the n8n owner account:** `import-to-n8n.sh` (also in `update.sh`) creates the n8n owner account
  when there is none yet and shows the login and password once – with the step-by-step installation nobody on the
  network can take over n8n before you. An existing account stays as it is.
- **The panel gateway lets through only the Poster workflow's requests:** a compromised n8n cannot use the bots' keys
  for anything else, e.g. it cannot take over receiving the Telegram bot's messages or read the Facebook page token.
  Files through the gateway: up to 50 MB (Telegram's upload limit).
- Git in the installation and update scripts runs from a pinned version of the `alpine/git` image (only a new Poster
  release changes it).
- **Photos and pages from feeds only from the internet:** an address from someone else's RSS feed or from an article
  page that leads to the local network (e.g. an image from a camera at home, a router page, Docker services) is skipped
  by the panel with a warning in the draft – also after a redirect and when the name points to a local address only at
  connection time. Outside the bot's feeds the panel downloads only from ports 80 and 443. The hosts of the RSS feeds set
  in the bot (e.g. a blog on the NAS) work as before. The feed test in the panel downloads the address you enter as
  before, but does not follow a redirect to another server on the local network.
- **Drafts chat in a group:** when drafts go to a Telegram group and the *Admin IDs* list (*Settings → Telegram*) is
  empty, the panel shows a warning next to the bot – any member of the group can approve drafts then.
- **AI text checked against the source:** content from feeds reaches AI as data separated from instructions, and a draft
  with a website address, an @account, an e-mail or a phone number that is not in the news or the bot's settings gets
  the note “🔍 Check the text” – e.g. when AI followed an instruction smuggled into someone else's feed. Brand addresses
  and accounts given in *Additional instructions for AI* are not flagged.
- **GitHub's host key known in advance:** the scripts' SSH connection to GitHub (deploy key, upgrade to PRO) accepts only
  the key published by GitHub – before, it trusted the key from the first connection. `update.sh` switches existing
  installations over by itself.
- **Containers with fewer privileges and with limits:** no container can raise its privileges (`no-new-privileges`), the
  panel and n8n run without kernel capabilities, and the panel program is read-only (ffmpeg's work files are in
  memory). The containers have memory limits – `PANEL_MEMORY`, `N8N_MEMORY` and `RSSHUB_MEMORY` in `.env`, 1g, 2g and
  1g by default – and the panel and n8n also a process limit. RSSHub has a healthcheck.
- **The panel does not build without ffmpeg:** when installing ffmpeg fails (e.g. the NAS cannot reach the Alpine
  package server), the update ends with a clear message and the current version keeps running – just run `update.sh`
  again. Before, the panel was built without ffmpeg and silently skipped WebP photos.
- **Graceful panel shutdown:** on an update or a NAS restart the panel gives running tasks (e.g. n8n requests and
  publishing after ✅) up to 25 s to finish and saves its state instead of cutting them off halfway.
- **Status for monitoring:** `http://NAS_IP:7080/healthz` answers without signing in – 200 when n8n, receiving Telegram
  messages and the schedule work, 503 on a problem – e.g. for Uptime Kuma (README → “Maintenance”).
- **Resilience:** saving the bot's settings while an account is being connected no longer loses that connection; ✅ in
  Telegram no longer holds up the next clicks when n8n is slow to accept the job; schedule ticks no longer overlap; a bot
  run with a slow model (e.g. Ollama) ends within the time n8n waits for it; ffmpeg runs in at most 2 processes at once.
- **Sign-in and sessions:** the limit of failed attempts also covers changing the password and also applies to all
  addresses together. Behind a reverse proxy on the local network the client's address (`X-Forwarded-For`) counts, so
  one person's mistakes do not block others. New button *Settings → Panel password → Log out on all devices* (e.g. after
  losing a phone) – the password stays the same.
- **Errors and permissions:** a visitor who is not signed in does not see server error details, and a malformed API
  address gives error 400 instead of a server error. `init-nas.sh` (also run by `update.sh`) leaves `data/panel` to the
  owner only – before, every update gave the group access to the key files until the panel's next write.
- **Encrypted backup:** the README gives a password-encrypted copy of `data/` and `.env` (`openssl`) – it holds the API
  keys and account tokens.
- **Old drafts and disk space:** a new *Settings → Draft files* card. The panel can delete drafts (text, image and video
  in `data/files`) that nothing has changed for a given number of days – it checks every 6 hours and leaves a draft that
  is being published. By default it deletes nothing (0). The card shows the free disk space; when less than 1 GB is
  left, the Dashboard and `/healthz` warn (the `disk` field, response 503). For this the panel can now write to
  `data/files` (before: read-only).
- **A faster panel with many drafts:** the draft list does not read the `data/files` folder on every refresh, and the
  draft cache has a limit, so memory use does not grow with the number of drafts. The panel reads a bot's duplicate
  memory from disk once instead of on every run, and checking the password at sign-in does not hold up other requests.
- **Cleanup:** the panel no longer moves settings from `.env` on its first start (a leftover from the versions before
  publication), and `docker-compose.yml` no longer passes it the old variables such as `GEMINI_API_KEY` or
  `TELEGRAM_BOT_TOKEN` – you set keys only in the panel. If your `.env` from a very old installation still has them, you
  can delete them from it. `import-to-n8n.sh` no longer accepts the old `--publish`, `--only-workflow`,
  `--only-credentials` and `--force-x` options.

## 1.3.0 – 2026-11-02

- **A platform that does not answer:** when a platform (e.g. X or Facebook) accepts a post but does not answer in time
  or the connection drops, the Telegram report no longer shows an error but ⚠️ “not sure if published” and asks you to
  check the profile. 🔁 does not send such a post again (before, it could create a duplicate), and two new buttons mark
  it as published (“✅ It's on the profile”) or send it again (“📤 Not there – send”). In the panel such a post has the
  status “Unknown”. The report also shows API errors more readably – just the description instead of raw JSON.

## 1.2.1 – 2026-10-29

- Product page: the Polish version is at [posterapp.pl](https://posterapp.pl/) and the English one at
  [posterapp.pl/en](https://posterapp.pl/en/). The panel in English, the installer and the English README link straight
  to the English page, and old links (e.g. from panels 1.0–1.2) still lead to the right version.

## 1.2.0 – 2026-10-29

- **Installer on a clean server:** on Ubuntu or Debian without Docker the one-command installer now installs Docker
  Engine and Docker Compose v2 from Docker's official repository itself (usually 1–3 min) and goes on to install
  Poster – before, it stopped with “Docker is missing”. When the system is installing updates at that moment, the
  installer waits for them, and when the server clock is wrong (apt then rejects the package lists – common in a virtual
  machine) it tells you how to set the time. On a NAS you still install Docker from the app center.
- The TikTok video script in the draft of a bot that writes in a language other than Polish has English section names
  (e.g. *DETAILS*, *ON-SCREEN TEXT*) – before, AI copied the Polish “ROZWINIĘCIE” and “NAPISY NA EKRANIE” from the
  template.
- **AI temporarily overloaded:** when the text provider replies that it is overloaded or the request limit is used up
  (e.g. Gemini: HTTP 503 “high demand”, HTTP 429), a bot run retries with growing pauses (16, 32 and 60 s) for about
  2 minutes before sending the Telegram alert – the alert says how long Poster kept trying. The own-post editor still
  shows the error right away.
- *Settings → AI providers*: the *Save and check* button sits under its own provider's fields – in the header it was easy
  to click the next card's button (e.g. *Custom* instead of *Ollama*). After a successful check the badge changes to
  “configured” right away, and the card description and the message point out that you pick the model (e.g.
  `gemma4:12b` in Ollama) in the bot: *Text & images → Model* or *Fallback model*.
- English panel: the Gemini API key hint in *Settings* starts with “From” instead of the Polish “Z”, and quoted titles
  (e.g. in the RSS feed test result) use English quotation marks.

## 1.1.1 – 2026-10-27

- Next to the PRO upgrade command (*Settings*, after checking the license key) the panel reminds you that until the
  license is activated (`upgrade-to-pro.sh`) it can be returned within 14 days of the purchase, and links to the PRO
  license terms on posterapp.pl.

## 1.1.0 – 2026-10-27

- *PRO edition* card: for a key that no longer includes updates, *Renew the license* opens the renewal checkout with
  that key's ending.

## 1.0.1 – 2026-10-24

- The *Copy* button (e.g. next to the PRO upgrade command in *Settings*) also works when the panel is opened via
  `http://nas-address:7080` – it used to end with “Could not copy”. Next to the PRO upgrade command the panel now says
  it can be run from any directory, and `upgrade-to-pro.sh` ends with the update command with its full path.
- The menu shows *Calendar* and *Scheduled* with a PRO badge – they lead to a description of these PRO features with
  a link to the product page.

## 1.0.0 – 2026-10-24

- The first public version of Poster LITE – a free news bot: one bot, RSS, Google News and X profile sources,
  AI text (Gemini, Ollama or an OpenAI-compatible API), draft approval in Telegram, publishing to X and Facebook,
  your own posts adapted by AI, a panel in English and Polish. Installation in one command:
  `curl -fsSL https://posterapp.pl/install.sh | sudo bash` (README → “🚀 Installation in one command”). After buying PRO
  you paste the license key in the panel (*Settings → PRO edition*).
