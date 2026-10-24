// Wspólne wejście łańcucha publikacji – kliknięcie ✅ w Telegramie (zlecenie z panelu), własny post
// z „Publikuj teraz” w panelu (publikacja od razu po zapisaniu draftu).
const cfg = $('Config').first().json;

if (cfg.mode !== 'publish') {
  const draft = $('Grafika: przygotuj').first().json;
  const last = $('Telegram: wyślij skrypt i przyciski').first().json.result;
  const via = 'panel';
  return [
    {
      json: {
        draftId: draft.draftId,
        chatId: cfg.telegram.chatId,
        messageId: last ? last.message_id : null,
        approvedBy: via,
        via,
      },
    },
  ];
}

const p = cfg.publish;
return [
  {
    json: {
      draftId: p.draftId,
      chatId: p.chatId || cfg.telegram.chatId,
      messageId: p.messageId,
      approvedBy: p.approvedBy,
      via: 'telegram',
    },
  },
];
