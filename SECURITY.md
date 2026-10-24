# Security

🇬🇧 **English** · 🇵🇱 [Polski](SECURITY.pl.md)

## Reporting a vulnerability

Do not describe vulnerabilities in public issues. Report them privately – on GitHub:
[imdangro/poster-app → Security → Report a vulnerability](https://github.com/imdangro/poster-app/security/advisories/new),
or by e-mail to kontakt@posterapp.pl.
I will try to reply as soon as possible, and the fix will go into the latest version.

## Supported versions

Security fixes go only into the latest version from the `main` branch (update: `sudo bash scripts/update.sh`).

## How Poster is protected

- **Local network only.** The panel (port 7080) and n8n (5678) run over HTTP. Do not expose them to the internet – from
  outside use a VPN or an SSH tunnel ([README](README.md) → “Remote access and servers on the internet”). On a server
  on the internet set `BIND_ADDRESS=127.0.0.1` in `.env` (the one-command installer does it by itself when the server
  has a public IP address).
- **Keys only in the panel.** API keys and account tokens are stored only in `data/panel/secrets.json` (chmod 600).
  The browser sees only the ending of a key. n8n knows no keys: it calls APIs through the panel gateway, which is
  reachable only in the Docker network (port 7081) and protected by the shared secret `PANEL_INTERNAL_TOKEN`.
- **PRO license.** A license key pasted in the panel waits for `scripts/upgrade-to-pro.sh` in
  `data/panel/license-key.json` (chmod 600, the browser sees only its ending) and is removed after the activation. Only
  the script handles the activation, the NAS's SSH key and the license state (`.git/`, root only) – the panel container
  cannot reach them.
- **Login.** You can set the first password (and a new one after a reset) only with a one-time code from the panel logs.
  The password is hashed (scrypt), the session is a signed cookie (HttpOnly, SameSite=Lax, 30 days; behind a proxy with
  HTTPS also Secure), and the login and the code have limited attempts. A password reset (`reset-password.js`) logs out
  all sessions at once.
- **n8n.** The one-command installer creates the n8n owner account (random password). With a manual installation create
  it right after the first start – until it exists, anyone on the network can do it.
- **Browser.** Requests that change data must have the JSON type (CSRF protection), and the panel sends the
  Content-Security-Policy, X-Frame-Options and X-Content-Type-Options headers.
- **Telegram.** The ✅/❌ buttons work only in the chats set in the panel, and with an admin list – only for the admins.
- **Containers.** The panel and n8n run as a regular user (UID 1000), without root privileges.

## Known limitations

- The panel downloads article pages and photos from the addresses in RSS feeds – also from the local network (e.g. a
  blog on the same NAS). Add only feeds you trust. Downloads have a time and size limit.
- Reading X profiles through RSSHub uses the X account cookie saved in `.env`. Keep `.env` with permissions 600
  (set by `scripts/init-nas.sh`) and use a separate X account.
