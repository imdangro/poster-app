// Buduje zapytanie do AI z wymuszonym schematem JSON. Panel wysyła je do dostawcy wybranego w bocie
// (Gemini albo API zgodne z OpenAI, np. Ollama). Tu edytujesz ton i zasady postów.
const cfg = $('Config').first().json;

// Wejście: odpowiedź panelu – tylko newsy, których ten bot jeszcze nie widział + jego ostatnie tematy
const res = $input.first().json || {};
const candidates = (res.articles || [])
  .slice()
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  .slice(0, cfg.maxCandidates);
const nothing = 'Brak nowych newsów';
if (!candidates.length) {
  console.log(`${nothing} – kończę bez draftu.`);
  return [];
}

const fmt = (iso) => DateTime.fromISO(iso).setZone($now.zoneName).toFormat('dd.LL HH:mm');

const SCRIPT_FORMAT = `
  🎣 HOOK (0–3 s): ...
  📰 NEWS (3–10 s): ...
  🔎 ROZWINIĘCIE (10–45 s): ...
  📣 CTA (45–60 s): ...
  🎥 B-ROLL: 3–5 punktów z sugestiami ujęć/materiałów
  💬 NAPISY NA EKRANIE: 3–5 krótkich haseł`;

const instructionsBlock = cfg.instructions
  ? `\nDODATKOWE WYTYCZNE WŁAŚCICIELA PROFILU (stosuj je, o ile nie łamią zasad powyżej):\n${cfg.instructions}\n`
  : '';

// ================================================================================ newsy
// Tematy ostatnich draftów – żeby nie powtarzać tej samej historii z innego źródła.
const recentTopics = (res.recentTopics || []).slice(-15);

const newsList = candidates
  .map(
    (a, i) =>
      `[${i}] ${fmt(a.publishedAt)} | ${a.sourceType === 'x' ? 'X/Twitter' : 'RSS'} | ${a.source}\n` +
      `Tytuł: ${a.title}\n` +
      (a.summary && a.summary !== a.title ? `Treść: ${String(a.summary).slice(0, 350)}\n` : ''),
  )
  .join('\n');

const newsFields = [
  ['selected_index', 'numer wybranego newsa z listy [n].'],
  ['news_title', `krótki, rzeczowy tytuł wybranego newsa (po ${cfg.language}).`],
  ['why_selected', '1 zdanie – dlaczego ten news.'],
  [
    'post_x',
    'dynamiczny wpis na X, MAKSYMALNIE 260 znaków łącznie ze spacjami, emoji i hashtagami; mocne pierwsze słowa; 2–3 trafne hashtagi na końcu.',
  ],
  [
    'post_fb_insta',
    'angażujący post na Facebook/Instagram, 600–1500 znaków: hook w pierwszej linii, krótkie akapity, emoji jako punktory, pytanie lub CTA do komentowania, na końcu linia ze źródłem i 5–10 hashtagów (maks. 15).',
  ],
  ['script_tiktok', `skrypt wideo 30–60 s w formacie:${SCRIPT_FORMAT}`],
];
const fields = newsFields;

const system = `Jesteś doświadczonym redaktorem newsowym i social media managerem profilu "${cfg.brandName}" o tematyce: ${cfg.topic}.
Piszesz w języku: ${cfg.language}. Znasz specyfikę X (Twitter), Facebooka, Instagrama i TikToka.

ZASADY:
- Wybierz DOKŁADNIE JEDEN news: najważniejszy i najbardziej angażujący dla odbiorców tematu "${cfg.topic}" (świeżość, waga, wiarygodność, potencjał dyskusji).
- Odrzucaj reklamy, spam, clickbait, wpisy niezwiązane z tematem i tematy z listy "już opublikowane".
- Nie wymyślaj faktów, liczb, cytatów ani dat. Opieraj się wyłącznie na treści newsa. Plotkę/nieoficjalną informację oznacz jako nieoficjalną.
- Nie wstawiaj linków URL do postów. W poście FB/IG podaj nazwę źródła (np. "Źródło: CoinDesk").
- Jeśli żaden news nie nadaje się do publikacji, ustaw skip=true i podaj skip_reason (pozostałe pola mogą być puste).
${instructionsBlock}
POLA ODPOWIEDZI (czysty JSON zgodny ze schematem):
${fields.map(([k, d]) => `- ${k}: ${d}`).join('\n')}`;

const user = `TEMAT PROFILU: ${cfg.topic}

JUŻ OPUBLIKOWANE (nie powtarzaj):
${recentTopics.length ? recentTopics.map((t) => `- ${t}`).join('\n') : '- (brak)'}

NAJŚWIEŻSZE WIADOMOŚCI:
${newsList}`;

const names = ['skip', 'skip_reason', ...fields.map(([k]) => k)];
const schema = {
  type: 'OBJECT',
  properties: Object.fromEntries(
    names.map((k) => [
      k,
      k === 'skip'
        ? { type: 'BOOLEAN', description: 'true, gdy żaden news nie nadaje się do publikacji' }
        : { type: k === 'selected_index' ? 'INTEGER' : 'STRING' },
    ]),
  ),
  required: names.filter((k) => k !== 'skip_reason'),
  propertyOrdering: names,
};

return [{ json: { candidates, llm: { system, user, schema, maxTokens: 8192 } } }];
