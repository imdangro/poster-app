# Contributing to Poster

🇬🇧 **English** · 🇵🇱 [Polski](CONTRIBUTING.pl.md)

Thank you for your interest in the project!

## Reports

- **Bug or idea** → the **Issues** tab. Give the version (panel → *Settings → System information*), what you do,
  what you expect and what happens. Logs help: `sudo docker compose logs --tail=100 panel n8n` –
  remove keys and tokens from them before pasting.
- **Security vulnerability** → report it privately, as described in [SECURITY.md](SECURITY.md).

## Pull requests

Poster is available under the AGPL-3.0 license, and the author may also grant commercial licenses. For your code to get
into both, you need to accept the contributor license agreement before the pull request is merged – [CLA.md](CLA.md)
(in Polish, governed by Polish law). To accept it, write in the pull request description:
“Akceptuję CLA (CLA.md) dla tego i przyszłych wkładów.” (“I accept the CLA (CLA.md) for this and future contributions.”)

Before you send a pull request:
- for bigger changes, describe the idea in Issues first;
- follow the project rules:
  - the panel has no npm dependencies – only modules built into Node.js;
  - every text for the user is written in Polish in `tr('…')`, and the English version goes into the dictionary
    (`panel/public/i18n-en.js`, `panel/lib/i18n-en.js` or `workflows/src/i18n-en.json`) – if you do not speak
    Polish, put the English text in both places and the author will translate it;
  - old settings and drafts must work without migration;
  - `workflows/poster_workflow.json` is generated from `workflows/src/` (`python3 workflows/src/build.py`) – do not
    edit it by hand;
- check your changes:
  ```bash
  node --test panel/test/*.test.js
  for f in $(find panel -name '*.js'); do node --check "$f" || break; done
  npx prettier --check "panel/**/*.{js,css,html}" "workflows/src/**/*.js"
  python3 workflows/src/build.py && git diff --exit-code workflows/poster_workflow.json
  ```
- add your change to [CHANGELOG.md](CHANGELOG.md) → “Unreleased” (and, if you can, to [CHANGELOG.pl.md](CHANGELOG.pl.md)
  → “Niewydane”).
