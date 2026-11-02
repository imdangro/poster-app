// Zbiera wyniki publikacji (X / Facebook), aktualizuje plik draftu i buduje raport do Telegrama.
const cfg = $('Config').first().json;
const ctx = $('Kontekst publikacji').first().json;
const draft = $('Parsuj draft').first().json;
const { todo, skipped = {}, alreadyPublished, hasImage, xText, xWithImage, fbWithImage, fbLink, ...base } = draft;

const out = (name) => {
  try {
    return $(name).isExecuted ? $(name).first().json : null;
  } catch (e) {
    return null;
  }
};
// n8n zapisuje odpowiedź błędu jako „504 - "{\"error\":{\"message\":\"…\"}}"” – zostawiamy kod i sam opis z JSON-u
const readable = (msg) => {
  const m = /^(\d{3}) - "([\s\S]*)"$/.exec(msg);
  if (!m) return msg;
  try {
    const body = JSON.parse(JSON.parse(`"${m[2]}"`));
    const e = body && body.error;
    const text = (e && typeof e === 'object' ? e.message : e) || body.detail || body.title || body.description || body.message;
    return text && typeof text === 'string' ? `${m[1]} – ${text}` : msg;
  } catch (x) {
    return msg;
  }
};
// Błąd z węzła HTTP (tryb „continue on fail”) bywa zserializowany bez treści – wtedy podajemy wskazówkę.
const err = (j) => {
  if (!j || !('error' in j)) return null;
  const e = j.error;
  if (typeof e === 'string') return e.slice(0, 400);
  const code = e && (e.httpCode || e.status);
  const msg = readable((e && e.message) || '');
  const details = e && [code && !msg.startsWith(String(code)) ? code : null, msg, e.description].filter(Boolean).join(' – ');
  if (details) return details.slice(0, 400);
  const raw = JSON.stringify(e || {});
  return raw === '{}' ? tr('błąd bez szczegółów – sprawdź konto w panelu i zakładkę Executions w n8n') : raw.slice(0, 400);
};
const firstErr = (...names) => {
  for (const n of names) {
    const e = err(out(n));
    if (e) return `${n}: ${e}`;
  }
  return null;
};

// Brak odpowiedzi po wysłaniu (przekroczony czas, zerwane połączenie, 504 z bramki panelu albo platformy): platforma
// mogła przyjąć post – wynik „nie wiadomo” (unknown) zamiast błędu, a 🔁 nie wyśle go drugi raz bez decyzji w Telegramie.
const noAnswer = (j) => {
  const e = j && j.error;
  if (!e) return false;
  if (typeof e !== 'object') return /timeout|timed out|socket hang up/i.test(String(e));
  if (Number(e.httpCode || e.status) === 504) return true;
  if (['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(e.code)) return true;
  return /timeout of \d+ms exceeded|socket hang up|ECONNRESET|ETIMEDOUT/i.test(`${e.message || ''} ${e.description || ''}`);
};

const now = new Date().toISOString();
const results = { ...(draft.results || {}) };
const failure = (error, unknown) => ({ ok: false, error, at: now, ...(unknown ? { unknown: true } : {}) });

if (todo.x) {
  const post = out('X: opublikuj post');
  const id = post?.data?.id;
  const uploadErr = draft.xWithImage ? err(out('X: upload grafiki')) : null;
  results.x = id
    ? { ok: true, id, url: `https://x.com/i/status/${id}`, at: now, ...(uploadErr ? { warning: tr('bez grafiki: {0}', uploadErr) } : {}) }
    : noAnswer(post)
      ? failure(firstErr('X: opublikuj post'), true)
      : failure(firstErr('X: upload grafiki', 'X: opublikuj post') || tr('brak odpowiedzi API'));
}
if (todo.facebook) {
  // zdjęcie z opisem (/photos) albo post z linkiem (/feed)
  const fb = out('Facebook: opublikuj post') || out('Facebook: opublikuj tekst/link');
  const postId = fb && !fb.error ? fb.post_id || fb.id : null;
  results.facebook = postId
    ? { ok: true, id: postId, url: `https://www.facebook.com/${postId}`, at: now, ...(draft.fbWithImage ? {} : { kind: 'link' }) }
    : noAnswer(fb)
      ? failure(firstErr('Facebook: opublikuj post', 'Facebook: opublikuj tekst/link'), true)
      : failure(firstErr('FB: wczytaj grafikę', 'Facebook: opublikuj post', 'Facebook: opublikuj tekst/link') || tr('brak odpowiedzi API'));
}

// „✅ Jest na profilu” w Telegramie: niepewne platformy zapisujemy jako opublikowane (bez linku – sprawdził człowiek)
if (ctx.unknown === 'confirm') {
  for (const [k, r] of Object.entries(results)) {
    if (r && !r.ok && r.unknown) results[k] = { ok: true, confirmed: true, note: tr('potwierdzone ręcznie'), at: now };
  }
}

// własny post: w raporcie tylko platformy wybrane w edytorze
const manual = draft.mode === 'manual';
const chosen = (k) => !Array.isArray(draft.platforms) || draft.platforms.includes(k);
const enabled = {
  x: cfg.enableX && chosen('x'),
  facebook: cfg.enableFacebook && chosen('facebook'),
};
// platformy pominięte z braku grafiki (np. Instagram) nie psują statusu – nie ma czego ponawiać
const active = Object.keys(enabled).filter((k) => enabled[k] && !(skipped[k] && !results[k]?.ok));
const okCount = active.filter((k) => results[k]?.ok).length;
const unsure = active.filter((k) => !results[k]?.ok && results[k]?.unknown);
const status = !active.length
  ? 'approved'
  : okCount === active.length
    ? 'published'
    : okCount
      ? 'partial'
      : unsure.length
        ? 'unknown'
        : 'failed';

// --- Raport HTML ---------------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const label = { x: '🐦 X', facebook: '📘 Facebook' };
const line = (k) => {
  if (!enabled[k]) return `${label[k]}: ${tr('⏭️ wyłączone w panelu')}`;
  const r = results[k];
  if (skipped[k] && !r?.ok) return `${label[k]}: ${tr('⏭️ pominięto – draft bez grafiki')}`;
  if (r?.ok) {
    const what = r.url ? tr('<a href="{0}">zobacz post</a>', esc(r.url)) : esc(r.note || 'OK');
    return `${label[k]}: ✅ ${what}${r.warning ? ` ⚠️ ${esc(r.warning)}` : ''}`;
  }
  if (r?.unknown) return `${label[k]}: ⚠️ ${tr('brak odpowiedzi – post mógł się opublikować ({0})', esc(r.error))}`;
  return `${label[k]}: ❌ ${esc(r?.error || tr('nie wykonano'))}`;
};
const header = {
  published: tr('✅ <b>Opublikowano</b>'),
  partial: tr('⚠️ <b>Opublikowano częściowo</b>'),
  failed: tr('❌ <b>Publikacja nieudana</b>'),
  unknown: tr('⚠️ <b>Nie wiadomo, czy opublikowano</b>'),
  approved: tr('✅ <b>Zatwierdzono</b> (brak platform do publikacji)'),
}[status];

const icon = manual ? '✍️' : '📰';
// kto zatwierdził: osoba w Telegramie albo „Publikuj teraz” w panelu
const who = {
  telegram: `👤 ${esc(ctx.approvedBy)} · ${tr('akceptacja w Telegramie')}`,
  panel: `✍️ ${tr('publikacja z panelu')}`,
}[ctx.via];
const text = [
  `${header} · 🤖 ${esc(cfg.botName)} · <code>${esc(draft.draftId)}</code>`,
  `${icon} ${esc(draft.news?.title || '')}`,
  '',
  ...['x', 'facebook'].filter(chosen).map(line),
  ...(manual ? [] : [tr('   ↳ Instagram i TikTok ręcznie: grafika i teksty powyżej')]),
  ...(unsure.length ? ['', tr('👀 Sprawdź profil: jeśli post tam jest – „✅ Jest na profilu”, jeśli nie – „📤 Nie ma – wyślij”.')] : []),
  who,
].join('\n');

const done = status === 'published' || status === 'approved';
// niepewna publikacja: decyzja po sprawdzeniu profilu (puc – jest, pua – wyślij ponownie); 🔁 – zwykłe błędy
const failedLeft = active.some((k) => !results[k]?.ok && !results[k]?.unknown);
const replyMarkup = done
  ? { inline_keyboard: [[{ text: status === 'published' ? tr('✅ Opublikowano') : tr('✅ Zatwierdzono'), callback_data: 'noop' }]] }
  : {
      inline_keyboard: [
        ...(unsure.length
          ? [
              [
                { text: tr('✅ Jest na profilu'), callback_data: `puc:${draft.draftId}` },
                { text: tr('📤 Nie ma – wyślij'), callback_data: `pua:${draft.draftId}` },
              ],
            ]
          : []),
        [
          ...(failedLeft || !unsure.length ? [{ text: tr('🔁 Ponów nieudane'), callback_data: `pub:${draft.draftId}` }] : []),
          { text: tr('🗑 Porzuć'), callback_data: `rej:${draft.draftId}` },
        ],
      ],
    };

const updated = { ...base, status, results, lastAttemptAt: now, approvedBy: ctx.approvedBy, publishedVia: ctx.via };

return [
  {
    json: {
      draftId: draft.draftId,
      status,
      results,
      panelEvent: { type: 'publish', runId: cfg.runId, botId: cfg.botId, draftId: draft.draftId, status, results },
      reportBody: {
        chat_id: ctx.chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(ctx.messageId ? { reply_parameters: { message_id: ctx.messageId, allow_sending_without_reply: true } } : {}),
      },
      markupBody: { chat_id: ctx.chatId, message_id: ctx.messageId, reply_markup: replyMarkup },
    },
    binary: {
      draft: {
        data: Buffer.from(JSON.stringify(updated, null, 2), 'utf8').toString('base64'),
        mimeType: 'application/json',
        fileName: `${draft.draftId}.json`,
        fileExtension: 'json',
      },
    },
  },
];
