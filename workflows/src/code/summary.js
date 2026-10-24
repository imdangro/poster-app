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
// Błąd z węzła HTTP (tryb „continue on fail”) bywa zserializowany bez treści – wtedy podajemy wskazówkę.
const err = (j) => {
  if (!j || !('error' in j)) return null;
  const e = j.error;
  if (typeof e === 'string') return e.slice(0, 400);
  const code = e && (e.httpCode || e.status);
  const msg = (e && e.message) || '';
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

const now = new Date().toISOString();
const results = { ...(draft.results || {}) };

if (todo.x) {
  const post = out('X: opublikuj post');
  const id = post?.data?.id;
  const uploadErr = draft.xWithImage ? err(out('X: upload grafiki')) : null;
  results.x = id
    ? { ok: true, id, url: `https://x.com/i/status/${id}`, at: now, ...(uploadErr ? { warning: tr('bez grafiki: {0}', uploadErr) } : {}) }
    : { ok: false, error: firstErr('X: upload grafiki', 'X: opublikuj post') || tr('brak odpowiedzi API'), at: now };
}
if (todo.facebook) {
  // zdjęcie z opisem (/photos) albo post z linkiem (/feed)
  const fb = out('Facebook: opublikuj post') || out('Facebook: opublikuj tekst/link');
  const postId = fb && !fb.error ? fb.post_id || fb.id : null;
  results.facebook = postId
    ? { ok: true, id: postId, url: `https://www.facebook.com/${postId}`, at: now, ...(draft.fbWithImage ? {} : { kind: 'link' }) }
    : {
        ok: false,
        error: firstErr('FB: wczytaj grafikę', 'Facebook: opublikuj post', 'Facebook: opublikuj tekst/link') || tr('brak odpowiedzi API'),
        at: now,
      };
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
const status = !active.length ? 'approved' : okCount === active.length ? 'published' : okCount ? 'partial' : 'failed';

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
  return `${label[k]}: ❌ ${esc(r?.error || tr('nie wykonano'))}`;
};
const header = {
  published: tr('✅ <b>Opublikowano</b>'),
  partial: tr('⚠️ <b>Opublikowano częściowo</b>'),
  failed: tr('❌ <b>Publikacja nieudana</b>'),
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
  who,
].join('\n');

const done = status === 'published' || status === 'approved';
const replyMarkup = done
  ? { inline_keyboard: [[{ text: status === 'published' ? tr('✅ Opublikowano') : tr('✅ Zatwierdzono'), callback_data: 'noop' }]] }
  : {
      inline_keyboard: [
        [
          { text: tr('🔁 Ponów nieudane'), callback_data: `pub:${draft.draftId}` },
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
