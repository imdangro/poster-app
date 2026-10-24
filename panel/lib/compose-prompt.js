'use strict';
// Prompt AI dla własnego posta (✍️ Nowy post): wersje tekstu autora na wybrane platformy. Prompty AI zostają
// po polsku (jak w workflow, build_prompt.js) – AI pisze posty w języku bota (bot.language).

const KNOWN = 'X (Twitter), Facebooka, Instagrama i TikToka';
const LINK_NOTE =
  ' Link system doda sam na X i Facebooku. Na Instagramie i TikToku linki nie są klikalne – możesz napisać, że link jest w bio.';

// Pola odpowiedzi AI dla wybranych platform: [klucz, opis z limitem znaków]
function fieldsFor({ link, platforms }) {
  const has = (k) => platforms.includes(k);
  const fields = [];
  if (has('x'))
    fields.push([
      'post_x',
      `wpis na X, MAKSYMALNIE ${link ? 230 : 260} znaków łącznie ze spacjami, emoji i hashtagami; mocne pierwsze słowa; 1–3 trafne hashtagi na końcu${link ? ' (link system doda sam)' : ''}.`,
    ]);
  if (has('facebook'))
    fields.push([
      'post_facebook',
      'post na Facebooka: hook w pierwszej linii, krótkie akapity, emoji z umiarem, na końcu pytanie albo zachęta do działania i 2–5 hashtagów; długość zbliżona do tekstu autora (maks. 2000 znaków).',
    ]);
  return fields;
}

function promptFor(bot, { text, link, hint, platforms }) {
  const language = bot.language || 'polski';
  const fields = fieldsFor({ link, platforms });
  const instructions = bot.instructions
    ? `\nDODATKOWE WYTYCZNE WŁAŚCICIELA PROFILU (stosuj je, o ile nie łamią zasad powyżej):\n${bot.instructions}\n`
    : '';
  const system = `Jesteś social media managerem profilu "${bot.brandName || bot.name}"${bot.topic ? ` o tematyce: ${bot.topic}` : ''}.
Piszesz w języku: ${language}. Znasz specyfikę ${KNOWN}.

Właściciel profilu napisał własny post (poniżej). Przygotuj jego wersje na wybrane platformy – atrakcyjne, czytelne i dopasowane do stylu każdej z nich.

ZASADY:
- Zachowaj sens, fakty i intencję autora. Nie dodawaj faktów, liczb, dat, cen, cytatów, rabatów ani obietnic, których nie ma w tekście autora.
- Możesz skracać, zmieniać szyk i podział na akapity, dodać mocny początek, emoji i hashtagi pasujące do treści.
- Pisz w języku: ${language}; jeśli autor pisze w innym języku – przetłumacz.
- Nie wstawiaj adresów URL.${link ? LINK_NOTE : ''}
${instructions}${hint ? `\nWSKAZÓWKA AUTORA DO TEGO POSTA (stosuj ją, o ile nie łamie zasad powyżej): ${hint}\n` : ''}
POLA ODPOWIEDZI (czysty JSON zgodny ze schematem):
${fields.map(([k, d]) => `- ${k}: ${d}`).join('\n')}`;
  const user = `POST AUTORA:\n${text}${link ? `\n\nLINK W POŚCIE: ${link}` : ''}`;
  const names = fields.map(([k]) => k);
  const schema = {
    type: 'OBJECT',
    properties: Object.fromEntries(names.map((k) => [k, { type: 'STRING' }])),
    required: names,
    propertyOrdering: names,
  };
  return { system, user, schema, maxTokens: 8192 };
}

module.exports = { promptFor };
