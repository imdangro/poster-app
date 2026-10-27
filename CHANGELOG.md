# Changelog

🇬🇧 **English** · 🇵🇱 [Polski](CHANGELOG.pl.md)

The newest changes are at the top. You always update the same way: `sudo bash scripts/update.sh`
([README](README.md) → “Updating”). If a version needs anything more, it is described with it.

## Unreleased

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
