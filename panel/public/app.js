'use strict';
// Poster – panel sterowania (czysty JavaScript, bez bibliotek i bez CDN).
(() => {
  // ============================================================================================ języki
  // Teksty piszemy po polsku w tr('…'); tłumaczenie angielskie jest w i18n-en.js (klucz = tekst polski),
  // a {0}, {1}… to kolejne argumenty tr(). Język: ustawienie panelu zapamiętane w przeglądarce, a przed
  // pierwszym logowaniem – język przeglądarki. Zmiana języka przeładowuje stronę (teksty stałych liczą się przy starcie).
  const LANGS = { pl: 'Polski', en: 'English' };
  const LANG_KEY = 'poster-lang';
  const readLang = () => {
    try {
      return localStorage.getItem(LANG_KEY);
    } catch (e) {
      return null;
    }
  };
  const browserLang = () => (/^pl\b/i.test(navigator.language || '') ? 'pl' : 'en');
  const LANG = LANGS[readLang()] ? readLang() : browserLang();
  const DICT = (LANG !== 'pl' && window.POSTER_I18N && window.POSTER_I18N[LANG]) || {};
  const LOCALE = LANG === 'pl' ? 'pl-PL' : 'en-GB';
  document.documentElement.lang = LANG;
  function tr(text, ...args) {
    const s = DICT[text] || text;
    return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : String(args[i]))) : s;
  }
  // Zapamiętuje język; jeśli inny niż bieżący – przeładowuje panel (zwraca true)
  function useLang(lang) {
    if (!LANGS[lang]) return false;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {}
    if (lang === LANG) return false;
    location.reload();
    return true;
  }

  // ============================================================================================ narzędzia DOM
  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>',
    bot: '<rect x="4" y="7" width="16" height="12" rx="3.5"/><path d="M12 3.5V7"/><circle cx="12" cy="3" r=".6"/><path d="M9 12.5v1M15 12.5v1"/><path d="M2 12v3M22 12v3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m20 16-4.5-4.5L7 20"/>',
    sliders:
      '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    play: '<path d="M7 4.5v15l12.5-7.5z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    zap: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    send: '<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    rss: '<path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    sparkles:
      '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>',
    shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    duplicate: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  };
  const icon = (name, cls = '') => {
    const t = document.createElement('template');
    t.innerHTML = `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    return t.content.firstChild;
  };

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'readOnly') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const k of [kids].flat(Infinity)) {
      if (k === null || k === undefined || k === false || k === '') continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  const fill = (el, ...kids) => add(clear(el), kids);
  const clear = (el) => {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const getp = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setp = (o, p, v) => {
    const ks = p.split('.');
    const last = ks.pop();
    const t = ks.reduce((a, k) => (a[k] = a[k] && typeof a[k] === 'object' ? a[k] : {}), o);
    t[last] = v;
  };
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  // ============================================================================================ API
  const S = { session: null, overview: null, settings: null, models: null, tz: 'Europe/Warsaw', guard: null, poll: null, info: {} };

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        // język ekranu: błędy z serwera przychodzą w tym samym języku
        headers: { 'x-poster-lang': LANG, ...(body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
        credentials: 'same-origin',
      });
    } catch (e) {
      throw new Error(tr('Brak połączenia z panelem – czy kontener poster-panel działa?'));
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/password')) {
      S.session = { authenticated: false };
      renderAuth();
      // po resecie hasła (reset-password.js) panel czeka na nowe hasło z kodem – pokaż od razu ten formularz
      fetch('/api/session', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((s) => {
          if (s.needsSetup) {
            S.session = s;
            renderAuth();
          }
        })
        .catch(() => {});
      throw new Error(tr('Sesja wygasła – zaloguj się ponownie'));
    }
    if (!res.ok) {
      const err = new Error((data.error && data.error.message) || tr('Błąd HTTP {0}', res.status));
      err.status = res.status;
      err.data = data.error || {};
      throw err;
    }
    return data;
  }

  // Przycisk z animacją ładowania na czas akcji; błędy → toast
  async function busy(btn, fn) {
    const old = btn ? Array.from(btn.childNodes) : null;
    if (btn) {
      btn.disabled = true;
      fill(btn, h('span', { class: 'spinner' }), ...old.filter((n) => n.nodeType === 3));
    }
    try {
      return await fn();
    } catch (e) {
      toast(e.message, 'bad');
      return undefined;
    } finally {
      if (btn) {
        btn.disabled = false;
        fill(btn, ...old);
      }
    }
  }

  // ============================================================================================ motyw, toasty, okna
  function applyTheme() {
    let t = null;
    try {
      t = localStorage.getItem('poster-theme');
    } catch (e) {}
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
  }
  function toggleTheme() {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('poster-theme', t);
    } catch (e) {}
    applyTheme();
    renderSidebar();
  }

  let toastBox = null;
  function toast(msg, type = 'ok', ms = 4500) {
    if (!toastBox || !document.body.contains(toastBox)) toastBox = document.body.appendChild(h('div', { class: 'toasts' }));
    const el = h(
      'div',
      { class: `toast ${type}` },
      icon(type === 'bad' ? 'alert' : type === 'ok' ? 'check' : 'info'),
      h('div', { class: 'grow' }, msg),
    );
    toastBox.append(el);
    setTimeout(() => el.remove(), type === 'bad' ? Math.max(ms, 8000) : ms);
  }

  function modal({ title, sub, body, actions = [], wide = false, onClose }) {
    const close = () => {
      ov.remove();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && close();
    const ov = h(
      'div',
      { class: 'overlay', onmousedown: (e) => e.target === ov && close() },
      h(
        'div',
        { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
        h(
          'div',
          { class: 'card-head' },
          h('div', { class: 'grow' }, h('h2', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
          h('button', { class: 'btn ghost icon sm', onclick: close, title: tr('Zamknij') }, icon('x')),
        ),
        h('div', { class: 'card-body' }, body),
        actions.length ? h('div', { class: 'card-foot' }, actions) : null,
      ),
    );
    document.body.append(ov);
    document.addEventListener('keydown', onKey);
    const first = ov.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
    return { close, el: ov };
  }

  function confirmDialog(text, { title = tr('Na pewno?'), ok = tr('Potwierdź'), danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        m.close();
        resolve(v);
      };
      const m = modal({
        title,
        body: h('p', null, text),
        actions: [
          h('button', { class: 'btn', onclick: () => finish(false) }, tr('Anuluj')),
          h('button', { class: `btn ${danger ? 'danger solid' : 'primary'}`, onclick: () => finish(true) }, ok),
        ],
        onClose: () => finish(false),
      });
    });
  }

  // ============================================================================================ formatowanie
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: S.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const fmtTime = (d) => new Intl.DateTimeFormat(LOCALE, { timeZone: S.tz, hour: '2-digit', minute: '2-digit' }).format(d);
  function fmtWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const k = dayKey(d);
    const t = fmtTime(d);
    if (k === dayKey(now)) return tr('dziś {0}', t);
    if (k === dayKey(new Date(now.getTime() + 86400000))) return tr('jutro {0}', t);
    if (k === dayKey(new Date(now.getTime() - 86400000))) return tr('wczoraj {0}', t);
    return `${new Intl.DateTimeFormat(LOCALE, { timeZone: S.tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d)}, ${t}`;
  }
  function fmtAgo(iso) {
    if (!iso) return '—';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 45) return tr('przed chwilą');
    if (s < 3600) return tr('{0} min temu', Math.round(s / 60));
    if (s < 6 * 3600) return tr('{0} godz. temu', Math.floor(s / 3600));
    return fmtWhen(iso);
  }
  const DAY_NAMES = ['', tr('Pn'), tr('Wt'), tr('Śr'), tr('Cz'), tr('Pt'), tr('So'), tr('Nd')];
  function daysText(days) {
    const d = [...(days || [])].sort().join(',');
    if (d === '1,2,3,4,5,6,7') return tr('codziennie');
    if (d === '1,2,3,4,5') return tr('w dni robocze');
    if (d === '6,7') return tr('w weekendy');
    return (days || []).map((x) => DAY_NAMES[x].toLowerCase()).join(', ');
  }
  const everyLabel = (n) =>
    n === 1 ? tr('co godzinę') : n === 24 ? tr('raz na dobę') : n < 5 ? tr('co {0} godziny', n) : tr('co {0} godzin', n);
  function scheduleText(s, hours) {
    const mm = String(s.minute || 0).padStart(2, '0');
    const list = (hours || []).map((x) => `${x}:${mm}`);
    const jitter = s.jitter ? tr(' · +0–{0} min losowo', s.jitter) : '';
    if (s.mode === 'interval') return `${everyLabel(s.every)} (${list.join(', ')})${jitter} · ${daysText(s.days)}`;
    return `${list.join(', ') || tr('brak godzin')}${jitter} · ${daysText(s.days)}`;
  }
  // wstrzymany bot: harmonogram (albo sprawdzanie kanału YouTube) go nie uruchamia
  function pausedText(b) {
    return tr('Bot jest wstrzymany – harmonogram go nie uruchamia. „Uruchom teraz” działa zawsze.');
  }
  function resumedText(b) {
    return tr('Wznowiono „{0}” – działa wg harmonogramu', b.name);
  }
  // harmonogram na karcie bota; kanał YouTube nie ma harmonogramu – panel sprawdza kanał co kilka minut
  function botScheduleText(b) {
    return scheduleText(b.schedule, b.hours);
  }
  const STATUS = {
    starting: [tr('Uruchamianie'), 'info', true],
    running: [tr('W toku'), 'info', true],
    publishing: [tr('Publikuję'), 'info', true],
    draft: [tr('Czeka na akceptację'), 'warn'],
    published: [tr('Opublikowano'), 'ok'],
    approved: [tr('Zatwierdzono'), 'ok'],
    partial: [tr('Częściowo'), 'warn'],
    failed: [tr('Nieudana'), 'bad'],
    error: [tr('Błąd'), 'bad'],
    timeout: [tr('Brak odpowiedzi'), 'bad'],
    no_news: [tr('Brak nowych newsów'), ''],
    skipped: [tr('Pominięto'), ''],
    rejected: [tr('Odrzucono'), ''],
  };
  function statusBadge(st) {
    const [label, cls, spin] = STATUS[st] || [st || '—', ''];
    return h('span', { class: `badge ${cls}` }, spin ? h('span', { class: 'spinner' }) : null, label);
  }
  const KIND = { generate: tr('Generowanie'), publish: tr('Publikacja'), compose: tr('Własny post') };
  const TRIGGER = {
    schedule: tr('harmonogram'),
    manual: tr('ręcznie'),
    telegram: 'Telegram',
    auto: tr('automatycznie'),
  };
  const ADMIN_HELP = tr('Tylko ci użytkownicy mogą klikać ✅/❌ (ważne w grupach).');
  const PLAT = {
    x: ['X', 'X'],
    facebook: ['f', 'Facebook'],
  };
  // platformy publikacji w tej wersji programu (kolejność jak w workflow)
  const PLATFORMS = Object.keys(PLAT);
  const plat = (k, off, title) => h('span', { class: `plat ${k} ${off ? 'off' : ''}`, title: title || PLAT[k][1] }, PLAT[k][0]);
  const GRADS = [
    ['#6366f1', '#8b5cf6'],
    ['#f97316', '#ef4444'],
    ['#0ea5e9', '#6366f1'],
    ['#10b981', '#0ea5e9'],
    ['#ec4899', '#f97316'],
    ['#8b5cf6', '#ec4899'],
    ['#14b8a6', '#84cc16'],
  ];
  function avatar(bot) {
    let n = 0;
    for (const c of bot.id || 'x') n = (n * 31 + c.charCodeAt(0)) % 997;
    const [a, b] = GRADS[n % GRADS.length];
    const initials = (bot.name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
    return h('div', { class: 'avatar', style: { background: `linear-gradient(135deg, ${a}, ${b})` } }, initials || '?');
  }
  function botStatus(b) {
    if (b.paused) return h('span', { class: 'badge' }, icon('pause'), tr('Wstrzymany'));
    if (b.problems && b.problems.length) return h('span', { class: 'badge warn' }, tr('Wymaga konfiguracji'));
    return h('span', { class: 'badge ok' }, h('span', { class: 'pulse' }), tr('Aktywny'));
  }

  // Konto-czytnik X (RSSHub): stan z ostatnich uruchomień botów
  function xReaderInfo(x) {
    if (x.down) return [false, tr('nie działa od {0} – podmień TWITTER_AUTH_TOKEN', fmtWhen(x.firstFailAt))];
    if (x.fails) return [null, tr('ostatnie uruchomienia bez profili X ({0}/{1} do alertu)', x.fails, x.alertAfter)];
    if (x.lastOkAt) return [true, tr('działa · {0}', fmtAgo(x.lastOkAt))];
    return [null, tr('jeszcze nie sprawdzono – uruchom bota')];
  }
  function xReaderCard(x, healthCard) {
    const [ok, msg] = xReaderInfo(x);
    return healthCard(plat('x', false), tr('X – konto-czytnik (RSSHub)'), ok, msg, x.botId ? `#/bot/${x.botId}/sources` : '#/');
  }

  // ============================================================================================ elementy formularzy
  const field = (label, control, hint, cls = '') =>
    h('div', { class: `field ${cls}` }, label ? h('label', null, label) : null, control, hint ? h('div', { class: 'hint' }, hint) : null);
  function sw(checked, onchange, title, desc) {
    return h(
      'label',
      { class: 'switch' },
      h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }),
      h('span', { class: 'track' }),
      title ? h('span', { class: 'text' }, h('b', null, title), desc ? h('span', null, desc) : null) : null,
    );
  }
  function select(value, options, onchange, attrs = {}) {
    const opts = options.map((o) => (Array.isArray(o) ? o : [o, o]));
    if (value !== undefined && value !== '' && !opts.some(([v]) => String(v) === String(value))) opts.unshift([value, `${value}`]);
    return h(
      'select',
      { ...attrs, onchange: (e) => onchange(e.target.value) },
      opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)),
    );
  }
  function segmented(value, options, onchange) {
    return h(
      'div',
      { class: 'segmented' },
      options.map(([v, l]) => h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => onchange(v) }, l)),
    );
  }
  // Pole sekretu: pokazuje tylko końcówkę zapisanej wartości; puste = bez zmian
  function secretInput(meta, placeholder, onchange) {
    return h('input', {
      type: 'password',
      autocomplete: 'new-password',
      placeholder: meta && meta.set ? tr('zapisany ({0}) – wpisz nowy, aby zmienić', meta.hint) : placeholder,
      oninput: (e) => onchange(e.target.value),
    });
  }
  // Schowek: navigator.clipboard działa tylko w bezpiecznym kontekście (HTTPS albo localhost), a panel w sieci domowej
  // zwykle otwiera się przez http://adres-NAS-a – wtedy kopiujemy starym sposobem, przez ukryte pole tekstowe
  async function copyText(text) {
    if (window.isSecureContext && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {}
    }
    const back = document.activeElement;
    const ta = h('textarea', { readOnly: true, style: { position: 'fixed', top: '0', left: '0', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS zaznacza tylko tak
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {}
    ta.remove();
    if (back && back.focus) back.focus();
    return ok;
  }
  function copyBtn(text) {
    return h(
      'button',
      {
        class: 'btn sm icon',
        type: 'button',
        title: tr('Kopiuj'),
        onclick: async () => {
          if (await copyText(text)) toast(tr('Skopiowano'));
          else toast(tr('Nie udało się skopiować – zaznacz tekst ręcznie'), 'warn');
        },
      },
      icon('copy'),
    );
  }
  function alertBox(type, title, items) {
    return h(
      'div',
      { class: `alert ${type}` },
      icon(type === 'info' ? 'info' : type === 'ok' ? 'check' : 'alert'),
      h(
        'div',
        { class: 'grow' },
        title ? h('b', null, title) : null,
        items && items.length
          ? h(
              'ul',
              null,
              items.map((t) => h('li', null, t)),
            )
          : null,
      ),
    );
  }
  const fmtDate = (iso) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone: S.tz, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
  const card = (head, body, foot, cls = '') =>
    h(
      'section',
      { class: `card ${cls}` },
      head ? h('div', { class: 'card-head' }, head) : null,
      body ? h('div', { class: 'card-body' }, body) : null,
      foot ? h('div', { class: 'card-foot' }, foot) : null,
    );
  const cardHead = (title, sub, ...right) => [
    h('div', { class: 'grow' }, h('h2', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
    ...right,
  ];

  // ============================================================================================ logowanie
  function renderAuth() {
    stopPoll();
    const setup = S.session && S.session.needsSetup;
    let pwd = '';
    let pwd2 = '';
    let code = '';
    const err = h('div', { class: 'res bad small' });
    const submit = async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (setup && pwd !== pwd2) return (err.textContent = tr('Hasła się różnią'));
      const btn = e.target.querySelector('button');
      await busy(btn, async () => {
        await api('POST', setup ? '/api/setup' : '/api/login', setup ? { password: pwd, code, language: LANG } : { password: pwd });
        S.session = { authenticated: true };
        await start();
      }).catch(() => {});
    };
    fill(
      document.getElementById('app'),
      h(
        'div',
        { class: 'auth-wrap' },
        h(
          'div',
          { class: 'card auth' },
          brand(setup ? tr('Pierwsze uruchomienie') : tr('Panel sterowania')),
          h(
            'form',
            { onsubmit: submit },
            // język panelu (zapisze się razem z hasłem); zmiana przeładowuje stronę
            setup
              ? field(
                  tr('Język panelu'),
                  select(LANG, Object.entries(LANGS), (v) => useLang(v)),
                )
              : null,
            setup
              ? alertBox(
                  'info',
                  tr(
                    'Ustaw hasło do panelu. Najpierw przepisz jednorazowy kod z logów panelu: sudo docker compose logs panel | grep -i kod (po resecie hasła kod wypisuje reset-password.js).',
                  ),
                )
              : null,
            setup
              ? field(
                  tr('Kod z logów panelu'),
                  h('input', {
                    type: 'text',
                    autocomplete: 'off',
                    spellcheck: 'false',
                    autocapitalize: 'characters',
                    maxlength: 20,
                    placeholder: 'XXXX-XXXX-XXXX',
                    oninput: (e) => (code = e.target.value),
                    required: true,
                  }),
                )
              : null,
            field(
              tr('Hasło'),
              h('input', {
                type: 'password',
                autocomplete: setup ? 'new-password' : 'current-password',
                oninput: (e) => (pwd = e.target.value),
                required: true,
                minlength: setup ? 8 : undefined,
              }),
            ),
            setup
              ? field(
                  tr('Powtórz hasło'),
                  h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => (pwd2 = e.target.value), required: true }),
                )
              : null,
            err,
            h('button', { class: 'btn primary', type: 'submit' }, setup ? tr('Ustaw hasło i wejdź') : tr('Zaloguj się')),
          ),
          aboutLine(),
        ),
      ),
    );
    const f = document.querySelector('.auth input');
    if (f) f.focus();
  }

  // Wersja i link do kodu źródłowego (AGPL-3.0): ekran logowania i Ustawienia
  function aboutLine() {
    const a = S.about || {};
    if (!a.projectUrl) return null;
    return h(
      'div',
      { class: 'muted small about-line' },
      `${['Poster', (a.edition || '').toUpperCase(), a.version].filter(Boolean).join(' ')} · `,
      h('a', { href: a.projectUrl, target: '_blank', rel: 'noopener' }, tr('Kod źródłowy')),
      ' (AGPL-3.0)',
    );
  }

  // Funkcje wersji PRO: w LITE zamiast nich kafelek z opisem i linkiem do strony produktu (kodu tych funkcji tu nie ma)
  // strona produktu w języku panelu (?lang=en|pl)
  const productUrl = () => (S.about && S.about.productUrl ? `${S.about.productUrl}?lang=${LANG}` : '#');
  const proLink = (label = 'PRO') => h('a', { class: 'badge pro', href: productUrl(), target: '_blank', rel: 'noopener' }, label);
  const proButton = () =>
    h('a', { class: 'btn primary', href: productUrl(), target: '_blank', rel: 'noopener' }, icon('ext'), tr('Poznaj wersję PRO'));
  function proRow(k, short, name, text) {
    return h(
      'div',
      { class: 'plat-row locked' },
      h('span', { class: `plat ${k} off` }, short),
      h('div', { class: 'desc' }, h('b', null, name), h('span', null, text)),
      proLink(),
    );
  }
  function proCard(title, text) {
    return card(cardHead(title, text, proLink()), null, null, 'pro-card');
  }

  function brand(sub) {
    const t = document.createElement('template');
    t.innerHTML =
      '<div class="brand-mark"><svg viewBox="0 0 24 24"><path d="M8 19V5h5a4.5 4.5 0 0 1 0 9H8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
    return h(
      'div',
      { class: 'brand' },
      t.content.firstChild,
      h('div', null, h('b', null, 'Poster'), h('small', null, sub || tr('Automatyzacja social mediów'))),
    );
  }

  // ============================================================================================ szkielet
  let shellEl;
  let sideEl;
  let mainEl;
  function renderShell() {
    sideEl = h('aside', { class: 'sidebar' });
    mainEl = h('main', { class: 'main', id: 'main' });
    const top = h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'btn ghost icon', onclick: () => shellEl.classList.toggle('menu-open') }, icon('menu')),
      brand(),
    );
    shellEl = h(
      'div',
      { class: 'shell', onclick: (e) => e.target === shellEl && shellEl.classList.remove('menu-open') },
      sideEl,
      h('div', { class: 'content' }, top, mainEl),
    );
    fill(document.getElementById('app'), shellEl);
    renderSidebar();
  }

  function renderSidebar() {
    if (!sideEl) return;
    const cur = location.hash || '#/';
    const link = (href, ic, label, extra) =>
      h(
        'a',
        {
          href,
          class: cur === href || (href !== '#/' && cur.startsWith(href + '/')) ? 'active' : '',
          onclick: () => shellEl.classList.remove('menu-open'),
        },
        ic,
        h('span', { class: 'grow ellipsis' }, label),
        extra,
      );
    const bots = (S.overview && S.overview.bots) || [];
    const dark = document.documentElement.dataset.theme === 'dark';
    fill(
      sideEl,
      brand(),
      h(
        'nav',
        { class: 'nav' },
        link('#/', icon('home'), tr('Pulpit')),
        link('#/compose', icon('edit'), tr('Nowy post')),
        link('#/calendar', icon('calendar'), tr('Kalendarz'), h('span', { class: 'badge pro' }, 'PRO')),
        link('#/planned', icon('clock'), tr('Zaplanowane'), h('span', { class: 'badge pro' }, 'PRO')),
        link('#/drafts', icon('image'), tr('Drafty')),
        link('#/settings', icon('sliders'), tr('Ustawienia')),
      ),
      h('div', { class: 'nav-label' }, tr('Boty ({0})', bots.length)),
      h(
        'nav',
        { class: 'nav' },
        bots.map((b) => link(`#/bot/${b.id}`, h('span', { class: `dot ${b.paused ? '' : b.problems.length ? 'warn' : 'on'}` }), b.name)),
        h('a', { href: '#/new', class: 'add' }, icon('plus'), tr('Dodaj bota')),
      ),
      h('div', { class: 'spacer' }),
      h(
        'div',
        { class: 'side-foot' },
        h('a', { href: (S.info && S.info.n8nPublicUrl) || '#', target: '_blank', rel: 'noopener' }, icon('ext'), tr('Otwórz n8n')),
        h('button', { onclick: toggleTheme }, icon(dark ? 'sun' : 'moon'), dark ? tr('Jasny motyw') : tr('Ciemny motyw')),
        h(
          'button',
          {
            onclick: async () => {
              await api('POST', '/api/logout').catch(() => {});
              S.session = { authenticated: false, needsSetup: false };
              sideEl = null;
              renderAuth();
            },
          },
          icon('logout'),
          tr('Wyloguj'),
        ),
      ),
    );
  }

  function pageHead(title, sub, actions) {
    return h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'titles' }, h('h1', null, title), sub ? h('p', null, sub) : null),
      actions ? h('div', { class: 'actions' }, actions) : null,
    );
  }

  function stopPoll() {
    if (S.poll) clearInterval(S.poll);
    S.poll = null;
  }
  function startPoll(fn, ms = 8000) {
    stopPoll();
    S.poll = setInterval(() => {
      if (document.visibilityState === 'visible') fn();
    }, ms);
  }

  async function loadOverview() {
    S.overview = await api('GET', '/api/overview');
    S.info = S.overview.info || S.info;
    S.tz = S.info.timezone || S.tz;
    renderSidebar();
    return S.overview;
  }

  // ============================================================================================ router
  let lastHash = location.hash;
  async function router() {
    if (S.guard && !S.guard()) {
      history.replaceState(null, '', lastHash || '#/');
      return;
    }
    S.guard = null;
    lastHash = location.hash;
    stopPoll();
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    window.scrollTo(0, 0);
    renderSidebar();
    try {
      if (!parts.length) return await pageDashboard();
      if (parts[0] === 'new') return await pageNew();
      if (parts[0] === 'bot' && parts[1]) return await pageBot(parts[1], parts[2] || 'general');
      if (parts[0] === 'compose') return await pageCompose(parts[1]);
      if (parts[0] === 'planned' || parts[0] === 'calendar') return pageProPlanning(parts[0]);
      if (parts[0] === 'drafts') return await pageDrafts(parts[1]);
      if (parts[0] === 'settings') return await pageSettings();
      location.hash = '#/';
    } catch (e) {
      fill(mainEl, pageHead(tr('Ups…')), alertBox('bad', e.message));
    }
  }

  // Kalendarz i zaplanowane posty są w wersji PRO – w LITE pozycje menu prowadzą do opisu z linkiem do strony produktu
  function pageProPlanning(which) {
    const cal = which === 'calendar';
    fill(
      mainEl,
      pageHead(cal ? tr('Kalendarz') : tr('Zaplanowane posty'), tr('Funkcja wersji PRO')),
      h(
        'div',
        { class: 'stack' },
        proCard(
          cal ? tr('Kalendarz treści') : tr('Planowanie postów'),
          cal
            ? tr(
                'Wszystkie posty w jednym kalendarzu: zaplanowane i cykliczne, przebiegi botów i to, co już wyszło – dzień po dniu, z podglądem platform.',
              )
            : tr(
                'Własny post wyjdzie o wybranej godzinie – raz albo cyklicznie (np. co poniedziałek o 9:00), a przed każdym kolejnym wpisem AI napisze nową wersję tekstu.',
              ),
        ),
        h('div', { class: 'row' }, proButton()),
      ),
    );
  }

  // ============================================================================================ PULPIT
  async function pageDashboard() {
    fill(mainEl, h('div', { class: 'boot' }, h('div', { class: 'spinner' })));
    await loadOverview();
    const render = () => {
      const o = S.overview;
      const hl = o.health;
      const healthCard = (badge, title, ok, msg, href, external) =>
        h(
          'a',
          {
            class: 'card',
            href,
            target: external ? '_blank' : undefined,
            rel: external ? 'noopener' : undefined,
            style: { color: 'inherit', textDecoration: 'none' },
          },
          badge,
          // ok: true = działa, false = błąd, null = brak danych / ostrzeżenie
          h(
            'div',
            { class: 'grow' },
            h('b', null, title),
            h('div', { class: `st ${ok === null ? '' : ok ? 'ok' : 'bad'}` }, ok ? '● ' : '○ ', msg),
          ),
        );
      fill(
        mainEl,
        pageHead(tr('Pulpit'), tr('Twoje boty, najbliższe uruchomienia i ostatnie działania'), [
          h('button', { class: 'btn', onclick: () => (location.hash = '#/new') }, icon('plus'), tr('Nowy bot')),
          h('a', { class: 'btn primary', href: '#/compose' }, icon('edit'), tr('Napisz post')),
        ]),
        h(
          'div',
          { class: 'health' },
          healthCard(
            h('span', { class: 'plat', style: { background: '#ea4b71' } }, 'n8n'),
            tr('n8n – silnik workflow'),
            hl.n8n.ok,
            hl.n8n.ok ? tr('działa') : tr('{0} – sprawdź kontener poster-n8n', hl.n8n.message),
            hl.n8n.url || '#',
            true,
          ),
          healthCard(
            h('span', { class: 'plat telegram' }, 'TG'),
            `Telegram${hl.telegram.username ? ` · @${hl.telegram.username}` : ''}`,
            hl.telegram.ok,
            hl.telegram.message,
            '#/settings',
          ),
          healthCard(h('span', { class: 'plat gemini' }, 'G'), 'Google Gemini', hl.gemini.ok, hl.gemini.message, '#/settings'),
          hl.xReader ? xReaderCard(hl.xReader, healthCard) : null,
        ),
        h('div', { class: 'section-title' }, h('h2', null, tr('Boty'))),
        h(
          'div',
          { class: 'grid bots' },
          o.bots.map(botCard),
          o.bots.length
            ? h(
                'a',
                { class: 'add-card', href: productUrl(), target: '_blank', rel: 'noopener' },
                h(
                  'div',
                  null,
                  h('div', { class: 'plus' }, icon('plus')),
                  tr('Więcej botów'),
                  h('div', { class: 'small faint' }, tr('inna tematyka, inne konta')),
                  h('span', { class: 'badge pro' }, 'PRO'),
                ),
              )
            : h(
                'button',
                { class: 'add-card', onclick: () => (location.hash = '#/new') },
                h('div', null, h('div', { class: 'plus' }, icon('plus')), tr('Dodaj bota')),
              ),
        ),
        h(
          'div',
          { class: 'section-title' },
          h('h2', null, tr('Ostatnie działania')),
          h(
            'button',
            { class: 'btn sm', onclick: (e) => busy(e.currentTarget, async () => (await loadOverview(), render())) },
            icon('refresh'),
            tr('Odśwież'),
          ),
        ),
        runsTable(o.runs, true),
      );
    };
    render();
    startPoll(async () => {
      try {
        await loadOverview();
        if (!document.querySelector('.overlay')) render();
      } catch (e) {}
    });
  }

  function botCard(b) {
    const last = b.lastRun;
    const acc = b.accounts || {};
    const accFor = {
      x: acc.x,
      facebook: acc.meta,
    };
    return h(
      'article',
      { class: 'card bot-card' },
      h(
        'div',
        { class: 'top' },
        avatar(b),
        h(
          'div',
          { class: 'grow' },
          h('h3', null, h('a', { href: `#/bot/${b.id}` }, b.name)),
          h('div', { class: 'topic' }, b.topic || tr('Brak tematu – uzupełnij w ustawieniach bota')),
        ),
        botStatus(b),
      ),
      h(
        'div',
        { class: 'meta' },
        h(
          'div',
          { class: 'row' },
          icon('clock'),
          h('span', { class: 'muted' }, tr('Następne:')),
          h('b', null, b.paused ? tr('wstrzymany') : b.nextRun ? fmtWhen(b.nextRun) : '—'),
        ),
        h(
          'div',
          { class: 'row nowrap-row' },
          icon('calendar'),
          h('span', { class: 'muted ellipsis grow', title: botScheduleText(b) }, botScheduleText(b)),
        ),
        h(
          'div',
          { class: 'row' },
          icon('zap'),
          h('span', { class: 'muted' }, tr('Ostatnio:')),
          last
            ? [statusBadge(last.status), h('span', { class: 'faint small' }, fmtAgo(last.startedAt))]
            : h('span', { class: 'faint' }, tr('jeszcze nie działał')),
        ),
      ),
      h(
        'div',
        { class: 'plats' },
        PLATFORMS.map((k) =>
          plat(
            k,
            !b.publishing[k],
            `${PLAT[k][1]}: ${b.publishing[k] ? (accFor[k] ? tr('włączony') : tr('włączony, ale brak konta!')) : tr('wyłączony')}`,
          ),
        ),
        h('span', { class: 'grow' }),
      ),
      h(
        'div',
        { class: 'foot' },
        runButton(b, 'sm'),
        pauseButton(b, 'sm', async () => {
          await loadOverview();
          router();
        }),
        h('span', { class: 'grow' }),
        h('a', { class: 'btn sm icon', href: `#/compose/${b.id}`, title: tr('Napisz post') }, icon('edit')),
        h('a', { class: 'btn sm icon', href: `#/bot/${b.id}`, title: tr('Ustawienia bota') }, icon('sliders')),
      ),
    );
  }

  function runButton(b, size = '') {
    return h(
      'button',
      {
        class: `btn primary ${size}`,
        disabled: b.problems && b.problems.length > 0,
        title:
          b.problems && b.problems.length
            ? tr('Najpierw uzupełnij: {0}', b.problems.join('; '))
            : tr('Wygeneruj draft teraz (poza harmonogramem)'),
        onclick: (e) =>
          busy(e.currentTarget, async () => {
            const r = await api('POST', `/api/bots/${b.id}/run`);
            toast(tr('Bot „{0}” wystartował – draft pojawi się w Telegramie za ok. 1–2 min', b.name));
            if (!location.hash || location.hash === '#/') {
              await loadOverview();
              router();
            }
          }),
      },
      icon('play'),
      tr('Uruchom teraz'),
    );
  }

  function pauseButton(b, size, after) {
    return h(
      'button',
      {
        class: `btn ${size}`,
        onclick: (e) =>
          busy(e.currentTarget, async () => {
            await api('POST', `/api/bots/${b.id}/pause`, { paused: !b.paused });
            toast(b.paused ? resumedText(b) : tr('Wstrzymano „{0}” – harmonogram nie uruchomi bota', b.name));
            if (after) await after();
          }),
      },
      icon(b.paused ? 'play' : 'pause'),
      b.paused ? tr('Wznów') : tr('Wstrzymaj'),
    );
  }

  // Statystyki źródeł w historii uruchomień
  function statsText(st) {
    const errors = st.feedErrors
      ? tr(', błędy źródeł: {0}{1}', st.feedErrors, st.feedErrorNames ? ` (${st.feedErrorNames.join(', ')})` : '')
      : '';
    return tr(
      'Źródła: {0} wpisów{1}, nowych: {2}{3}',
      st.fetched,
      st.recent !== undefined && st.recent !== st.fetched ? tr(' (świeżych {0})', st.recent) : '',
      st.fresh,
      errors,
    );
  }

  function runsTable(runs, showBot) {
    if (!runs.length)
      return card(
        null,
        h(
          'div',
          { class: 'empty' },
          icon('history'),
          h('div', null, tr('Jeszcze nic się nie wydarzyło. Kliknij „Uruchom teraz” przy bocie, żeby wygenerować pierwszy draft.')),
        ),
      );
    return h(
      'div',
      { class: 'card', style: { overflowX: 'auto' } },
      h(
        'table',
        { class: 'list' },
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            h('th', null, tr('Kiedy')),
            showBot ? h('th', null, tr('Bot')) : null,
            h('th', { class: 'hide-sm' }, tr('Rodzaj')),
            h('th', null, tr('Status')),
            h('th', null, tr('Szczegóły')),
            h('th', null, ''),
          ),
        ),
        h(
          'tbody',
          null,
          runs.map((r) =>
            h(
              'tr',
              null,
              h(
                'td',
                { class: 'nowrap' },
                h('div', null, fmtWhen(r.startedAt)),
                h('div', { class: 'faint small' }, TRIGGER[r.trigger] || r.trigger),
              ),
              showBot ? h('td', null, h('a', { href: `#/bot/${r.botId}` }, r.botName)) : null,
              h('td', { class: 'hide-sm' }, KIND[r.kind] || r.kind),
              h('td', { class: 'status' }, statusBadge(r.status)),
              h(
                'td',
                { class: 'details' },
                r.title ? h('div', null, r.title) : null,
                r.message ? h('div', { class: 'msg' }, r.message) : null,
                r.stats ? h('div', { class: 'msg' }, statsText(r.stats)) : null,
              ),
              h(
                'td',
                { class: 'nowrap links' },
                r.draftId
                  ? h('button', { class: 'btn sm ghost', onclick: () => openDraft(r.draftId), title: tr('Pokaż draft') }, icon('image'))
                  : null,
                r.executionUrl
                  ? h(
                      'a',
                      { class: 'btn sm ghost', href: r.executionUrl, target: '_blank', rel: 'noopener', title: tr('Wykonanie w n8n') },
                      icon('ext'),
                    )
                  : null,
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ============================================================================================ NOWY BOT
  async function pageNew() {
    if (!S.overview) await loadOverview();
    const bots = S.overview.bots;
    let name = '';
    history.replaceState(null, '', lastHash && lastHash !== '#/new' ? lastHash : '#/');
    lastHash = location.hash;
    if (!mainEl.firstChild) await pageDashboard();
    if (bots.length) {
      const pm = modal({
        title: tr('Więcej botów w wersji PRO'),
        sub: tr('Wersja LITE ma jednego bota.'),
        body: h(
          'p',
          null,
          tr(
            'W wersji PRO dodasz dowolnie wiele botów – każdy z własnym tematem, źródłami, harmonogramem, kontami i czatem Telegram – i skopiujesz ustawienia istniejącego bota.',
          ),
        ),
        actions: [h('button', { class: 'btn', onclick: () => pm.close() }, tr('Zamknij')), proButton()],
      });
      return;
    }
    const create = async (e) => {
      await busy(e.currentTarget, async () => {
        const { bot } = await api('POST', '/api/bots', { name });
        m.close();
        await loadOverview();
        toast(tr('Utworzono bota „{0}”. Uzupełnij ustawienia i kliknij „Wznów”.', bot.name));
        location.hash = `#/bot/${bot.id}/general`;
      });
    };
    const m = modal({
      title: tr('Nowy bot'),
      sub: tr('Temat, źródła, harmonogram i konta social media ustawisz po utworzeniu bota.'),
      body: h(
        'div',
        { class: 'stack' },
        field(
          tr('Nazwa bota'),
          h('input', {
            type: 'text',
            placeholder: tr('np. Tech News PL'),
            oninput: (e) => (name = e.target.value),
            onkeydown: (e) => e.key === 'Enter' && create({ currentTarget: e.target }),
          }),
        ),
        alertBox('info', tr('Nowy bot startuje jako wstrzymany – harmonogram ruszy dopiero po kliknięciu „Wznów”.')),
      ),
      actions: [
        h('button', { class: 'btn', onclick: () => m.close() }, tr('Anuluj')),
        h('button', { class: 'btn primary', onclick: create }, icon('plus'), tr('Utwórz bota')),
      ],
    });
  }

  // ============================================================================================ EDYTOR BOTA
  // Język postów bota: wartość (po polsku) trafia do promptu AI, na ekranie jest przetłumaczona
  const POST_LANGS = [
    ['polski', tr('polski')],
    ['angielski', tr('angielski')],
    ['niemiecki', tr('niemiecki')],
    ['hiszpański', tr('hiszpański')],
    ['francuski', tr('francuski')],
    ['włoski', tr('włoski')],
    ['ukraiński', tr('ukraiński')],
    ['czeski', tr('czeski')],
  ];
  const postLang = (v) => (POST_LANGS.find(([k]) => k === v) || [v, v])[1];
  const TABS = [
    ['general', tr('Ogólne')],
    ['sources', tr('Źródła')],
    ['schedule', tr('Harmonogram')],
    ['content', tr('Tekst i grafika')],
    ['publishing', tr('Publikacja')],
    ['accounts', tr('Konta')],
    ['history', tr('Historia')],
    ['advanced', tr('Zaawansowane')],
  ];

  async function pageBot(id, tab) {
    if (!TABS.some(([k]) => k === tab)) tab = 'general';
    const keepEditor = S.editor && S.editor.id === id && S.editor.dirty();
    fill(mainEl, h('div', { class: 'boot' }, h('div', { class: 'spinner' })));
    const data = await api('GET', `/api/bots/${id}`);
    if (!S.settings) S.settings = await api('GET', '/api/settings').catch(() => null);
    if (!S.overview) await loadOverview().catch(() => {});
    const ed = keepEditor
      ? S.editor
      : {
          id,
          bot: clone(data.bot),
          orig: JSON.stringify(data.bot),
          dirty() {
            return JSON.stringify(this.bot) !== this.orig;
          },
        };
    ed.data = data;
    S.editor = ed;

    const savebar = h(
      'div',
      { class: 'savebar' },
      icon('info'),
      h('span', null, tr('Masz niezapisane zmiany')),
      h(
        'button',
        {
          class: 'btn ghost sm',
          onclick: () => {
            ed.bot = JSON.parse(ed.orig);
            update();
            renderTab();
          },
        },
        tr('Odrzuć'),
      ),
      h('button', { class: 'btn primary sm', onclick: (e) => save(e.currentTarget) }, icon('check'), tr('Zapisz')),
    );
    const update = () => savebar.classList.toggle('show', ed.dirty());
    ed.set = (path, value, rerender = false) => {
      setp(ed.bot, path, value);
      update();
      if (rerender) renderTab();
    };
    async function save(btn) {
      await busy(btn, async () => {
        const { bot } = await api('PUT', `/api/bots/${id}`, ed.bot);
        ed.bot = clone(bot);
        ed.orig = JSON.stringify(bot);
        ed.data.bot = bot;
        update();
        toast(tr('Zapisano ustawienia bota'));
        await loadOverview().catch(() => {});
        renderHead();
        renderTab();
      });
    }
    S.guard = () =>
      !ed.dirty() || location.hash.startsWith(`#/bot/${id}`) || confirm(tr('Masz niezapisane zmiany. Wyjść bez zapisywania?'));

    const head = h('div');
    const tabsEl = h('nav', { class: 'tabs' });
    const body = h('div', { class: 'stack' });
    function renderHead() {
      const b = ed.data.bot;
      const problems = b.problems || [];
      const warnings = b.warnings || [];
      fill(
        head,
        h(
          'div',
          { class: 'bot-head' },
          avatar(b),
          h(
            'div',
            { class: 'titles' },
            h('h1', null, b.name),
            h(
              'div',
              { class: 'row wrap' },
              botStatus(b),
              b.paused ? null : h('span', { class: 'badge' }, icon('clock'), tr('następne: {0}', b.nextRun ? fmtWhen(b.nextRun) : '—')),
              h('span', { class: 'faint small' }, `ID: ${b.id}`),
            ),
          ),
          h(
            'div',
            { class: 'row wrap' },
            runButton(b),
            pauseButton(b, '', async () => reload()),
          ),
        ),
        problems.length
          ? h('div', { style: { marginBottom: '14px' } }, alertBox('warn', tr('Bot nie wystartuje, dopóki nie uzupełnisz:'), problems))
          : null,
        warnings.length ? h('div', { style: { marginBottom: '14px' } }, alertBox('info', tr('Uwaga:'), warnings)) : null,
        b.paused && !problems.length ? h('div', { style: { marginBottom: '14px' } }, alertBox('info', pausedText(b))) : null,
      );
      fill(
        tabsEl,
        TABS.map(([k, l]) =>
          h(
            'a',
            { href: `#/bot/${id}/${k}`, class: k === tab ? 'active' : '' },
            l,
            k === 'accounts' && warnings.length ? h('span', { class: 'n' }, '!') : null,
          ),
        ),
      );
      // na telefonie pasek zakładek się przewija – aktywna zakładka ma być widoczna
      const act = tabsEl.querySelector('.active');
      if (act) requestAnimationFrame(() => (tabsEl.scrollLeft = Math.max(0, act.offsetLeft - 16)));
    }
    async function reload() {
      const fresh = await api('GET', `/api/bots/${id}`);
      ed.data = fresh;
      if (!ed.dirty()) {
        ed.bot = clone(fresh.bot);
        ed.orig = JSON.stringify(fresh.bot);
      } else {
        // zachowaj edycję, ale zaktualizuj pola zmieniane poza formularzem
        const o = JSON.parse(ed.orig);
        o.paused = ed.bot.paused = fresh.bot.paused;
        o.accounts = ed.bot.accounts = fresh.bot.accounts;
        o.publishing = {
          ...o.publishing,
          x: fresh.bot.publishing.x,
          facebook: fresh.bot.publishing.facebook,
        };
        ed.orig = JSON.stringify(o);
      }
      await loadOverview().catch(() => {});
      renderHead();
      renderTab();
      update();
    }
    ed.reload = reload;

    function renderTab() {
      const fn = {
        general: tabGeneral,
        sources: tabSources,
        schedule: tabSchedule,
        content: tabContent,
        publishing: tabPublishing,
        accounts: tabAccounts,
        history: tabHistory,
        advanced: tabAdvanced,
      }[tab];
      fill(body, fn(ed, renderTab));
    }

    fill(mainEl, head, tabsEl, body, savebar);
    renderHead();
    renderTab();
    update();
    if (tab === 'history') {
      startPoll(async () => {
        try {
          ed.data = await api('GET', `/api/bots/${id}`);
          renderTab();
        } catch (e) {}
      });
    }
  }

  const txt = (ed, path, attrs = {}) =>
    h('input', { type: 'text', value: getp(ed.bot, path) ?? '', oninput: (e) => ed.set(path, e.target.value), ...attrs });
  const area = (ed, path, attrs = {}) =>
    h('textarea', { oninput: (e) => ed.set(path, e.target.value), ...attrs }, getp(ed.bot, path) ?? '');
  const num = (ed, path, min, max) =>
    h('input', {
      type: 'number',
      min,
      max,
      value: getp(ed.bot, path),
      oninput: (e) => ed.set(path, e.target.value === '' ? '' : Number(e.target.value)),
    });

  // ------------------------------------------------------------------ Ogólne
  function tabGeneral(ed) {
    return [
      card(
        cardHead(tr('Podstawowe informacje'), tr('Na tej podstawie AI wybiera newsy i pisze posty.')),
        h(
          'div',
          { class: 'form-grid' },
          field(tr('Nazwa bota'), txt(ed, 'name', { maxlength: 60 }), tr('Widoczna w panelu i w wiadomościach Telegram.')),
          field(
            tr('Nazwa marki / profilu'),
            txt(ed, 'brandName', { maxlength: 80, placeholder: ed.bot.name }),
            tr('Jak AI ma przedstawiać profil (domyślnie nazwa bota).'),
          ),
          field(
            tr('Temat bota'),
            area(ed, 'topic', {
              rows: 3,
              maxlength: 400,
              placeholder: tr('np. Nowe technologie – smartfony, sztuczna inteligencja, premiery i testy sprzętu'),
            }),
            tr('Im konkretniej, tym trafniejszy wybór newsów.'),
            'full',
          ),
          field(
            tr('Język postów'),
            select(ed.bot.language, POST_LANGS, (v) => ed.set('language', v)),
          ),
          h('div'),
          field(
            tr('Dodatkowe wytyczne dla AI (opcjonalnie)'),
            area(ed, 'instructions', {
              rows: 5,
              maxlength: 3000,
              placeholder: tr('np. Pisz rzeczowo i przystępnie, bez żargonu. Na X bez emoji. Nie pisz o polityce. Odbiorcy: 18–35 lat.'),
            }),
            tr('Ton, styl, grupa docelowa, tematy do unikania. Dołączane do każdego zapytania do AI.'),
            'full',
          ),
        ),
      ),
      proCard(
        tr('Własna strona i kanał YouTube'),
        tr('W wersji PRO bot może ogłaszać każdy nowy artykuł z Twojej strony albo każdy nowy film z Twojego kanału YouTube.'),
      ),
    ];
  }

  // ------------------------------------------------------------------ Źródła
  function tabSources(ed, rerender) {
    const s = ed.bot.sources;
    const results = (ed._rss = ed._rss || {});
    const feeds = h(
      'div',
      { class: 'feeds' },
      s.rss.length ? null : h('div', { class: 'muted small' }, tr('Brak kanałów RSS. Dodaj portal albo wyszukiwanie Google News.')),
      s.rss.map((f, i) => {
        const res = results[f.url];
        return [
          h(
            'div',
            { class: 'feed-row' },
            h('input', {
              type: 'text',
              value: f.label,
              placeholder: tr('Nazwa (opcjonalnie)'),
              oninput: (e) => ed.set(`sources.rss.${i}.label`, e.target.value),
            }),
            h('input', {
              type: 'text',
              value: f.url,
              placeholder: 'https://…/rss',
              oninput: (e) => ed.set(`sources.rss.${i}.url`, e.target.value.trim()),
            }),
            h(
              'button',
              {
                class: 'btn',
                title: tr('Sprawdź kanał'),
                onclick: (e) =>
                  busy(e.currentTarget, async () => {
                    const url = ed.bot.sources.rss[i].url;
                    const r = await api('POST', '/api/test/rss', { url });
                    // podano adres strony – panel znalazł jej kanał RSS i podstawia go w miejsce adresu
                    if (r.discovered && ed.bot.sources.rss[i] && ed.bot.sources.rss[i].url === url) {
                      results[r.discovered] = r;
                      ed.set(`sources.rss.${i}.url`, r.discovered);
                    } else results[url] = r;
                    rerender();
                  }),
              },
              icon('rss'),
              tr('Test'),
            ),
            h(
              'button',
              {
                class: 'btn icon danger',
                title: tr('Usuń'),
                onclick: () => {
                  s.rss.splice(i, 1);
                  ed.set('sources.rss', s.rss, true);
                },
              },
              icon('trash'),
            ),
          ),
          res
            ? h(
                'div',
                { class: `res ${res.ok ? 'ok' : 'bad'}` },
                res.ok
                  ? `✓ ${res.message}${res.newest ? tr(' · najnowszy: {0}', fmtWhen(res.newest)) : ''}${res.titles && res.titles[0] ? ` · „${res.titles[0]}”` : ''}`
                  : `✗ ${res.message}`,
              )
            : null,
        ];
      }),
    );
    const addFeed = h(
      'button',
      {
        class: 'btn primary',
        onclick: () => {
          s.rss.push({ label: '', url: '' });
          ed.set('sources.rss', s.rss, true);
          setTimeout(() => {
            const inputs = document.querySelectorAll('.feed-row input');
            if (inputs.length) inputs[inputs.length - 1].focus();
          }, 20);
        },
      },
      icon('plus'),
      tr('Dodaj kanał RSS'),
    );
    const addGoogle = () => {
      let q = '';
      let lang = 'pl';
      const m = modal({
        title: tr('Dodaj wyszukiwanie Google News'),
        sub: tr('Najprostszy sposób na newsy z dowolnego tematu.'),
        body: h(
          'div',
          { class: 'stack' },
          field(
            tr('Czego szukać?'),
            h('input', { type: 'text', placeholder: tr('np. sztuczna inteligencja'), oninput: (e) => (q = e.target.value) }),
            tr('Możesz użyć OR, np. bitcoin OR kryptowaluty.'),
          ),
          field(
            tr('Region / język'),
            select(
              lang,
              [
                ['pl', tr('Polska (po polsku)')],
                ['en', tr('USA (po angielsku)')],
                ['gb', tr('Wielka Brytania')],
                ['de', tr('Niemcy')],
              ],
              (v) => (lang = v),
            ),
          ),
        ),
        actions: [
          h('button', { class: 'btn', onclick: () => m.close() }, tr('Anuluj')),
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                if (!q.trim()) return toast(tr('Wpisz frazę'), 'warn');
                const loc = {
                  pl: ['pl', 'PL', 'PL:pl'],
                  en: ['en-US', 'US', 'US:en'],
                  gb: ['en-GB', 'GB', 'GB:en'],
                  de: ['de', 'DE', 'DE:de'],
                }[lang];
                const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q.trim()).replace(/%20/g, '+')}+when:1d&hl=${loc[0]}&gl=${loc[1]}&ceid=${encodeURIComponent(loc[2])}`;
                s.rss.push({ label: tr('Google News: {0}', q.trim()).slice(0, 60), url });
                ed.set('sources.rss', s.rss, true);
                m.close();
              },
            },
            tr('Dodaj'),
          ),
        ],
      });
    };

    const handles = chipsInput(
      s.xHandles,
      (list) => ed.set('sources.xHandles', list, true),
      tr('Wpisz nazwę profilu (bez @) i Enter'),
      ed._x || {},
    );
    return [
      card(
        cardHead(tr('Kanały RSS'), tr('Portale, blogi, Google News – każdy kanał jest sprawdzany przy każdym uruchomieniu.')),
        h('div', { class: 'stack' }, feeds),
        [h('button', { class: 'btn', onclick: addGoogle }, icon('globe'), tr('Dodaj Google News')), addFeed],
      ),
      card(
        cardHead(tr('Profile X (Twitter)'), tr('Wpisy z wybranych profili traktowane jak newsy.')),
        h(
          'div',
          { class: 'stack' },
          (() => {
            const x = S.overview && S.overview.health && S.overview.health.xReader;
            if (!x || !x.down || s.xSource !== 'rsshub' || s.xRssTemplate) return null;
            return alertBox(
              'bad',
              tr('Odczyt X nie działa od {0} – konto-czytnik jest wylogowane lub zablokowane.', fmtWhen(x.firstFailAt)),
              [
                tr('Zaloguj się na konto-czytnik (albo załóż nowe) i skopiuj ciasteczko auth_token.'),
                tr('Na NAS-ie wpisz je w .env (TWITTER_AUTH_TOKEN=…) i wykonaj: sudo docker compose up -d rsshub'),
                tr('Potem kliknij „Sprawdź profile przez RSSHub” – udany test zdejmie alert.'),
                ...(x.lastError ? [tr('Ostatni błąd: {0}', x.lastError.slice(0, 160))] : []),
              ],
            );
          })(),
          field(
            tr('Sposób pobierania'),
            segmented(
              s.xSource,
              [
                ['rsshub', tr('RSSHub (darmowy)')],
                ['apify', tr('Apify (płatny)')],
                ['none', tr('Wyłączone')],
              ],
              (v) => ed.set('sources.xSource', v, true),
            ),
            s.xSource === 'rsshub'
              ? tr('RSSHub działa na NAS-ie. Wymaga TWITTER_AUTH_TOKEN w pliku .env (osobne konto X).')
              : s.xSource === 'apify'
                ? tr('Apify – płatne kredyty (darmowe 5 USD/mies.). Token wpisz w Ustawieniach.')
                : tr('Profile X nie będą sprawdzane.'),
          ),
          s.xSource !== 'none'
            ? field(
                tr('Profile'),
                handles,
                h(
                  'span',
                  null,
                  tr('Np. '),
                  h('code', null, 'WatcherGuru'),
                  '. ',
                  s.xSource === 'rsshub' && s.xHandles.length
                    ? h(
                        'a',
                        {
                          href: '#',
                          onclick: async (e) => {
                            e.preventDefault();
                            ed._x = {};
                            for (const hd of s.xHandles) {
                              ed._x[hd] = { pending: true };
                              rerender();
                              ed._x[hd] = await api('POST', '/api/test/x-handle', { handle: hd, template: s.xRssTemplate }).catch(
                                (err) => ({ ok: false, message: err.message }),
                              );
                            }
                            rerender();
                          },
                        },
                        tr('Sprawdź profile przez RSSHub'),
                      )
                    : null,
                ),
              )
            : null,
          s.xSource === 'rsshub'
            ? field(
                tr('Szablon adresu RSS (zaawansowane)'),
                txt(ed, 'sources.xRssTemplate', { placeholder: tr('puste = RSSHub z NAS-a; np. http://nitter:8080/{handle}/rss') }),
                tr('Zostaw puste, chyba że używasz Nittera lub RSS-Bridge. {handle} zostanie podmienione.'),
              )
            : null,
          s.xSource === 'apify' ? field(tr('Maks. tweetów na uruchomienie'), num(ed, 'sources.apifyMaxItems', 5, 500)) : null,
        ),
      ),
      card(
        cardHead(tr('Filtrowanie'), tr('Co trafia do AI jako kandydaci na post.')),
        h(
          'div',
          { class: 'form-grid' },
          field(tr('Maks. wiek newsa (godziny)'), num(ed, 'sources.maxAgeHours', 1, 168), tr('Starsze wpisy są pomijane.')),
          field(
            tr('Maks. liczba kandydatów dla AI'),
            num(ed, 'sources.maxCandidates', 3, 60),
            tr('Najświeższe N newsów. Więcej = lepszy wybór, ale droższe zapytanie.'),
          ),
        ),
      ),
    ];
  }

  function chipsInput(list, onchange, placeholder, status = {}) {
    const input = h('input', {
      type: 'text',
      placeholder: list.length ? '' : placeholder,
      onkeydown: (e) => {
        if (['Enter', ',', ' ', 'Tab'].includes(e.key) && e.target.value.trim()) {
          e.preventDefault();
          const vals = e.target.value
            .split(/[\s,]+/)
            .map((v) => v.trim().replace(/^@/, ''))
            .filter(Boolean);
          const next = [...list];
          for (const v of vals) if (!next.some((x) => x.toLowerCase() === v.toLowerCase())) next.push(v);
          onchange(next);
          setTimeout(() => {
            const el = document.querySelector('.chips input');
            if (el) el.focus();
          }, 10);
        } else if (e.key === 'Backspace' && !e.target.value && list.length) {
          onchange(list.slice(0, -1));
        }
      },
      onblur: (e) => {
        const v = e.target.value.trim().replace(/^@/, '');
        if (v && !list.includes(v)) onchange([...list, v]);
      },
    });
    return h(
      'div',
      { class: 'chips', onclick: () => input.focus() },
      list.map((v, i) => {
        const st = status[v];
        return h(
          'span',
          { class: 'chip', title: st && st.message ? st.message : '' },
          st ? h('span', { class: 'st' }, st.pending ? '…' : st.ok ? '✓' : '✗') : null,
          `@${v}`,
          h('button', { type: 'button', onclick: () => onchange(list.filter((_, j) => j !== i)), title: tr('Usuń') }, icon('x')),
        );
      }),
      input,
    );
  }

  // ------------------------------------------------------------------ Harmonogram

  function tabSchedule(ed, rerender) {
    const s = ed.bot.schedule;
    const preview = h('div', { class: 'next-runs' }, h('span', { class: 'spinner sm' }));
    const hoursInfo = h('span', { class: 'muted small' });
    const loadPreview = debounce(async () => {
      try {
        const r = await api('POST', '/api/schedule/preview', { schedule: ed.bot.schedule, botId: ed.id });
        fill(
          preview,
          ed.bot.paused ? h('span', { class: 'muted' }, tr('Bot jest wstrzymany – po wznowieniu:')) : null,
          r.next.map((d) => h('span', { class: 'badge' }, icon('clock'), fmtWhen(d))),
        );
        hoursInfo.textContent = tr('{0}× dziennie', r.hours.length);
        if (s.mode === 'interval') {
          document.querySelectorAll('.hours button').forEach((b) => b.classList.toggle('on', r.hours.includes(Number(b.dataset.h))));
        }
      } catch (e) {
        fill(preview, h('span', { class: 'res bad' }, e.message));
      }
    }, 250);
    const setS = (k, v, re = true) => {
      ed.set(`schedule.${k}`, v, re);
      if (!re) loadPreview();
    };
    const hourOpts = Array.from({ length: 24 }, (_, i) => [i, `${String(i).padStart(2, '0')}:00`]);
    const hoursGrid = h(
      'div',
      { class: 'hours' },
      Array.from({ length: 24 }, (_, hr) =>
        h(
          'button',
          {
            type: 'button',
            'data-h': hr,
            class: s.mode === 'hours' && s.hours.includes(hr) ? 'on' : '',
            disabled: s.mode !== 'hours',
            onclick: () => {
              const set = new Set(s.hours);
              set.has(hr) ? set.delete(hr) : set.add(hr);
              setS(
                'hours',
                [...set].sort((a, b) => a - b),
              );
            },
          },
          String(hr).padStart(2, '0'),
        ),
      ),
    );
    const dayBtns = h(
      'div',
      { class: 'days' },
      [1, 2, 3, 4, 5, 6, 7].map((d) =>
        h(
          'button',
          {
            type: 'button',
            class: s.days.includes(d) ? 'on' : '',
            onclick: () => {
              const set = new Set(s.days);
              set.has(d) ? set.delete(d) : set.add(d);
              setS('days', [...set].sort());
            },
          },
          DAY_NAMES[d],
        ),
      ),
    );
    setTimeout(loadPreview, 0);
    return [
      card(
        cardHead(tr('Stan bota')),
        sw(
          !ed.bot.paused,
          (v) => ed.set('paused', !v, true),
          ed.bot.paused ? tr('Wstrzymany') : tr('Aktywny'),
          ed.bot.paused
            ? tr('Harmonogram nie uruchamia bota. Drafty już wysłane nadal możesz zatwierdzać.')
            : tr('Bot uruchamia się automatycznie według harmonogramu poniżej.'),
        ),
      ),
      card(
        cardHead(
          tr('Jak często bot ma działać?'),
          tr('Każde uruchomienie = wybór newsa, teksty, grafika i draft w Telegramie.'),
          hoursInfo,
        ),
        h(
          'div',
          { class: 'stack' },
          segmented(
            s.mode,
            [
              ['interval', tr('Co kilka godzin')],
              ['hours', tr('O wybranych godzinach')],
            ],
            (v) => {
              if (v === 'hours' && !s.hours.length) ed.bot.schedule.hours = [8, 12, 16, 20];
              setS('mode', v);
            },
          ),
          s.mode === 'interval'
            ? h(
                'div',
                { class: 'form-grid' },
                field(
                  tr('Co ile godzin'),
                  select(
                    s.every,
                    [1, 2, 3, 4, 6, 8, 12, 24].map((n) => [n, everyLabel(n)]),
                    (v) => setS('every', Number(v)),
                  ),
                ),
                h(
                  'div',
                  { class: 'row' },
                  field(
                    tr('Od godziny'),
                    select(s.from, hourOpts, (v) => setS('from', Number(v))),
                    null,
                    'grow',
                  ),
                  field(
                    tr('Do godziny'),
                    select(s.to, hourOpts, (v) => setS('to', Number(v))),
                    null,
                    'grow',
                  ),
                ),
              )
            : null,
          field(s.mode === 'hours' ? tr('Kliknij godziny uruchomienia') : tr('Godziny uruchomień (wyliczone)'), hoursGrid),
          h(
            'div',
            { class: 'form-grid' },
            field(
              tr('Minuta'),
              select(
                s.minute,
                Array.from({ length: 12 }, (_, i) => [i * 5, `:${String(i * 5).padStart(2, '0')}`]),
                (v) => setS('minute', Number(v)),
              ),
              tr('np. :05 zamiast pełnej godziny.'),
            ),
            field(
              tr('Losowe przesunięcie'),
              select(
                s.jitter || 0,
                [
                  [0, tr('brak – dokładnie o czasie')],
                  [15, tr('do 15 min')],
                  [30, tr('do 30 min')],
                  [45, tr('do 45 min')],
                ],
                (v) => setS('jitter', Number(v)),
              ),
              tr(
                'Każdy termin startuje o losową liczbę minut później (np. 8:00 → 8:17, 12:00 → 12:41) – bot nie odpytuje X i nie publikuje co do minuty.',
              ),
            ),
            field(
              tr('Dni tygodnia'),
              h(
                'div',
                { class: 'stack tight' },
                dayBtns,
                h(
                  'div',
                  { class: 'row wrap small' },
                  [
                    [tr('codziennie'), [1, 2, 3, 4, 5, 6, 7]],
                    [tr('dni robocze'), [1, 2, 3, 4, 5]],
                    [tr('weekend'), [6, 7]],
                  ].map(([l, v]) => h('a', { href: '#', onclick: (e) => (e.preventDefault(), setS('days', v)) }, l)),
                ),
              ),
            ),
          ),
        ),
      ),
      card(
        cardHead(
          tr('Najbliższe uruchomienia'),
          tr('Strefa czasowa NAS-a: {0}{1}', S.tz, s.jitter ? tr(' · z losowym przesunięciem do {0} min', s.jitter) : ''),
        ),
        preview,
      ),
    ];
  }

  // ------------------------------------------------------------------ Tekst i grafika
  const IMAGE_MODES = [
    ['source', tr('📷 Zdjęcie z artykułu'), tr('0 zł. Z kanału RSS, strony artykułu (og:image) albo tweeta.')],
    [
      'link',
      tr('🔗 Post z linkiem'),
      tr('0 zł. X i Facebook pokażą podgląd artykułu, a zdjęcie z artykułu przyjdzie z draftem na Telegram.'),
    ],
    ['none', tr('🚫 Bez grafiki'), tr('0 zł. Posty tekstowe z linkiem.')],
  ];
  const TEXT_MODEL_HINTS = {
    gemini: tr('np. gemini-3.8-flash'),
    ollama: tr('np. llama3.1:8b'),
    custom: tr('nazwa modelu u dostawcy'),
  };
  // Ustawienia dostawców tekstu: [id, sekret, strona z kluczami, opis, przykładowy adres]
  const TEXT_PROVIDER_SETUP = [
    [
      'ollama',
      'ollamaKey',
      null,
      tr('Model na Twoim komputerze lub NAS-ie – 0 zł, ale na słabym sprzęcie wolno (panel czeka do 15 min).'),
      tr('np. http://192.168.1.10:11434/v1'),
    ],
    [
      'custom',
      'customKey',
      null,
      tr('Dowolne API zgodne z OpenAI (/chat/completions), np. LM Studio, vLLM, DeepSeek, Together.'),
      'https://…/v1',
    ],
  ];
  function textProviderInfo(id) {
    return ((S.settings && S.settings.options.textProviders) || []).find((p) => p.id === id) || { id, label: id, configured: false };
  }
  // Listy modeli dostawców (pobierane w tle, raz na sesję; „Odśwież” wymusza ponowne pobranie)
  function ensureModels(key, rerender, force) {
    S.modelsBy = S.modelsBy || {};
    S.modelsErr = S.modelsErr || {};
    S.modelsLoading = S.modelsLoading || {};
    if (S.modelsLoading[key] || (!force && (S.modelsBy[key] || S.modelsErr[key]))) return Promise.resolve();
    S.modelsLoading[key] = true;
    return api('GET', `/api/models?provider=${encodeURIComponent(key)}${force ? '&refresh=1' : ''}`)
      .then((r) => {
        S.modelsBy[key] = r.models;
        delete S.modelsErr[key];
      })
      .catch((e) => {
        S.modelsErr[key] = e.message;
      })
      .finally(() => {
        delete S.modelsLoading[key];
        rerender();
      });
  }
  function resetModels() {
    S.modelsBy = {};
    S.modelsErr = {};
  }
  // Pole modelu: wpisywanie ręczne + podpowiedzi z listy dostawcy
  function modelInput(ed, path, key, kind, placeholder) {
    const list = (((S.modelsBy || {})[key] || {})[kind] || []).slice(0, 400);
    const id = `dl-${path.replace(/[^a-z0-9]/gi, '-')}`;
    return h(
      'div',
      null,
      h('input', {
        type: 'text',
        value: getp(ed.bot, path) || '',
        list: id,
        placeholder: placeholder || tr('nazwa modelu'),
        spellcheck: 'false',
        autocomplete: 'off',
        oninput: (e) => ed.set(path, e.target.value.trim()),
      }),
      h(
        'datalist',
        { id },
        list.map((m) => h('option', { value: m.id }, m.name && m.name !== m.id ? m.name : null)),
      ),
    );
  }
  function modelsHint(key, kind, extra) {
    const err = S.modelsErr && S.modelsErr[key];
    const list = S.modelsBy && S.modelsBy[key] && S.modelsBy[key][kind];
    return h(
      'span',
      null,
      err
        ? h('span', { class: 'res bad' }, tr('Lista modeli niedostępna: {0}. Wpisz nazwę ręcznie.', err))
        : list
          ? tr('Modele na liście: {0} (zacznij pisać) – możesz też wpisać nazwę ręcznie.', list.length)
          : S.modelsLoading && S.modelsLoading[key]
            ? tr('Pobieram listę modeli…')
            : tr('Wpisz nazwę modelu.'),
      extra ? [' ', extra] : null,
    );
  }
  function choiceCards(value, options, onpick, cls = '') {
    return h(
      'div',
      { class: `choice ${cls}` },
      options.map(([v, t, d]) =>
        h(
          'button',
          { type: 'button', class: value === v ? 'on' : '', onclick: () => onpick(v) },
          h('span', { class: 'radio' }),
          h('div', null, h('b', null, t), d ? h('span', null, d) : null),
        ),
      ),
    );
  }

  // X: od 2026 r. nowe konta deweloperskie płacą za każdy post (kredyty w X Developer Console), a post z linkiem
  // kosztuje wielokrotnie więcej. Kwoty orientacyjne wg zestawień z 2026 r. – aktualne ceny są w konsoli X.
  const X_PRICE_USD = { post: 0.015, link: 0.2 };
  const usd = (v) => `${v.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} USD`;
  // Post na X zawsze z linkiem: bot-strona, tryb „link” i tryb bez grafiki (jak linkMode w workflow, parse_draft.js)
  const xAlwaysLink = (b) => ['link', 'none'].includes(b.content.imageMode);

  // Koszt posta wg obecnych ustawień bota (orientacyjnie: 0 zł / płatne)
  function costRows(ed) {
    const b = ed.bot;
    const c = b.content;
    const text = {
      gemini: ['ok', tr('zwykle 0 zł'), tr('Klucz z projektu bez billingu = 0 zł (w darmowym limicie Google).')],
      ollama: ['ok', tr('0 zł'), tr('Model działa na Twoim sprzęcie.')],
      custom: ['', tr('wg dostawcy'), tr('Własne API – koszt zależy od dostawcy.')],
    }[c.textProvider || 'gemini'] || ['', tr('wg dostawcy'), ''];
    const image = ['ok', tr('0 zł'), c.imageMode === 'none' ? tr('Bez grafiki.') : tr('Gdy brak zdjęcia – post z linkiem.')];
    const x = !b.publishing.x
      ? ['', tr('wyłączone'), tr('X nie jest włączony w zakładce Publikacja.')]
      : xAlwaysLink(b)
        ? ['warn', tr('ok. {0}', usd(X_PRICE_USD.link)), tr('Post z linkiem – płatne API X liczy go wielokrotnie drożej niż zwykły post.')]
        : [
            '',
            tr('ok. {0}', usd(X_PRICE_USD.post)),
            tr('Post ze zdjęciem, bez linku. Bez grafiki X dostaje post z linkiem (ok. {0}).', usd(X_PRICE_USD.link)),
          ];
    return [
      [tr('Tekst'), text],
      [tr('Grafika'), image],
      [tr('Post na X'), x],
    ];
  }

  function tabContent(ed, rerender) {
    const c = ed.bot.content;
    const st = S.settings;
    const d = (st && st.options.defaults) || {};
    const providers = ((st && st.options.textProviders) || []).map((p) => [
      p.id,
      p.configured ? p.label : tr('{0} – nieskonfigurowany', p.label),
    ]);
    const gemini = (c.textProvider || 'gemini') === 'gemini';
    // lista modeli dostawcy tekstu (tylko skonfigurowanego)
    if (textProviderInfo(c.textProvider || 'gemini').configured) ensureModels(c.textProvider || 'gemini', rerender);
    const refresh = (btn) => busy(btn, () => ensureModels(c.textProvider || 'gemini', rerender, true));
    const setTextProvider = (path, modelPath, v) => {
      setp(ed.bot, path, v);
      ed.set(modelPath, v === 'gemini' ? d.textModel || '' : '', true);
    };
    const notReady = (id) =>
      id && !textProviderInfo(id).configured
        ? h(
            'span',
            { class: 'res bad' },
            tr('Dostawca nie jest skonfigurowany – '),
            h('a', { href: '#/settings' }, tr('Ustawienia → Dostawcy AI')),
            '.',
          )
        : null;
    // zdjęcia z artykułów: przypomnienie o prawach autorskich (tryby „zdjęcie” i „link”)
    const copyright = ['source', 'link'].includes(c.imageMode || 'source')
      ? alertBox(
          'info',
          tr(
            'Zdjęcia z artykułów są chronione prawem autorskim. Publikuj je tylko, jeśli masz na to zgodę (np. własne źródła, agencje z licencją) – w razie wątpliwości wybierz post z linkiem.',
          ),
        )
      : null;

    return [
      card(
        cardHead(tr('Koszt jednego posta'), tr('Orientacyjnie, wg ustawień poniżej. Szczegółowe ceny: cenniki dostawców.')),
        h(
          'div',
          { class: 'cost-rows' },
          costRows(ed).map(([label, [cls, badge, desc]]) =>
            h(
              'div',
              { class: 'cost-row' },
              h('b', null, label),
              h('span', { class: `badge ${cls}` }, badge),
              h('span', { class: 'muted small' }, desc),
            ),
          ),
        ),
      ),
      card(
        cardHead(
          tr('Tekst (AI)'),
          tr('Wybiera newsa i pisze posty na X, FB/IG oraz scenariusz TikToka.'),
          h('button', { class: 'btn sm', onclick: (e) => refresh(e.currentTarget) }, icon('refresh'), tr('Odśwież listy modeli')),
        ),
        h(
          'div',
          { class: 'form-grid' },
          field(
            tr('Dostawca'),
            select(c.textProvider || 'gemini', providers, (v) => setTextProvider('content.textProvider', 'content.textModel', v)),
            notReady(c.textProvider || 'gemini') || tr('Klucze i adresy dostawców: Ustawienia → Dostawcy AI.'),
          ),
          field(
            tr('Model'),
            modelInput(ed, 'content.textModel', c.textProvider || 'gemini', 'text', TEXT_MODEL_HINTS[c.textProvider || 'gemini']),
            modelsHint(c.textProvider || 'gemini', 'text'),
          ),
          field(
            tr('Dostawca zapasowy (gdy główny zawiedzie)'),
            h('div', null, proLink()),
            tr('Gotowe ustawienia Groq, OpenRouter i Mistral oraz dostawca zapasowy są w wersji PRO.'),
          ),
          h('div'),
          gemini
            ? field(
                tr('„Myślenie” modelu Gemini'),
                segmented(
                  c.thinking || 'low',
                  [
                    ['low', tr('Niskie (taniej)')],
                    ['default', tr('Domyślne modelu')],
                  ],
                  (v) => ed.set('content.thinking', v, true),
                ),
                tr('Wybór newsa i pisanie postów nie wymaga długiego „myślenia” – niskie zmniejsza koszt i czas.'),
              )
            : null,
        ),
      ),
      card(
        cardHead(tr('Grafika do posta'), tr('Skąd bot bierze grafikę do posta.')),
        h(
          'div',
          { class: 'stack' },
          choiceCards(c.imageMode || 'source', IMAGE_MODES, (v) => ed.set('content.imageMode', v, true)),
          h('div', { class: 'muted small' }, tr('Gdy artykuł nie ma zdjęcia, X i Facebook dostaną post z linkiem.')),
          copyright,
        ),
      ),
      proCard(
        tr('Grafika marki'),
        tr('Wersja PRO wstawia grafikę marki (np. logo na tle), gdy artykuł nie ma zdjęcia, albo do każdego posta.'),
      ),
      proCard(tr('Wideo na TikTok'), tr('Wersja PRO publikuje na TikToku wideo z grafiki posta (animacja, 0 zł).')),
    ];
  }

  // ------------------------------------------------------------------ Publikacja
  function tabPublishing(ed, rerender) {
    const p = ed.bot.publishing;
    const acc = ed.bot.accounts || {};
    const accInfo = {
      x: acc.x ? tr('konto @{0}', acc.x.username) : null,
      facebook: acc.meta ? tr('strona „{0}”', acc.meta.pageName || acc.meta.pageId) : null,
    };
    const row = (k, extra) =>
      h(
        'div',
        { class: 'plat-row' },
        plat(k, false),
        h(
          'div',
          { class: 'desc' },
          h('b', null, PLAT[k][1]),
          accInfo[k]
            ? h('span', null, `✓ ${accInfo[k]}`)
            : h('span', null, tr('Brak konta – '), h('a', { href: `#/bot/${ed.id}/accounts` }, tr('podłącz w zakładce Konta'))),
          extra,
        ),
        sw(p[k], (v) => ed.set(`publishing.${k}`, v, true)),
      );
    return [
      proCard(
        tr('Publikacja automatyczna'),
        tr('Draft przychodzi na Telegram z przyciskami ✅ Publikuj / ❌ Odrzuć. Publikacja od razu, bez akceptacji, jest w wersji PRO.'),
      ),
      card(
        cardHead(tr('Platformy'), tr('Włącz tylko te z podłączonym kontem. Wyłączone = tylko draft w Telegramie.')),
        h(
          'div',
          null,
          row(
            'x',
            p.x && xAlwaysLink(ed.bot)
              ? h(
                  'div',
                  { class: 'res warn small' },
                  tr(
                    'Ten bot publikuje na X posty z linkiem: ok. {0} za post (płatne API X, ceny w X Developer Console).',
                    usd(X_PRICE_USD.link),
                  ),
                )
              : null,
          ),
          row('facebook'),
          proRow('instagram', 'IG', 'Instagram', tr('Publikacja na Instagramie (konto połączone ze stroną FB) – w wersji PRO.')),
          proRow('threads', '@', 'Threads', tr('Posty na Threads (tekst, zdjęcie, karta linku) – w wersji PRO.')),
          proRow('bluesky', '🦋', 'Bluesky', tr('Posty na Bluesky (tekst, zdjęcie, karta linku) – w wersji PRO.')),
          proRow('telegram', 'TG', tr('Kanał Telegram'), tr('Posty na kanale Telegram (tekst, zdjęcie, link) – w wersji PRO.')),
          proRow('tiktok', 'TT', 'TikTok', tr('Wideo z grafiki posta (animacja) – w wersji PRO.')),
        ),
      ),
    ];
  }

  // ------------------------------------------------------------------ Konta
  function tabAccounts(ed, rerender) {
    const acc = ed.data.bot.accounts || {};
    const tokens = ed.data.tokens || {};
    const st = S.settings || { global: { x: {} }, secrets: {}, info: {} };
    const oauthCard = (platform, title, connected, details, appReady, appHint) => {
      const pasteState = (ed._oauth = ed._oauth || {});
      const flow = pasteState[platform];
      let pasted = '';
      return card(
        [
          plat(platform, false),
          ...cardHead(title, connected ? tr('Połączone') : tr('Niepołączone')),
          connected ? h('span', { class: 'badge ok' }, icon('check'), tr('połączone')) : h('span', { class: 'badge' }, tr('brak')),
        ],
        h(
          'div',
          { class: 'stack' },
          connected ? h('dl', { class: 'kv' }, details) : null,
          !appReady ? alertBox('warn', appHint) : null,
          flow
            ? h(
                'div',
                { class: 'stack tight' },
                alertBox(
                  'info',
                  flow.automatic
                    ? tr('Zaloguj się w nowej karcie i zatwierdź dostęp – panel sam dokończy połączenie. Potem kliknij „Odśwież”.')
                    : tr(
                        'Zaloguj się w nowej karcie i zatwierdź dostęp. Po przekierowaniu (strona może pokazać błąd – to normalne) skopiuj CAŁY adres z paska przeglądarki i wklej poniżej.',
                      ),
                ),
                h(
                  'div',
                  { class: 'input-group' },
                  h('input', {
                    type: 'text',
                    placeholder: `${flow.redirectUri}?code=…&state=…`,
                    oninput: (e) => (pasted = e.target.value),
                  }),
                  h(
                    'button',
                    {
                      class: 'btn primary',
                      onclick: (e) =>
                        busy(e.currentTarget, async () => {
                          await api('POST', '/api/oauth/complete', { url: pasted });
                          delete pasteState[platform];
                          toast(tr('Konto połączone'));
                          await ed.reload();
                        }),
                    },
                    tr('Zakończ'),
                  ),
                ),
                h(
                  'div',
                  { class: 'row small' },
                  h('a', { href: flow.url, target: '_blank', rel: 'noopener' }, tr('Otwórz ponownie stronę logowania')),
                  h('a', { href: '#', onclick: (e) => (e.preventDefault(), ed.reload()) }, tr('Odśwież')),
                ),
              )
            : null,
        ),
        [
          connected
            ? h(
                'button',
                {
                  class: 'btn danger',
                  onclick: async (e) => {
                    if (
                      !(await confirmDialog(
                        tr('Odłączyć konto od bota „{0}”? Publikacja na tej platformie zostanie wyłączona.', ed.bot.name),
                        {
                          danger: true,
                          ok: tr('Odłącz'),
                        },
                      ))
                    )
                      return;
                    await busy(e.currentTarget, async () => {
                      await api('DELETE', `/api/bots/${ed.id}/accounts/${platform}`);
                      toast(tr('Odłączono konto'));
                      await ed.reload();
                    });
                  },
                },
                tr('Odłącz'),
              )
            : null,
          h(
            'button',
            {
              class: 'btn primary',
              disabled: !appReady,
              onclick: (e) =>
                busy(e.currentTarget, async () => {
                  const r = await api('POST', `/api/bots/${ed.id}/accounts/${platform}/start`);
                  pasteState[platform] = r;
                  window.open(r.url, '_blank', 'noopener');
                  rerender();
                }),
            },
            icon('link'),
            connected ? tr('Połącz ponownie') : tr('Połącz konto {0}', title),
          ),
        ],
      );
    };

    const xReady = !!(st.global.x && st.global.x.clientId);
    const tsDate = (ms) => (ms ? fmtWhen(new Date(ms).toISOString()) : '—');

    let metaPage = '';
    let metaToken = '';
    const metaPick = ed._metaPages;
    const connectMeta = (btn) =>
      busy(btn, async () => {
        try {
          await api('POST', `/api/bots/${ed.id}/accounts/meta`, { pageId: metaPage, token: metaToken });
          ed._metaPages = null;
          toast(tr('Połączono stronę Facebook'));
          await ed.reload();
        } catch (e) {
          if (e.status === 409 && e.data.pages) {
            ed._metaPages = { pages: e.data.pages, token: metaToken };
            rerender();
            return;
          }
          throw e;
        }
      });

    return [
      alertBox('info', tr('Klucze kont zapisują się na NAS-ie w panelu – n8n ich nie widzi.')),
      oauthCard(
        'x',
        'X',
        !!acc.x,
        acc.x
          ? [
              h('dt', null, tr('Konto')),
              h('dd', null, `@${acc.x.username} (${acc.x.name || ''})`),
              h('dt', null, tr('Połączono')),
              h('dd', null, fmtWhen(acc.x.connectedAt)),
              h('dt', null, tr('Token')),
              h('dd', null, tokens.x ? tr('odnawiany automatycznie{0}', tokens.x.hasRefresh ? '' : tr(' – BRAK refresh tokenu!')) : '—'),
            ]
          : null,
        xReady,
        tr('Najpierw wpisz Client ID (i Client Secret) aplikacji X w Ustawieniach.'),
      ),
      card(
        [
          plat('facebook', false),
          ...cardHead('Facebook', tr('Strona na Facebooku, na której bot publikuje posty')),
          acc.meta ? h('span', { class: 'badge ok' }, icon('check'), tr('połączone')) : h('span', { class: 'badge' }, tr('brak')),
        ],
        h(
          'div',
          { class: 'stack' },
          acc.meta
            ? h(
                'dl',
                { class: 'kv' },
                h('dt', null, tr('Strona')),
                h('dd', null, `${acc.meta.pageName || '—'} (ID ${acc.meta.pageId})`),
                h('dt', null, tr('Połączono')),
                h('dd', null, fmtWhen(acc.meta.connectedAt)),
              )
            : null,
          metaPick
            ? field(
                tr('Wybierz stronę'),
                select('', [['', tr('— wybierz —')], ...metaPick.pages.map((pg) => [pg.id, `${pg.name} (${pg.id})`])], (v) => {
                  metaPage = v;
                  metaToken = metaPick.token;
                }),
              )
            : h(
                'div',
                { class: 'form-grid' },
                field(
                  tr('Token dostępu'),
                  h('input', {
                    type: 'password',
                    autocomplete: 'off',
                    placeholder: acc.meta ? tr('wklej nowy, aby zmienić') : tr('Page Access Token lub User Access Token'),
                    oninput: (e) => (metaToken = e.target.value),
                  }),
                  tr('Najlepiej długoterminowy token z System User w Business Managerze.'),
                ),
                field(
                  tr('ID strony (opcjonalnie)'),
                  h('input', { type: 'text', placeholder: tr('wykryjemy automatycznie'), oninput: (e) => (metaPage = e.target.value) }),
                  tr('Potrzebne tylko, gdy token ma dostęp do wielu stron.'),
                ),
              ),
          h(
            'ol',
            { class: 'steps' },
            h('li', null, tr('developers.facebook.com → Twoja aplikacja → uprawnienia: pages_manage_posts, pages_read_engagement.')),
            h('li', null, tr('Wygeneruj token (Graph API Explorer lub System User) i wklej powyżej – panel go sprawdzi.')),
          ),
        ),
        [
          acc.meta
            ? h(
                'button',
                {
                  class: 'btn danger',
                  onclick: async (e) => {
                    if (!(await confirmDialog(tr('Odłączyć stronę Facebook od tego bota?'), { danger: true, ok: tr('Odłącz') }))) return;
                    await busy(e.currentTarget, async () => {
                      await api('DELETE', `/api/bots/${ed.id}/accounts/meta`);
                      await ed.reload();
                    });
                  },
                },
                tr('Odłącz'),
              )
            : null,
          metaPick ? h('button', { class: 'btn', onclick: () => ((ed._metaPages = null), rerender()) }, tr('Anuluj')) : null,
          h(
            'button',
            { class: 'btn primary', onclick: (e) => connectMeta(e.currentTarget) },
            icon('check'),
            acc.meta ? tr('Zapisz nowy token') : tr('Sprawdź i połącz'),
          ),
        ],
      ),
      proCard('Instagram', tr('Publikacja na Instagramie (konto połączone ze stroną FB) jest w wersji PRO.')),
      proCard('Threads', tr('Konto Threads i publikacja postów są w wersji PRO.')),
      proCard('Bluesky', tr('Konto Bluesky i publikacja postów są w wersji PRO.')),
      proCard(tr('Kanał Telegram'), tr('Publikacja postów na kanale Telegram jest w wersji PRO.')),
      proCard('TikTok', tr('Konto TikTok i publikacja wideo są w wersji PRO.')),
    ];
  }

  // ------------------------------------------------------------------ Historia
  function tabHistory(ed) {
    const wrap = h(
      'div',
      { class: 'stack' },
      h('div', { class: 'section-title', style: { marginTop: 0 } }, h('h2', null, tr('Uruchomienia'))),
      runsTable(ed.data.runs, false),
    );
    const gallery = h('div', { class: 'drafts' }, h('span', { class: 'spinner' }));
    add(wrap, [
      h(
        'div',
        { class: 'section-title' },
        h('h2', null, tr('Ostatnie drafty')),
        h('a', { class: 'btn sm', href: `#/drafts/${ed.id}` }, tr('Wszystkie')),
      ),
      gallery,
    ]);
    api('GET', `/api/drafts?bot=${ed.id}&limit=8`)
      .then((r) => fill(gallery, r.drafts.length ? r.drafts.map(draftCard) : h('div', { class: 'muted' }, tr('Brak draftów tego bota.'))))
      .catch((e) => fill(gallery, h('div', { class: 'res bad' }, e.message)));
    return wrap;
  }

  // ------------------------------------------------------------------ Zaawansowane
  function tabAdvanced(ed) {
    const d = ed.data;
    return [
      card(
        cardHead(tr('Pamięć duplikatów'), tr('Bot pamięta już widziane newsy, żeby nie proponować ich ponownie.')),
        h(
          'div',
          { class: 'stack' },
          h(
            'div',
            null,
            tr('Zapamiętane newsy: '),
            h('b', null, d.dedupCount),
            tr('. Ostatnie tematy draftów: '),
            h('b', null, d.recentTopics.length),
            '.',
          ),
          d.recentTopics.length
            ? h(
                'ul',
                { class: 'steps' },
                d.recentTopics
                  .slice(-8)
                  .reverse()
                  .map((t) => h('li', null, t)),
              )
            : null,
        ),
        [
          h(
            'button',
            {
              class: 'btn',
              onclick: async (e) => {
                if (
                  !(await confirmDialog(
                    tr('Wyczyścić pamięć? Przy następnym uruchomieniu bot może zaproponować newsy, które już widział.'),
                    { ok: tr('Wyczyść') },
                  ))
                )
                  return;
                await busy(e.currentTarget, async () => {
                  await api('POST', `/api/bots/${ed.id}/dedup-reset`);
                  toast(tr('Wyczyszczono pamięć duplikatów'));
                  await ed.reload();
                });
              },
            },
            icon('refresh'),
            tr('Wyczyść pamięć'),
          ),
        ],
      ),
      card(
        cardHead(tr('Usuń bota'), tr('Usuwa ustawienia, podłączone konta i pamięć duplikatów. Drafty na dysku zostają.')),
        null,
        [
          h(
            'button',
            {
              class: 'btn danger solid',
              onclick: async (e) => {
                if (
                  !(await confirmDialog(tr('Usunąć bota „{0}”? Tego nie da się cofnąć.', ed.bot.name), {
                    title: tr('Usuwanie bota'),
                    danger: true,
                    ok: tr('Usuń bota'),
                  }))
                )
                  return;
                await busy(e.currentTarget, async () => {
                  await api('DELETE', `/api/bots/${ed.id}`);
                  S.guard = null;
                  S.editor = null;
                  toast(tr('Usunięto bota „{0}”', ed.bot.name));
                  await loadOverview();
                  location.hash = '#/';
                });
              },
            },
            icon('trash'),
            tr('Usuń bota'),
          ),
        ],
        'danger-zone',
      ),
    ];
  }

  // ============================================================================================ NOWY POST
  // Własny post: tekst autora → wersje na platformy (AI w panelu albo tekst bez AI) → akceptacja w Telegramie albo
  // „Publikuj teraz”. Stan edytora zostaje w pamięci przy przechodzeniu między stronami panelu.
  const COMPOSE_MAX = 5000;
  const COMPOSE_LIMIT = { x: 280, facebook: 6000 };
  // Długość wg zasad X (jak w panelu i workflow): adres URL = 23 znaki, emoji i znaki CJK = 2
  function xLength(s) {
    let n = 0;
    for (const ch of String(s).replace(/https?:\/\/\S+/g, 'x'.repeat(23))) {
      const cp = ch.codePointAt(0);
      const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
      n += light ? 1 : 2;
    }
    return n;
  }
  const postLength = (k, s) => (k === 'x' ? xLength(s) : String(s).length);
  const composeState = (keep = {}) => ({
    botIds: keep.botIds || [], // wybrane boty (w LITE jeden)
    tab: '', // bot, którego wersje widać (kilka botów – zakładki)
    platforms: keep.platforms || null, // null = wszystkie włączone w wybranych botach
    text: '',
    link: '',
    hint: '',
    image: { source: 'upload', data: '', width: 0, height: 0 }, // data: zdjęcie jako data URL (JPG/PNG)
    // wersje osobno dla każdego bota: { variants: { x: '…', facebook: '…' }, ai: dostawca/model albo null (tekst bez
    // AI), edited, videoTitle }
    out: {},
    stale: false,
    sent: null, // { runs: [id…], failed, publishNow } albo { planned: [post…] } (PRO)
  });
  const COMPOSE_SUB = tr(
    'Napisz post po swojemu – AI dopasuje go do każdej platformy. Opublikujesz go od razu albo po akceptacji w Telegramie.',
  );
  const SEND_HELP = tr(
    '„Wyślij do akceptacji” – draft przyjdzie na Telegram z przyciskami ✅/❌. „Publikuj teraz” – od razu, bez akceptacji.',
  );

  // Zdjęcie z dysku albo z aparatu telefonu: JPG/PNG do 4,5 MB bez zmian, inne formaty i duże pliki → JPG ≤ 2048 px
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(tr('Nie udało się odczytać zdjęcia – zapisz je jako JPG albo PNG')));
      img.src = src;
    });
  }
  function toJpeg(img, crop) {
    const c = crop || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    const scale = Math.min(1, 2048 / Math.max(c.w, c.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(c.w * scale);
    canvas.height = Math.round(c.h * scale);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; // przezroczystość PNG → białe tło
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', 0.9), width: canvas.width, height: canvas.height };
  }
  async function readPhoto(file) {
    if (!/^image\//.test(file.type || '')) throw new Error(tr('To nie jest plik graficzny'));
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (['image/jpeg', 'image/png'].includes(file.type) && file.size <= 4.5 * 1024 * 1024 && Math.max(width, height) <= 4096) {
        const data = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.onerror = () => rej(new Error(tr('Nie udało się odczytać pliku')));
          r.readAsDataURL(file);
        });
        return { data, width, height };
      }
      return toJpeg(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const dataSize = (data) => {
    const kb = (String(data).length * 3) / 4 / 1024;
    return kb < 1000 ? `${Math.round(kb)} KB` : `${(kb / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} MB`;
  };

  async function pageCompose(botId) {
    fill(mainEl, h('div', { class: 'boot' }, h('div', { class: 'spinner' })));
    if (!S.overview) await loadOverview().catch(() => {});
    const { bots } = await api('GET', '/api/compose');
    const head = pageHead(tr('Nowy post'), COMPOSE_SUB);
    if (!bots.length) {
      fill(
        mainEl,
        head,
        card(
          null,
          h(
            'div',
            { class: 'empty' },
            icon('bot'),
            h('div', null, tr('Najpierw dodaj bota – post publikuje bot na swoich kontach.')),
            h('a', { class: 'btn primary', href: '#/new', style: { marginTop: '12px' } }, icon('plus'), tr('Dodaj bota')),
          ),
        ),
      );
      return;
    }
    const st = (S.compose = S.compose || composeState());
    const known = (id) => bots.some((b) => b.id === id);
    st.botIds = st.botIds.filter(known);
    // link z karty bota (#/compose/<bot>) – ten bot, chyba że już jest wśród wybranych
    if (botId && known(botId) && !st.botIds.includes(botId)) st.botIds = [botId];
    if (!st.botIds.length) st.botIds = [bots[0].id];
    for (const id of Object.keys(st.out)) if (!st.botIds.includes(id)) delete st.out[id];
    const chosen = () => bots.filter((b) => st.botIds.includes(b.id));
    const many = () => st.botIds.length > 1;
    const enabledIn = (b) => b.platforms.filter((p) => p.enabled).map((p) => p.id);
    // platformy do wyboru: włączone w którymkolwiek z wybranych botów; bot dostaje tylko swoje
    const offered = () => PLATFORMS.filter((k) => chosen().some((b) => enabledIn(b).includes(k)));
    const platformsOf = (b) => st.platforms.filter((k) => enabledIn(b).includes(k));
    st.platforms = (st.platforms || offered()).filter((k) => offered().includes(k));
    const names = (list) => list.map((k) => PLAT[k][1]).join(', ');
    const wrap = h('div', { class: 'stack' });
    let variantsEl = null;

    // ------------------------------------------------------------------ 1. Twój post
    function formCard() {
      const counter = h('span', { class: 'counter' });
      const staleNote = h(
        'span',
        { class: 'res warn small', hidden: !st.stale },
        tr('Tekst się zmienił – kliknij „Dopasuj” jeszcze raz, żeby odświeżyć wersje.'),
      );
      const count = () => {
        counter.textContent = tr('{0}/{1} znaków', st.text.length, COMPOSE_MAX);
        counter.classList.toggle('bad', st.text.length > COMPOSE_MAX);
      };
      // zmiana treści albo linku po dopasowaniu – wersje mogą być nieaktualne
      const changed = () => {
        count();
        if (Object.keys(st.out).length && !st.stale) {
          st.stale = true;
          staleNote.hidden = false;
        }
      };
      count();
      const list = chosen();
      const noAi = list.filter((b) => b.aiProblems.length);
      const langs = [...new Set(list.map((b) => postLang(b.language)))];
      return card(
        cardHead(
          tr('1. Twój post'),
          many()
            ? tr('Wersje powstaną osobno dla każdego bota, w jego języku: {0}.', langs.join(', '))
            : tr('Wersje powstaną w języku bota: {0}.', langs[0]),
        ),
        h(
          'div',
          { class: 'stack' },
          field(
            tr('Treść'),
            h(
              'textarea',
              {
                rows: 8,
                maxlength: COMPOSE_MAX,
                placeholder: tr('Napisz, co chcesz opublikować – np. ogłoszenie, promocję, zaproszenie na wydarzenie…'),
                oninput: (e) => {
                  st.text = e.target.value;
                  changed();
                },
              },
              st.text,
            ),
            h('div', { class: 'row' }, staleNote, h('span', { class: 'grow' }), counter),
          ),
          field(
            tr('Link (opcjonalnie)'),
            h('input', {
              type: 'url',
              value: st.link,
              placeholder: 'https://',
              oninput: (e) => {
                st.link = e.target.value.trim();
                changed();
              },
            }),
            tr('Na X i Facebooku link trafi na koniec posta (post bez zdjęcia dostanie podgląd strony).'),
          ),
          field(tr('Grafika'), imagePicker()),
          field(
            tr('Platformy'),
            platformChips(),
            offered().length
              ? null
              : many()
                ? tr('Wybrane boty nie mają włączonych platform – włącz je w zakładce Publikacja.')
                : tr('Ten bot nie ma włączonych platform – włącz je w zakładce Publikacja.'),
          ),
          field(
            tr('Wskazówka dla AI (opcjonalnie)'),
            h('input', {
              type: 'text',
              value: st.hint,
              maxlength: 300,
              placeholder: tr('np. luźniej, z humorem, bez emoji'),
              oninput: (e) => (st.hint = e.target.value),
            }),
          ),
          noAi.length
            ? h(
                'div',
                { class: 'res warn small' },
                tr(
                  'AI nie jest gotowe ({0}) – możesz użyć swojego tekstu bez AI. ',
                  noAi.map((b) => (many() ? `${b.name}: ${b.aiProblems.join(', ')}` : b.aiProblems.join('; '))).join('; '),
                ),
                h('a', { href: '#/settings' }, tr('Ustawienia → Dostawcy AI')),
              )
            : null,
        ),
        [
          h('button', { class: 'btn', onclick: (e) => adapt(false, e.currentTarget) }, tr('Bez AI – mój tekst')),
          h(
            'button',
            { class: 'btn primary', disabled: noAi.length > 0, onclick: (e) => adapt(true, e.currentTarget) },
            icon('sparkles'),
            tr('Dopasuj pod platformy'),
          ),
        ],
      );
    }

    function imagePicker() {
      const im = st.image;
      const list = chosen();
      const fileIn = h('input', {
        type: 'file',
        accept: 'image/*',
        class: 'hidden',
        onchange: async (e) => {
          const f = e.target.files[0];
          e.target.value = '';
          if (!f) return;
          try {
            Object.assign(im, await readPhoto(f), { source: 'upload' });
            render();
          } catch (err) {
            toast(err.message, 'bad');
          }
        },
      });
      const photo = () =>
        im.data
          ? h(
              'div',
              { class: 'photo-box' },
              h('img', { src: im.data, alt: tr('Twoje zdjęcie') }),
              h(
                'div',
                { class: 'stack tight' },
                h('span', { class: 'small muted' }, `${im.width}×${im.height} px · ${dataSize(im.data)}`),
                h(
                  'div',
                  { class: 'row wrap' },
                  h('button', { class: 'btn sm', type: 'button', onclick: () => fileIn.click() }, icon('image'), tr('Zmień')),
                  h(
                    'button',
                    {
                      class: 'btn sm ghost',
                      type: 'button',
                      onclick: () => {
                        im.data = '';
                        render();
                      },
                    },
                    icon('trash'),
                    tr('Usuń'),
                  ),
                ),
              ),
              fileIn,
            )
          : h(
              'button',
              { type: 'button', class: 'photo-drop', onclick: () => fileIn.click() },
              icon('image'),
              h('b', null, tr('Dodaj zdjęcie')),
              h('span', null, tr('JPG albo PNG z dysku, a na telefonie – także prosto z aparatu')),
              fileIn,
            );
      const kinds = {
        upload: [tr('📷 Zdjęcie'), photo],
        none: [
          tr('Bez grafiki'),
          () => h('div', { class: 'small muted' }, st.link ? tr('X i Facebook pokażą podgląd linku.') : tr('Post z samym tekstem.')),
        ],
      };
      return h(
        'div',
        { class: 'stack tight' },
        segmented(
          im.source,
          Object.entries(kinds).map(([k, [label]]) => [k, label]),
          (v) => {
            im.source = v;
            render();
          },
        ),
        kinds[im.source][1](),
        h('div', { class: 'row small muted' }, tr('Grafika marki'), proLink()),
      );
    }

    function platformChips() {
      const list = chosen();
      const toggle = (k) => {
        st.platforms = st.platforms.includes(k)
          ? st.platforms.filter((x) => x !== k)
          : PLATFORMS.filter((x) => x === k || st.platforms.includes(x));
        render();
      };
      return h(
        'div',
        { class: 'pchips' },
        PLATFORMS.map((k) => {
          const inBots = list.filter((b) => enabledIn(b).includes(k));
          if (!inBots.length)
            return h(
              'a',
              {
                class: 'pchip off',
                href: `#/bot/${list[0].id}/publishing`,
                title: tr('Wyłączona w ustawieniach bota – włączysz ją w zakładce Publikacja'),
              },
              plat(k, true),
              PLAT[k][1],
              h('small', null, tr('wyłączona')),
            );
          const accounts = inBots.map((b) => b.platforms.find((p) => p.id === k).account);
          const partial = inBots.length < list.length;
          return h(
            'button',
            {
              type: 'button',
              class: `pchip ${st.platforms.includes(k) ? 'on' : ''}`,
              title: partial
                ? tr('Tylko: {0}', inBots.map((b) => b.name).join(', '))
                : accounts.every(Boolean)
                  ? accounts.map((a) => tr('Konto: {0}', a)).join(' · ')
                  : tr('Brak podłączonego konta – publikacja się nie uda'),
              onclick: () => toggle(k),
            },
            h('span', { class: 'tick' }, icon('check')),
            plat(k, false),
            PLAT[k][1],
            accounts.every(Boolean) ? null : h('small', { class: 'res bad' }, tr('brak konta')),
            partial ? h('small', null, `${inBots.length}/${list.length}`) : null,
          );
        }),
        [
          ['instagram', 'IG', 'Instagram'],
          ['threads', '@', 'Threads'],
          ['bluesky', '🦋', 'Bluesky'],
          ['telegram', 'TG', tr('Kanał Telegram')],
          ['tiktok', 'TT', 'TikTok'],
        ].map(([k, short, name]) =>
          h(
            'a',
            { class: 'pchip off', href: productUrl(), target: '_blank', rel: 'noopener', title: tr('Ta platforma jest w wersji PRO') },
            h('span', { class: `plat ${k} off` }, short),
            name,
            h('span', { class: 'badge pro' }, 'PRO'),
          ),
        ),
      );
    }

    // ------------------------------------------------------------------ 2. Wersje na platformy
    function variantRow(o, k) {
      const counter = h('span', { class: 'counter' });
      // X: post z linkiem kosztuje w płatnym API X wielokrotnie więcej niż zwykły (jak w zakładce Publikacja)
      const linkCost =
        k === 'x'
          ? h(
              'div',
              { class: 'res warn small' },
              tr('Post z linkiem: ok. {0} za post na X (płatne API X, ceny w X Developer Console).', usd(X_PRICE_USD.link)),
            )
          : null;
      const count = () => {
        const s = o.variants[k] || '';
        const n = postLength(k, s);
        counter.textContent = `${n}/${COMPOSE_LIMIT[k]}`;
        counter.classList.toggle('bad', n > COMPOSE_LIMIT[k] || !s.trim());
        if (linkCost) linkCost.hidden = !/https?:\/\//i.test(s);
      };
      count();
      return h(
        'div',
        { class: 'variant' },
        h('div', { class: 'row' }, plat(k, false), h('b', { class: 'grow' }, PLAT[k][1]), counter),
        h(
          'textarea',
          {
            rows: k === 'x' ? 5 : 7,
            oninput: (e) => {
              o.variants[k] = e.target.value;
              o.edited = true;
              count();
            },
          },
          o.variants[k] || '',
        ),
        linkCost,
        k in o.variants ? null : h('div', { class: 'res warn small' }, tr('Brak wersji – kliknij „Dopasuj” jeszcze raz albo wpisz tekst.')),
      );
    }

    // Co blokuje wysyłkę: braki botów (Telegram), boty bez wersji albo bez platform
    function sendBlockers() {
      const list = chosen();
      const out = [];
      for (const b of list) {
        for (const p of b.problems) out.push(many() ? `${b.name}: ${p}` : p);
        if (!platformsOf(b).length)
          out.push(
            many()
              ? tr('{0}: żadna z wybranych platform nie jest włączona w tym bocie', b.name)
              : tr('Wybierz co najmniej jedną platformę.'),
          );
        else if (!st.out[b.id]) out.push(tr('{0}: brak wersji – kliknij „Dopasuj pod platformy” jeszcze raz', b.name));
      }
      return out;
    }

    function variantsCard() {
      const title = tr('2. Wersje na platformy');
      const list = chosen();
      if (!list.some((b) => st.out[b.id]))
        return card(
          cardHead(title),
          h(
            'div',
            { class: 'empty' },
            icon('sparkles'),
            h(
              'div',
              null,
              tr(
                'Kliknij „Dopasuj pod platformy” – AI przygotuje osobną wersję posta na każdą wybraną platformę. Możesz też użyć swojego tekstu bez AI.',
              ),
            ),
          ),
        );
      if (!list.some((b) => b.id === st.tab)) st.tab = (list.find((b) => st.out[b.id]) || list[0]).id;
      const b = list.find((x) => x.id === st.tab);
      const o = st.out[b.id];
      const plats = platformsOf(b);
      const skipped = st.platforms.filter((k) => !plats.includes(k));
      const blockers = sendBlockers();
      const ready = !blockers.length;
      const sendBtn = (publishNow) =>
        h(
          'button',
          { class: `btn ${publishNow ? 'primary' : ''}`, disabled: !ready, onclick: (e) => send({ publishNow }, e.currentTarget) },
          icon(publishNow ? 'zap' : 'send'),
          publishNow ? tr('Publikuj teraz') : tr('Wyślij do akceptacji'),
        );
      return card(
        cardHead(
          title,
          !o
            ? null
            : o.ai
              ? tr('Tekst: {0} · możesz go poprawić przed wysłaniem.', o.ai)
              : tr('Twój tekst bez AI · możesz go poprawić przed wysłaniem.'),
        ),
        h(
          'div',
          { class: 'stack' },
          many()
            ? h(
                'nav',
                { class: 'tabs compose-tabs' },
                list.map((x) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      class: x.id === b.id ? 'active' : '',
                      onclick: () => {
                        st.tab = x.id;
                        render();
                      },
                    },
                    x.name,
                    st.out[x.id] ? null : h('span', { class: 'n' }, '!'),
                  ),
                ),
              )
            : null,
          !o
            ? h('div', { class: 'res warn small' }, tr('Brak wersji dla tego bota – kliknij „Dopasuj pod platformy” jeszcze raz.'))
            : plats.length
              ? plats.map((k) => variantRow(o, k))
              : h(
                  'div',
                  { class: 'muted' },
                  many() ? tr('Żadna z wybranych platform nie jest włączona w tym bocie.') : tr('Wybierz co najmniej jedną platformę.'),
                ),
          o && many() && skipped.length && plats.length
            ? h('div', { class: 'small muted' }, tr('Pominięte w tym bocie (wyłączone w zakładce Publikacja): {0}', names(skipped)))
            : null,
          blockers.length ? alertBox('warn', tr('Przed wysłaniem uzupełnij:'), blockers) : null,
          h('div', { class: 'small muted' }, SEND_HELP),
          h('div', { class: 'row small muted' }, tr('Planowanie postów, posty cykliczne i kalendarz treści'), proLink()),
          h('div', { class: 'row small muted' }, tr('Post z telefonu: komenda /post w Telegramie'), proLink()),
        ),
        [sendBtn(false), sendBtn(true)],
        'send-card',
      );
    }

    // ------------------------------------------------------------------ po wysłaniu: wynik
    function sentCard() {
      const all = (S.overview && S.overview.runs) || [];
      const runs = st.sent.runs.map((id) => all.find((r) => r.id === id));
      const one = runs.length === 1 ? runs[0] : null;
      const runBlock = (run) => {
        const res = (run && run.results) || {};
        return h(
          'div',
          { class: 'stack tight' },
          h(
            'div',
            { class: 'row wrap' },
            runs.length > 1 ? h('b', null, run ? run.botName : '…') : null,
            run ? statusBadge(run.status) : h('span', { class: 'spinner' }),
            run && run.message ? h('span', { class: 'muted small' }, run.message) : null,
            runs.length > 1 && run && run.draftId
              ? h('button', { class: 'btn sm', onclick: () => openDraft(run.draftId) }, icon('image'), tr('Pokaż draft'))
              : null,
          ),
          PLATFORMS.filter((k) => res[k]).map((k) =>
            h(
              'div',
              { class: 'row small' },
              plat(k, false),
              res[k].ok
                ? h(
                    'span',
                    { class: 'res ok' },
                    '✓ ',
                    res[k].url ? h('a', { href: res[k].url, target: '_blank', rel: 'noopener' }, tr('zobacz post')) : res[k].note || 'OK',
                  )
                : h('span', { class: 'res bad' }, `✗ ${res[k].error || tr('błąd')}`),
            ),
          ),
        );
      };
      return card(
        cardHead(
          st.sent.publishNow ? tr('Publikacja własnego posta') : tr('Własny post wysłany do akceptacji'),
          one ? `${one.botName} · ${fmtWhen(one.startedAt)}` : runs.length > 1 ? runs.map((r) => (r ? r.botName : '…')).join(', ') : null,
        ),
        h(
          'div',
          { class: 'stack' },
          runs.map(runBlock),
          st.sent.failed && st.sent.failed.length
            ? alertBox(
                'bad',
                tr('Nie wysłano:'),
                st.sent.failed.map((f) => `${f.botName}: ${f.error}`),
              )
            : null,
          runs.some((r) => r && r.status === 'draft')
            ? alertBox('info', tr('Draft czeka w Telegramie – zatwierdź go przyciskiem ✅ Publikuj.'))
            : null,
        ),
        [
          one && one.draftId
            ? h('button', { class: 'btn', onclick: () => openDraft(one.draftId) }, icon('image'), tr('Pokaż draft'))
            : null,
          newPostButton(),
        ],
      );
    }

    function newPostButton() {
      return h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            S.compose = composeState({ botIds: st.botIds, platforms: st.platforms });
            pageCompose(st.botIds[0]);
          },
        },
        icon('edit'),
        tr('Napisz kolejny post'),
      );
    }

    // ------------------------------------------------------------------ akcje
    async function adapt(useAi, btn) {
      if (!st.text.trim()) return toast(tr('Najpierw napisz treść posta'), 'warn');
      if (!st.platforms.length) return toast(tr('Wybierz co najmniej jedną platformę'), 'warn');
      const list = chosen();
      if (
        list.some((b) => st.out[b.id] && st.out[b.id].edited) &&
        !(await confirmDialog(tr('Poprawione wersje zostaną zastąpione nowymi.'), { ok: tr('Zastąp') }))
      )
        return;
      await busy(btn, async () => {
        // każdy bot osobno (jego język, wytyczne i dostawca AI) – równolegle
        const results = await Promise.all(
          list.map(async (b) => {
            const platforms = platformsOf(b);
            if (!platforms.length) return { b, error: tr('żadna z wybranych platform nie jest włączona w tym bocie') };
            const body = { text: st.text, link: st.link, hint: st.hint, platforms };
            if (!useAi) body.ai = false;
            try {
              return { b, r: await api('POST', `/api/bots/${b.id}/compose/adapt`, body) };
            } catch (e) {
              return { b, error: e.message };
            }
          }),
        );
        const errors = [];
        for (const { b, r, error } of results) {
          if (!r) {
            delete st.out[b.id];
            errors.push(many() ? `${b.name}: ${error}` : error);
            continue;
          }
          st.out[b.id] = { variants: r.variants, ai: r.ai, edited: false };
          if (r.missing && r.missing.length)
            toast(
              tr('AI nie napisało wersji dla: {0} – wstawiono Twój tekst', (many() ? `${b.name}: ` : '') + r.missing.join(', ')),
              'warn',
            );
        }
        st.stale = false;
        if (errors.length) toast(errors.join(' · '), 'bad');
        render();
        // na telefonie wersje są pod formularzem
        if (variantsEl && window.innerWidth <= 1100) variantsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // publishNow – od razu; plan – zaplanowanie (PRO); bez obu – draft do akceptacji. true = wysłano
    async function send({ publishNow = false, plan = null }, btn) {
      const list = chosen();
      for (const b of list) {
        const o = st.out[b.id];
        const empty = o ? platformsOf(b).filter((k) => !String(o.variants[k] || '').trim()) : [];
        if (empty.length) return toast(tr('Brak tekstu dla: {0}', (many() ? `${b.name}: ` : '') + names(empty)), 'warn');
      }
      if (st.image.source === 'upload' && !st.image.data) return toast(tr('Dodaj zdjęcie albo wybierz „Bez grafiki”'), 'warn');
      const where = list.map((b) => (many() ? `${b.name} (${names(platformsOf(b))})` : names(platformsOf(b)))).join(', ');
      if (
        publishNow &&
        !(await confirmDialog(tr('Post pójdzie od razu na: {0} – bez akceptacji w Telegramie.', where), {
          title: tr('Opublikować teraz?'),
          ok: tr('Publikuj teraz'),
        }))
      )
        return false;
      const done = await busy(btn, async () => {
        const body = {
          text: st.text,
          link: st.link,
          hint: st.hint,
          image: { source: st.image.source, data: st.image.source === 'upload' ? st.image.data : undefined },
          publishNow,
          bots: list.map((b) => {
            const o = st.out[b.id];
            const platforms = platformsOf(b);
            const one = { id: b.id, platforms, posts: Object.fromEntries(platforms.map((k) => [k, o.variants[k]])), ai: o.ai || '' };
            return one;
          }),
        };
        const r = await api('POST', '/api/compose', body);
        st.sent = { runs: r.runs.map((run) => run.id), failed: r.failed || [], publishNow };
        if (r.failed && r.failed.length) toast(tr('Nie wysłano: {0}', r.failed.map((f) => f.botName).join(', ')), 'bad');
        else
          toast(
            publishNow ? tr('Publikuję – wynik zobaczysz tutaj i w Telegramie') : tr('Wysłano – draft przyjdzie na Telegram za chwilę'),
          );
        await loadOverview().catch(() => {});
        render();
        return true;
      });
      return !!done;
    }

    function render() {
      if (st.sent) {
        fill(wrap, sentCard());
        return;
      }
      variantsEl = variantsCard();
      fill(wrap, h('div', { class: 'compose-grid' }, formCard(), variantsEl));
    }
    fill(mainEl, head, wrap);
    render();
    // wynik publikacji: odświeżanie, aż post wyjdzie (draft – aż ktoś go zatwierdzi w Telegramie)
    startPoll(async () => {
      if (!st.sent || !st.sent.runs) return;
      const all = (S.overview && S.overview.runs) || [];
      const pending = st.sent.runs.some((id) => {
        const run = all.find((r) => r.id === id);
        return !run || ['starting', 'running', 'publishing', 'draft'].includes(run.status);
      });
      if (!pending) return;
      await loadOverview().catch(() => {});
      if (!document.querySelector('.overlay')) render();
    }, 4000);
  }

  // ============================================================================================ DRAFTY
  function draftCard(d) {
    const st = d.status === 'draft' ? 'draft' : d.status;
    return h(
      'article',
      { class: 'card draft', onclick: () => openDraft(d.draftId) },
      h(
        'div',
        { class: 'thumb', style: d.image ? { backgroundImage: `url("/files/${encodeURIComponent(d.image)}")` } : {} },
        statusBadge(st),
      ),
      h(
        'div',
        { class: 'body' },
        h('b', null, d.title || d.draftId),
        h(
          'div',
          { class: 'row small muted' },
          h('span', { class: 'grow ellipsis' }, d.botName || '—'),
          d.mode === 'manual' ? h('span', { class: 'badge', title: tr('Własny post z panelu') }, '✍️') : null,
          h('span', { class: 'nowrap' }, fmtWhen(d.createdAt)),
        ),
      ),
    );
  }

  async function openDraft(id) {
    let d;
    try {
      d = (await api('GET', `/api/drafts/${encodeURIComponent(id)}`)).draft;
    } catch (e) {
      return toast(e.message, 'bad');
    }
    const res = d.results || {};
    const resultRow = (k) => {
      const r = res[k];
      if (!r) return null;
      return h(
        'div',
        { class: 'row small' },
        plat(k, false),
        r.ok
          ? h(
              'span',
              { class: 'res ok' },
              '✓ ',
              r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, tr('zobacz post')) : r.note || 'OK',
            )
          : h('span', { class: 'res bad' }, `✗ ${r.error || tr('błąd')}`),
      );
    };
    const block = (title, text) =>
      text ? h('div', null, h('div', { class: 'row' }, h('b', { class: 'grow' }, title), copyBtn(text)), h('pre', null, text)) : null;
    // własny post: tylko platformy wybrane w edytorze
    const chosen = (k) => !d.platforms || d.platforms.includes(k);
    const manual = d.mode === 'manual';
    const linkLabel = manual ? tr('Link w poście') : tr('Źródło');
    modal({
      title: d.title || d.draftId,
      sub: `${d.botName || 'bot'} · ${fmtWhen(d.createdAt)} · ${d.draftId}`,
      wide: true,
      body: h(
        'div',
        { class: 'draft-detail' },
        h(
          'div',
          { class: 'stack tight' },
          d.image
            ? h('img', { src: `/files/${encodeURIComponent(d.image)}`, alt: tr('grafika') })
            : h('div', { class: 'muted' }, tr('brak grafiki')),
          h(
            'div',
            { class: 'row wrap' },
            statusBadge(d.status),
            d.image
              ? h('a', { class: 'btn sm', href: `/files/${encodeURIComponent(d.image)}?download=1` }, icon('download'), tr('Grafika'))
              : null,
          ),
          d.url
            ? h(
                'a',
                { href: d.url, target: '_blank', rel: 'noopener', class: 'small' },
                `${linkLabel}: ${manual ? d.url : d.source || d.url}`,
              )
            : null,
          PLATFORMS.map(resultRow),
        ),
        h(
          'div',
          { class: 'stack' },
          d.whySelected ? alertBox('info', d.whySelected) : null,
          manual ? block(tr('Twój tekst'), d.composeText) : null,
          // post z linkiem: na X poszedł wariant z adresem artykułu
          chosen('x') ? block('X', d.linkMode && d.post_x_link ? d.post_x_link : d.post_x) : null,
          chosen('facebook') ? block(manual ? 'Facebook' : 'Facebook / Instagram', d.post_fb_insta) : null,
          block(tr('Skrypt TikTok'), d.script_tiktok),
        ),
      ),
    });
  }

  async function pageDrafts(botId) {
    if (!S.overview) await loadOverview();
    let filter = botId || '';
    const grid = h('div', { class: 'drafts' });
    const load = async () => {
      fill(grid, h('span', { class: 'spinner' }));
      const r = await api('GET', `/api/drafts?limit=120${filter ? `&bot=${filter}` : ''}`);
      fill(
        grid,
        r.drafts.length
          ? r.drafts.map(draftCard)
          : h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, icon('image'), h('div', null, tr('Brak draftów.'))),
      );
    };
    fill(
      mainEl,
      pageHead(tr('Drafty'), tr('Wszystkie wygenerowane posty z grafikami (archiwum na NAS-ie: data/files).'), [
        select(filter, [['', tr('Wszystkie boty')], ...S.overview.bots.map((b) => [b.id, b.name])], (v) => {
          filter = v;
          load();
        }),
      ]),
      grid,
    );
    await load();
  }

  // ============================================================================================ USTAWIENIA
  async function pageSettings() {
    fill(mainEl, h('div', { class: 'boot' }, h('div', { class: 'spinner' })));
    S.settings = await api('GET', '/api/settings');
    const st = S.settings;
    const g = clone(st.global);
    g.ai = { providers: {}, ...(g.ai || {}) };
    const sec = {};
    const saveSection = (btn, globalPart, secretKeys) =>
      busy(btn, async () => {
        const secrets = {};
        for (const k of secretKeys) if (sec[k]) secrets[k] = sec[k];
        S.settings = await api('PUT', '/api/settings', { global: globalPart, secrets });
        resetModels();
        toast(tr('Zapisano ustawienia'));
        await loadOverview().catch(() => {});
        pageSettings();
      });
    // „Zapisz i sprawdź” dostawcy AI: zapis adresów i klucza, potem test połączenia
    const testProvider = (btn, provider, secretKeys) =>
      busy(btn, async () => {
        const secrets = {};
        for (const k of secretKeys) if (sec[k]) secrets[k] = sec[k];
        S.settings = await api('PUT', '/api/settings', { global: { ai: g.ai }, secrets });
        resetModels();
        toast((await api('POST', '/api/test/provider', { provider })).message, 'ok', 6000);
      });
    const clearSecret = (key, label) =>
      h(
        'a',
        {
          href: '#',
          class: 'small',
          onclick: async (e) => {
            e.preventDefault();
            if (!(await confirmDialog(tr('Usunąć zapisany {0}?', label), { danger: true, ok: tr('Usuń') }))) return;
            S.settings = await api('PUT', '/api/settings', { secrets: { [key]: null } });
            pageSettings();
          },
        },
        tr('usuń'),
      );
    const secretField = (key, label, placeholder, hint) =>
      field(
        label,
        secretInput(st.secrets[key], placeholder, (v) => (sec[key] = v)),
        h('span', null, hint || '', st.secrets[key].set ? [' ', clearSecret(key, label.toLowerCase())] : null),
      );

    const chatField = h('input', {
      type: 'text',
      value: g.telegram.chatId,
      placeholder: tr('np. 123456789 lub -1001234567890'),
      oninput: (e) => (g.telegram.chatId = e.target.value.trim()),
    });
    const detect = async (btn) =>
      busy(btn, async () => {
        const r = await api('GET', '/api/telegram/chats');
        if (!r.chats.length)
          return toast(
            tr(
              'Nie widzę jeszcze żadnego czatu. Napisz /start do bota{0} (albo dodaj go do grupy) i kliknij ponownie.',
              r.status.username ? ` @${r.status.username}` : '',
            ),
            'warn',
            9000,
          );
        const m = modal({
          title: tr('Wybierz czat'),
          sub: tr('Czaty, z których bot ostatnio dostał wiadomość.'),
          body: h(
            'div',
            { class: 'stack tight' },
            r.chats.map((c) =>
              h(
                'button',
                {
                  class: 'btn',
                  style: { justifyContent: 'flex-start', height: 'auto', padding: '10px 14px' },
                  onclick: () => {
                    chatField.value = c.id;
                    g.telegram.chatId = c.id;
                    m.close();
                    toast(tr('Wybrano czat – kliknij „Zapisz”'));
                  },
                },
                h(
                  'div',
                  { style: { textAlign: 'left' } },
                  h('b', null, c.title || c.username || c.id),
                  h(
                    'div',
                    { class: 'small muted' },
                    `${c.type === 'private' ? tr('czat prywatny') : c.type === 'channel' ? tr('kanał') : tr('grupa')} · ID ${c.id} · ${fmtAgo(c.seenAt)}`,
                  ),
                ),
              ),
            ),
          ),
        });
      });

    fill(
      mainEl,
      pageHead(tr('Ustawienia'), tr('Klucze API i ustawienia programu. Konta social media podłączasz w bocie (zakładka Konta).')),
      h(
        'div',
        { class: 'stack' },
        card(
          [h('span', { class: 'plat gemini' }, 'G'), ...cardHead('Google Gemini', tr('Model AI, który wybiera newsy i pisze posty.'))],
          h(
            'div',
            { class: 'form-grid' },
            secretField(
              'geminiApiKey',
              tr('Klucz API'),
              'AIza…',
              h(
                'span',
                null,
                'Z ',
                h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'),
                tr('. Klucz z projektu bez billingu = teksty za 0 zł w darmowym limicie Google.'),
              ),
            ),
          ),
          [
            h(
              'button',
              { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => toast((await api('POST', '/api/test/gemini')).message)) },
              icon('zap'),
              tr('Sprawdź klucz'),
            ),
            h(
              'button',
              { class: 'btn primary', onclick: (e) => saveSection(e.currentTarget, {}, ['geminiApiKey']) },
              icon('check'),
              tr('Zapisz'),
            ),
          ],
        ),
        card(
          [
            h('span', { class: 'plat', style: { background: '#0f766e' } }, icon('sparkles')),
            ...cardHead(
              tr('Dostawcy AI – tekst'),
              tr(
                'Alternatywa dla Gemini: model na Twoim sprzęcie albo inne API zgodne z OpenAI. Wybierasz go w bocie: zakładka Tekst i grafika.',
              ),
            ),
          ],
          h(
            'div',
            { class: 'providers' },
            TEXT_PROVIDER_SETUP.map(([id, secret, keyLink, desc, basePh]) => {
              const info = (st.options.textProviders || []).find((p) => p.id === id) || { label: id, defaultBase: '' };
              const conf = (g.ai.providers[id] = g.ai.providers[id] || { baseUrl: '' });
              return h(
                'div',
                { class: 'provider' },
                h(
                  'div',
                  { class: 'provider-head' },
                  h('b', null, info.label),
                  h(
                    'span',
                    { class: `badge ${info.configured ? 'ok' : ''}` },
                    info.configured ? tr('skonfigurowany') : tr('nieskonfigurowany'),
                  ),
                  h('span', { class: 'grow' }),
                  h(
                    'button',
                    { class: 'btn sm', onclick: (e) => testProvider(e.currentTarget, id, [secret]) },
                    icon('zap'),
                    tr('Zapisz i sprawdź'),
                  ),
                ),
                h('div', { class: 'muted small' }, desc),
                h(
                  'div',
                  { class: 'form-grid' },
                  secretField(
                    secret,
                    info.keyOptional ? tr('Klucz API (opcjonalnie)') : tr('Klucz API'),
                    '',
                    keyLink ? h('a', { href: `https://${keyLink}`, target: '_blank', rel: 'noopener' }, keyLink) : null,
                  ),
                  field(
                    info.defaultBase ? tr('Adres API (opcjonalnie)') : tr('Adres API'),
                    h('input', {
                      type: 'text',
                      value: conf.baseUrl || '',
                      placeholder: info.defaultBase || basePh,
                      spellcheck: 'false',
                      oninput: (e) => (conf.baseUrl = e.target.value.trim()),
                    }),
                    info.defaultBase ? tr('Puste = adres domyślny.') : tr('Adres zgodny z OpenAI, zwykle kończy się na /v1.'),
                  ),
                ),
              );
            }),
          ),
          [
            h(
              'button',
              {
                class: 'btn primary',
                onclick: (e) =>
                  saveSection(
                    e.currentTarget,
                    { ai: g.ai },
                    TEXT_PROVIDER_SETUP.map((p) => p[1]),
                  ),
              },
              icon('check'),
              tr('Zapisz'),
            ),
          ],
        ),
        card(
          [
            h('span', { class: 'plat telegram' }, 'TG'),
            ...cardHead('Telegram', tr('Drafty z przyciskami ✅/❌ i alerty o błędach.')),
            statusPill(),
          ],
          h(
            'div',
            { class: 'form-grid' },
            secretField('telegramBotToken', tr('Token bota'), '123456789:AA…', tr('Od @BotFather (/newbot).')),
            field(
              tr('ID czatu'),
              h(
                'div',
                { class: 'input-group' },
                chatField,
                h('button', { class: 'btn', onclick: (e) => detect(e.currentTarget) }, icon('sparkles'), tr('Wykryj')),
              ),
              tr('Napisz /start do swojego bota, potem kliknij „Wykryj”.'),
            ),
            field(
              tr('ID administratorów (opcjonalnie)'),
              h('input', {
                type: 'text',
                value: (g.telegram.adminIds || []).join(', '),
                placeholder: tr('np. 123456789, 987654321'),
                oninput: (e) => (g.telegram.adminIds = e.target.value),
              }),
              ADMIN_HELP,
            ),
          ),
          [
            h(
              'button',
              {
                class: 'btn',
                onclick: (e) =>
                  busy(e.currentTarget, async () =>
                    toast((await api('POST', '/api/test/telegram-token', { token: sec.telegramBotToken })).message),
                  ),
              },
              icon('zap'),
              tr('Sprawdź token'),
            ),
            h(
              'button',
              {
                class: 'btn',
                onclick: (e) =>
                  busy(e.currentTarget, async () =>
                    toast((await api('POST', '/api/test/telegram', { chatId: g.telegram.chatId })).message),
                  ),
              },
              icon('send'),
              tr('Wyślij test'),
            ),
            h(
              'button',
              { class: 'btn primary', onclick: (e) => saveSection(e.currentTarget, { telegram: g.telegram }, ['telegramBotToken']) },
              icon('check'),
              tr('Zapisz'),
            ),
          ],
        ),
        card(
          [
            plat('x', false),
            ...cardHead(tr('Aplikacja X (Twitter)'), tr('Jedna aplikacja deweloperska obsłuży konta X wszystkich botów.')),
          ],
          h(
            'div',
            { class: 'stack' },
            h(
              'div',
              { class: 'form-grid' },
              field(
                tr('Client ID'),
                h('input', { type: 'text', value: g.x.clientId, oninput: (e) => (g.x.clientId = e.target.value.trim()) }),
              ),
              secretField('xClientSecret', tr('Client Secret'), tr('dla aplikacji typu Web App (confidential)')),
              field(
                tr('Callback URI – wpisz w aplikacji X'),
                h(
                  'div',
                  { class: 'input-group' },
                  h('input', { type: 'text', readOnly: true, value: st.info.xRedirectUri }),
                  copyBtn(st.info.xRedirectUri),
                ),
                tr('developer.x.com → aplikacja → User authentication settings → Callback URI.'),
                'full',
              ),
              field(
                tr('Własny Callback URI (opcjonalnie)'),
                h('input', {
                  type: 'text',
                  value: g.x.redirectUri,
                  placeholder: tr('puste = adres panelu powyżej'),
                  oninput: (e) => (g.x.redirectUri = e.target.value.trim()),
                }),
                tr('Tylko jeśli X nie przyjmie adresu http:// panelu – wtedy wkleisz adres z paska przeglądarki ręcznie.'),
                'full',
              ),
            ),
            h(
              'ol',
              { class: 'steps' },
              h(
                'li',
                null,
                tr(
                  'developer.x.com → Projects & Apps → Twoja aplikacja → User authentication settings: OAuth 2.0, typ Web App, uprawnienia Read and write.',
                ),
              ),
              h('li', null, tr('Skopiuj Client ID i Client Secret tutaj, zapisz.')),
              h('li', null, tr('W bocie: zakładka Konta → „Połącz konto X”.')),
            ),
          ),
          [
            h(
              'button',
              { class: 'btn primary', onclick: (e) => saveSection(e.currentTarget, { x: g.x }, ['xClientSecret']) },
              icon('check'),
              tr('Zapisz'),
            ),
          ],
        ),
        card(
          [plat('facebook', false), ...cardHead('Meta (Facebook)', tr('Token strony podłączasz w bocie (zakładka Konta).'))],
          h(
            'div',
            { class: 'form-grid' },
            field(
              tr('Wersja Graph API'),
              h('input', { type: 'text', value: g.meta.graphVersion, oninput: (e) => (g.meta.graphVersion = e.target.value.trim()) }),
              tr('Np. v24.0 – zmieniaj tylko świadomie.'),
            ),
          ),
          [
            h(
              'button',
              { class: 'btn primary', onclick: (e) => saveSection(e.currentTarget, { meta: g.meta }, []) },
              icon('check'),
              tr('Zapisz'),
            ),
          ],
        ),
        card(
          [
            h('span', { class: 'plat', style: { background: '#16a34a' } }, 'A'),
            ...cardHead(tr('Apify (opcjonalnie)'), tr('Płatne pobieranie tweetów, gdy RSSHub nie wystarcza.')),
          ],
          h(
            'div',
            { class: 'form-grid' },
            secretField('apifyToken', tr('Token API'), 'apify_api_…', 'console.apify.com → Settings → Integrations.'),
            field(
              tr('Actor'),
              h('input', { type: 'text', value: g.apify.actorId, oninput: (e) => (g.apify.actorId = e.target.value.trim()) }),
            ),
          ),
          [
            h(
              'button',
              { class: 'btn primary', onclick: (e) => saveSection(e.currentTarget, { apify: g.apify }, ['apifyToken']) },
              icon('check'),
              tr('Zapisz'),
            ),
          ],
        ),
        card(
          cardHead(
            tr('Język panelu'),
            tr('Panel, wiadomości w Telegramie i raporty z przebiegów. Język postów ustawiasz osobno w każdym bocie.'),
          ),
          h(
            'div',
            { class: 'form-grid' },
            field(
              tr('Język'),
              select(LANG, Object.entries(LANGS), async (v) => {
                try {
                  S.settings = await api('PUT', '/api/settings', { global: { ui: { language: v } } });
                } catch (e) {
                  return toast(e.message, 'bad');
                }
                if (!useLang(v)) toast(tr('Zapisano ustawienia'));
              }),
            ),
          ),
        ),
        passwordCard(),
        licenseCard(st),
        card(
          cardHead(tr('Informacje o systemie')),
          h(
            'dl',
            { class: 'kv' },
            h('dt', null, tr('Panel')),
            h('dd', null, st.info.publicUrl),
            h('dt', null, tr('Wersja programu')),
            h(
              'dd',
              null,
              `LITE ${st.info.version} · `,
              h('a', { href: productUrl(), target: '_blank', rel: 'noopener' }, tr('Więcej o wersji PRO')),
            ),
            h('dt', null, 'n8n'),
            h('dd', null, h('a', { href: st.info.n8nPublicUrl, target: '_blank', rel: 'noopener' }, st.info.n8nPublicUrl)),
            h('dt', null, tr('Strefa czasowa')),
            h('dd', null, st.info.timezone),
            h('dt', null, tr('Dane panelu')),
            h('dd', null, h('code', null, 'data/panel'), tr(' (kopia zapasowa: skopiuj ten katalog)')),
            h('dt', null, tr('Kod źródłowy')),
            h(
              'dd',
              null,
              h('a', { href: st.info.projectUrl, target: '_blank', rel: 'noopener' }, st.info.projectUrl),
              tr(' · licencja AGPL-3.0'),
            ),
          ),
        ),
      ),
    );
  }

  function statusPill() {
    const t = S.overview && S.overview.health && S.overview.health.telegram;
    if (!t) return null;
    return h('span', { class: `badge ${t.ok ? 'ok' : 'warn'}` }, t.ok ? tr('@{0} działa', t.username || 'bot') : t.message);
  }

  // Wersja PRO: klucz licencyjny wklejony tutaj panel sprawdza w Polarze (bez aktywacji – nie zajmuje urządzenia)
  // i trzyma dla scripts/upgrade-to-pro.sh. Aktywację robi skrypt (klucz SSH NAS-a, .git/), po niej klucz znika
  // z panelu. W PRO karta pokazuje licencję tego NAS-a i pozwala podać nowy klucz; PRO bez licencji (wdrożenie) – bez karty.
  function licenseCard(st) {
    const lk = st.licenseKey;
    const pro = st.info.edition === 'pro';
    if (!lk || (pro && !st.license)) return null;
    const devices = (n) => {
      if (n === null || n === undefined) return tr('bez limitu urządzeń');
      if (n === 1) return tr('na 1 urządzenie');
      const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
      return few ? tr('na {0} urządzenia', n) : tr('na {0} urządzeń', n);
    };
    const pricing = (label) => h('a', { class: 'btn sm', href: lk.pricingUrl, target: '_blank', rel: 'noopener' }, icon('ext'), label);
    let key = '';
    const result = h('div');
    const check = (btn) =>
      busy(btn, async () => {
        const r = await api('POST', '/api/license/check', { key });
        if (r.result === 'ok') {
          toast(tr('Klucz licencyjny jest ważny'));
          return pageSettings();
        }
        fill(
          result,
          h(
            'div',
            { class: 'alert bad', style: { marginTop: '12px', alignItems: 'center' } },
            icon('alert'),
            h('div', { class: 'grow' }, r.message),
            r.result === 'expired' ? pricing(tr('Przedłuż licencję')) : null,
          ),
        );
      });
    const form = h(
      'div',
      null,
      field(
        tr('Klucz licencyjny'),
        h(
          'div',
          { class: 'input-group' },
          h('input', {
            type: 'text',
            class: 'mono',
            autocomplete: 'off',
            spellcheck: false,
            placeholder: tr('ze strony zamówienia w Polarze'),
            oninput: (e) => (key = e.target.value),
          }),
          h('button', { class: 'btn primary', type: 'button', onclick: (e) => check(e.currentTarget) }, icon('check'), tr('Sprawdź klucz')),
        ),
        tr(
          'Klucz znajdziesz po kliknięciu „Access purchase” w e-mailu od Polara. Panel sprawdzi go, nie zajmując żadnego z urządzeń licencji.',
        ),
        'full',
      ),
      result,
    );
    const p = lk.pending;
    const pending =
      p &&
      h(
        'div',
        null,
        h(
          'div',
          { class: 'alert ok', style: { marginBottom: '14px' } },
          icon('check'),
          h(
            'div',
            { class: 'grow' },
            h('b', null, tr('Klucz {0} jest ważny', p.hint)),
            h(
              'div',
              null,
              p.expiresAt ? tr('Aktualizacje do {0}', fmtDate(p.expiresAt)) : tr('Aktualizacje bez limitu czasu'),
              ' · ',
              tr('licencja {0}', devices(p.limit)),
            ),
          ),
        ),
        field(
          tr('Teraz przez SSH na NAS-ie uruchom'),
          h('div', { class: 'input-group' }, h('code', { class: 'cmdline' }, lk.command), copyBtn(lk.command)),
          [
            lk.projectDir
              ? tr('Z dowolnego katalogu – polecenie ma pełną ścieżkę. ')
              : tr('W katalogu projektu (np. /volume1/docker/poster). '),
            pro
              ? tr('Skrypt nie zapyta o klucz: aktywuje licencję na tym NAS-ie i usunie klucz z panelu.')
              : tr(
                  'Skrypt nie zapyta o klucz: aktywuje licencję na tym NAS-ie, przełączy instalację na PRO i usunie klucz z panelu. Boty, klucze i historia zostają bez zmian.',
                ),
          ],
          'full',
        ),
      );
    const remove = (btn) =>
      busy(btn, async () => {
        await api('DELETE', '/api/license/key');
        pageSettings();
      });
    const foot = p
      ? [h('button', { class: 'btn', onclick: (e) => remove(e.currentTarget) }, icon('trash'), tr('Usuń klucz z panelu'))]
      : null;
    const head = [h('span', { class: 'plat', style: { background: '#7c3aed' } }, icon('key'))];
    if (!pro)
      return card(
        [
          ...head,
          ...cardHead(
            tr('Wersja PRO'),
            tr('Masz klucz licencyjny? Wklej go tutaj – przejście na PRO to potem jedno polecenie przez SSH.'),
            pricing(tr('Cennik')),
          ),
        ],
        p ? pending : form,
        foot,
      );
    // PRO: licencja tego NAS-a, a nowy klucz (np. po zakupie nowej licencji) – po kliknięciu
    const l = st.license;
    let status = tr('Aktywna');
    if (l.state === 'inactive') status = tr('Nieaktywna (np. po zwrocie płatności)');
    else if (l.state === 'expired')
      status = l.updatesUntil ? tr('Aktualizacje wygasły {0}', fmtDate(l.updatesUntil)) : tr('Aktualizacje wygasły');
    else if (l.updatesUntil) status = tr('Aktywna · aktualizacje do {0}', fmtDate(l.updatesUntil));
    form.style.display = 'none';
    const change = h(
      'button',
      {
        class: 'btn sm',
        type: 'button',
        onclick: (e) => {
          e.currentTarget.remove();
          form.style.display = '';
        },
      },
      icon('key'),
      tr('Podaj nowy klucz licencyjny'),
    );
    return card(
      [...head, ...cardHead(tr('Licencja PRO'), status, l.state === 'expired' ? pricing(tr('Przedłuż licencję')) : null)],
      p ? pending : h('div', null, change, form),
      foot,
    );
  }

  function passwordCard() {
    let cur = '';
    let next = '';
    return card(
      [h('span', { class: 'plat', style: { background: '#475569' } }, icon('key')), ...cardHead(tr('Hasło do panelu'))],
      h(
        'div',
        { class: 'form-grid' },
        field(
          tr('Obecne hasło'),
          h('input', { type: 'password', autocomplete: 'current-password', oninput: (e) => (cur = e.target.value) }),
        ),
        field(
          tr('Nowe hasło (min. 8 znaków)'),
          h('input', { type: 'password', autocomplete: 'new-password', oninput: (e) => (next = e.target.value) }),
        ),
      ),
      [
        h(
          'button',
          {
            class: 'btn primary',
            onclick: (e) =>
              busy(e.currentTarget, async () => {
                await api('POST', '/api/password', { current: cur, password: next });
                toast(tr('Zmieniono hasło'));
              }),
          },
          tr('Zmień hasło'),
        ),
      ],
    );
  }

  // ============================================================================================ start
  async function start() {
    renderShell();
    try {
      await loadOverview();
    } catch (e) {}
    router();
  }

  window.addEventListener('hashchange', router);
  window.addEventListener('beforeunload', (e) => {
    const unsent = S.compose && !S.compose.sent && S.compose.text.trim() && location.hash.startsWith('#/compose');
    if ((S.editor && S.editor.dirty() && location.hash.startsWith(`#/bot/${S.editor.id}`)) || unsent) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  (async () => {
    try {
      S.session = await api('GET', '/api/session');
      S.about = {
        version: S.session.version,
        edition: S.session.edition,
        projectUrl: S.session.projectUrl,
        productUrl: S.session.productUrl,
      };
      // język wybrany w Ustawieniach panelu ma pierwszeństwo przed językiem przeglądarki
      if (S.session.language && useLang(S.session.language)) return;
    } catch (e) {
      fill(
        document.getElementById('app'),
        h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth' }, brand(), alertBox('bad', e.message))),
      );
      return;
    }
    if (!S.session.authenticated) return renderAuth();
    start();
  })();
})();
