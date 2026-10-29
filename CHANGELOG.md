# Changelog

🇬🇧 **English** · 🇵🇱 [Polski](CHANGELOG.pl.md)

The newest changes are at the top. You always update the same way: `sudo bash scripts/update.sh`
([README](README.md) → “Updating”). If a version needs anything more, it is described with it.

## Unreleased

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
