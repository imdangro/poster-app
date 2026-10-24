// Po nagłówku (zdjęcie albo wiadomość, gdy draft jest bez grafiki): dwie wiadomości jako odpowiedzi,
// wysyłane PO KOLEI (dwa węzły), żeby przyciski ✅/❌ zawsze były pod ostatnią wiadomością.
const cfg = $('Config').first().json;
const draft = $('Grafika: przygotuj').first().json;
const headMessageId = $input.first().json.result?.message_id;

const body = (m) => ({
  chat_id: cfg.telegram.chatId,
  text: m.text,
  parse_mode: 'HTML',
  link_preview_options: { is_disabled: true },
  ...(headMessageId ? { reply_parameters: { message_id: headMessageId, allow_sending_without_reply: true } } : {}),
  ...(m.reply_markup ? { reply_markup: m.reply_markup } : {}),
});
const [posts, script] = draft.telegram.messages;
return [{ json: { posts: body(posts), script: body(script) } }];
