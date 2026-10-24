#!/usr/bin/env python3
"""Builds workflows/poster_workflow.json from the Code-node sources in ./code.

Usage: python3 workflows/src/build.py [output.json]   (default: workflows/poster_workflow.json)
Never edit poster_workflow.json by hand – change this file or code/*.js and rebuild.
"""
import json
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from editions import edition_view  # noqa: E402

HERE = Path(__file__).parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "poster_workflow.json"
NS = uuid.UUID("6f1b8f0e-3c1a-4e55-9a57-706f73746572")

WORKFLOW_ID = "PosterBotMain001"

CFG = "$('Config').first().json"
# Wszystkie zapytania do API idą przez bramkę panelu: {gateway}/<usługa>/<ścieżka> (panel dokleja klucze bota)
GW = "{{ " + CFG + ".gateway }}"
TG = GW + "/telegram"
GRAPH = GW + "/meta/{{ " + CFG + ".meta.graphVersion }}"
TOKEN_HEADER = ("x-poster-token", "={{ $env.PANEL_INTERNAL_TOKEN }}")

nodes = []
connections = {}


def uid(name):
    return str(uuid.uuid5(NS, name))


def code(name):
    return edition_view((HERE / "code" / f"{name}.js").read_text(encoding="utf-8"), "pro", f"code/{name}.js")


def add(node):
    nodes.append(node)
    return node["name"]


def base(name, ntype, version, pos, params, **extra):
    n = {
        "parameters": params,
        "id": uid(name),
        "name": name,
        "type": ntype,
        "typeVersion": version,
        "position": list(pos),
    }
    n.update(extra)
    return n


# ------------------------------------------------------------------------------------------------
# Języki: teksty w węzłach Code piszemy po polsku w tr('…', ...args) z miejscami {0}, {1}…, a angielskie
# tłumaczenia są w i18n-en.json. Build dokleja do węzła, który używa tr(), funkcję tr() ze słownikiem tylko
# jego tekstów. Język = cfg.lang z panelu (Ustawienia → Język panelu); prompty AI i nazwy węzłów zostają po polsku.
# ------------------------------------------------------------------------------------------------
I18N_EN = json.loads((HERE / "i18n-en.json").read_text(encoding="utf-8"))
TR_CALL = re.compile(r"\btr\(\s*([^)\s])")
TR_KEY = re.compile(r"\btr\(\s*'((?:[^'\\\n]|\\.)*)'")
PLACEHOLDER = re.compile(r"\{\d+\}")
i18n_used = set()
TR_PRELUDE = """// --- język (wstawia build.py): tr('tekst po polsku', ...args) zwraca tekst w języku panelu ---
const TR_LANG = (() => {
  try {
    return %s === 'en' ? 'en' : 'pl';
  } catch (e) {
    return 'pl';
  }
})();
const TR_EN = %s;
const tr = (text, ...args) => {
  const s = (TR_LANG === 'en' && TR_EN[text]) || text;
  return args.length ? s.replace(/\\{(\\d+)\\}/g, (m, i) => (args[i] === undefined ? m : String(args[i]))) : s;
};
"""


def with_i18n(name, src):
    for m in TR_CALL.finditer(src):
        assert m.group(1) == "'", f"{name}: tr() needs a '…' literal as its first argument"
    keys = []
    for m in TR_KEY.finditer(src):
        key = m.group(1)
        assert "\\" not in key, f"{name}: no escape sequences in tr() texts: {key}"
        assert key in I18N_EN, f"{name}: no English text in workflows/src/i18n-en.json for: {key}"
        assert sorted(PLACEHOLDER.findall(key)) == sorted(PLACEHOLDER.findall(I18N_EN[key])), f"placeholders differ: {key}"
        if key not in keys:
            keys.append(key)
    if not keys:
        return src
    i18n_used.update(keys)
    # Config czyta język wprost ze zlecenia panelu, pozostałe węzły – z wyniku Config
    lang = ("$('Start: zlecenie z panelu').first().json.body.config.lang" if name == "Config"
            else "$('Config').first().json.lang")
    prelude = TR_PRELUDE % (lang, json.dumps({k: I18N_EN[k] for k in keys}, ensure_ascii=False, indent=2))
    # po komentarzu z opisem węzła (pierwsze linie //), żeby w edytorze n8n opis był na górze
    lines = src.split("\n")
    head = 0
    while head < len(lines) and lines[head].startswith("//"):
        head += 1
    return "\n".join(lines[:head] + [prelude] + lines[head:])


def code_node(name, pos, src, **extra):
    return add(base(name, "n8n-nodes-base.code", 2, pos, {"jsCode": with_i18n(name, code(src))}, **extra))


def http(name, pos, method, url, *, query=None, json_body=None, multipart=None,
         form=None, headers=None, binary_body=None, file_response=False, panel=True,
         timeout=60000, on_error=None, retry=None, always=False, notes=None, execute_once=False):
    p = {"method": method, "url": "=" + url if "{{" in url else url}
    creds = None
    # panel=True → zapytanie do panelu (bramka / API wewnętrzne) z tokenem PANEL_INTERNAL_TOKEN
    headers = ([TOKEN_HEADER] if panel else []) + list(headers or [])
    if headers:
        p["sendHeaders"] = True
        p["headerParameters"] = {"parameters": [{"name": k, "value": v} for k, v in headers]}
    if binary_body:
        p["sendBody"] = True
        p["contentType"] = "binaryData"
        p["inputDataFieldName"] = binary_body
    if query:
        p["sendQuery"] = True
        p["queryParameters"] = {"parameters": [{"name": k, "value": v} for k, v in query]}
    if json_body is not None:
        p["sendBody"] = True
        p["specifyBody"] = "json"
        p["jsonBody"] = json_body
    if multipart is not None:
        p["sendBody"] = True
        p["contentType"] = "multipart-form-data"
        params = []
        for k, v in multipart:
            if isinstance(v, tuple) and v[0] == "binary":
                params.append({"parameterType": "formBinaryData", "name": k, "inputDataFieldName": v[1]})
            else:
                params.append({"parameterType": "formData", "name": k, "value": v})
        p["bodyParameters"] = {"parameters": params}
    if form is not None:
        p["sendBody"] = True
        p["contentType"] = "form-urlencoded"
        p["bodyParameters"] = {"parameters": [{"name": k, "value": v} for k, v in form]}
    p["options"] = {"timeout": timeout}
    if file_response:
        p["options"]["response"] = {"response": {"responseFormat": "file"}}
    extra = {}
    if creds:
        extra["credentials"] = creds
    if on_error:
        extra["onError"] = on_error
    if retry:
        extra.update({"retryOnFail": True, "maxTries": retry[0], "waitBetweenTries": retry[1]})
    if always:
        extra["alwaysOutputData"] = True
    if notes:
        extra.update({"notes": notes, "notesInFlow": True})
    if execute_once:
        extra["executeOnce"] = True
    return add(base(name, "n8n-nodes-base.httpRequest", 4.2, pos, p, **extra))


def if_node(name, pos, left, operator, right=""):
    op = {
        "eq": {"type": "string", "operation": "equals"},
        "not_starts": {"type": "string", "operation": "notStartsWith"},
        "true": {"type": "boolean", "operation": "true", "singleValue": True},
        "false": {"type": "boolean", "operation": "false", "singleValue": True},
    }[operator]
    params = {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
            "conditions": [{"id": uid(name + ":cond"), "leftValue": left, "rightValue": right, "operator": op}],
            "combinator": "and",
        },
        "looseTypeValidation": True,
        "options": {},
    }
    return add(base(name, "n8n-nodes-base.if", 2.2, pos, params))


def read_file(name, pos, selector):
    return add(base(name, "n8n-nodes-base.readWriteFile", 1.1, pos,
                    {"operation": "read", "fileSelector": selector, "options": {}}))


def write_file(name, pos, file_name, prop):
    return add(base(name, "n8n-nodes-base.readWriteFile", 1.1, pos,
                    {"operation": "write", "fileName": file_name, "dataPropertyName": prop, "options": {}}))


def connect(src, dst, out=0):
    outs = connections.setdefault(src, {"main": []})["main"]
    while len(outs) <= out:
        outs.append([])
    outs[out].append({"node": dst, "type": "main", "index": 0})


def chain(*names):
    for a, b in zip(names, names[1:]):
        connect(a, b)


# ------------------------------------------------------------------------------------------------
# Triggers + Config
# ------------------------------------------------------------------------------------------------
Y_GEN, Y_PUB, Y_ERR = 200, 1200, 1900

t_hook = add(base("Start: zlecenie z panelu", "n8n-nodes-base.webhook", 2, (0, 600), {
    "httpMethod": "POST",
    "path": "poster",
    "responseMode": "responseNode",
    "options": {},
}, webhookId=uid("poster webhook")))
TOKEN_OK = "!!$env.PANEL_INTERNAL_TOKEN && $json.headers['x-poster-token'] === $env.PANEL_INTERNAL_TOKEN"
respond = add(base("Odpowiedz panelowi", "n8n-nodes-base.respondToWebhook", 1.1, (220, 600), {
    "respondWith": "json",
    "responseBody": "={{ JSON.stringify({ ok: " + TOKEN_OK + ", executionId: $execution.id }) }}",
    "options": {},
}))
token_if = if_node("Token panelu poprawny?", (440, 600), "={{ " + TOKEN_OK + " }}", "true")
cfg = code_node("Config", (660, 600), "config")
mode_if = if_node("Zlecenie: publikacja?", (880, 600), "={{ $json.mode }}", "eq", "publish")
# własny post z panelu (✍️ Nowy post): teksty gotowe – bez źródeł i bez AI w workflow
compose_if = if_node("Zlecenie: własny post?", (1100, 600), "={{ $json.mode }}", "eq", "compose")
chain(t_hook, respond, token_if)
connect(token_if, cfg, out=0)
connect(cfg, mode_if)
connect(mode_if, compose_if, out=1)
START = [t_hook, respond, token_if, cfg, mode_if, compose_if]

# ------------------------------------------------------------------------------------------------
# 1) Sources → dedup
# ------------------------------------------------------------------------------------------------
x0 = 1180
src = code_node("Lista źródeł", (x0, Y_GEN), "sources")
rss = add(base("Pobierz RSS", "n8n-nodes-base.rssFeedRead", 1.2, (x0 + 220, Y_GEN),
               {"url": "={{ $json.url }}", "options": {"customFields": "media:content,media:thumbnail,media:group"}},
               onError="continueRegularOutput", alwaysOutputData=True))
norm = code_node("Normalizuj RSS", (x0 + 440, Y_GEN), "normalize_rss")
apify_if = if_node("X przez Apify?", (x0 + 660, Y_GEN), "={{ " + CFG + ".xSource }}", "eq", "apify")
apify = http(
    "Apify: pobierz tweety", (x0 + 880, Y_GEN - 180), "POST",
    GW + "/apify/v2/acts/{{ " + CFG + ".apify.actorId }}/run-sync-get-dataset-items",
    query=[("timeout", "240")],
    json_body="={{ JSON.stringify({ twitterHandles: " + CFG + ".xHandles, maxItems: " + CFG
              + ".apify.maxItems, sort: 'Latest' }) }}",
    timeout=300000, on_error="continueRegularOutput", always=True,
)
norm_apify = code_node("Normalizuj Apify", (x0 + 1100, Y_GEN - 180), "normalize_apify")
fresh = code_node("Filtruj świeże", (x0 + 1320, Y_GEN), "filter_fresh")
dedup = http(
    "Deduplikacja w panelu (URL/ID)", (x0 + 1540, Y_GEN), "POST",
    "{{ " + CFG + ".panelUrl }}/internal/bots/{{ " + CFG + ".botId }}/candidates",
    json_body="={{ JSON.stringify($json) }}", timeout=30000, retry=(3, 3000),
)
connect(compose_if, src, out=1)
chain(src, rss, norm, apify_if)
connect(apify_if, apify, out=0)
connect(apify, norm_apify)
connect(norm_apify, fresh)
connect(apify_if, fresh, out=1)
chain(fresh, dedup)

# ------------------------------------------------------------------------------------------------
# 2) LLM
# ------------------------------------------------------------------------------------------------
x1 = x0 + 1880
prompt = code_node("Przygotuj prompt LLM", (x1, Y_GEN), "build_prompt")
# Panel wysyła zapytanie do dostawcy tekstu wybranego w bocie
llm = http(
    "AI: wybierz news i napisz posty", (x1 + 440, Y_GEN + 100), "POST",
    "{{ " + CFG + ".panelUrl }}/internal/bots/{{ " + CFG + ".botId }}/llm",
    json_body="={{ JSON.stringify($json.llm) }}",
    timeout=1200000, retry=(2, 10000),
)
parse = code_node("Parsuj odpowiedź LLM", (x1 + 660, Y_GEN), "parse_llm")
# własny post: draft z tekstów z panelu, w tym samym formacie co „Parsuj odpowiedź LLM”
own = code_node("Post własny: przygotuj", (x1 + 660, Y_GEN + 260), "compose")
chain(dedup, prompt, llm, parse)
connect(compose_if, own, out=0)

# ------------------------------------------------------------------------------------------------
# 3) Grafika: panel szuka zdjęcia w artykule (bez zdjęcia – post z linkiem) wg ustawień bota
# ------------------------------------------------------------------------------------------------
x2 = x1 + 1000
PARSED = "$('Parsuj odpowiedź LLM').first().json"
# compose = grafika własnego posta (zdjęcie wgrane w panelu…); w draftach z newsów pole jest puste
img_req = http(
    "Grafika: panel", (x2, Y_GEN), "POST",
    "{{ " + CFG + ".panelUrl }}/internal/bots/{{ " + CFG + ".botId }}/image",
    json_body="={{ JSON.stringify({ news: { url: $json.news.url, title: $json.news.title, images: $json.news.images }, "
              "compose: $json.composeImage }) }}",
    timeout=300000, retry=(2, 10000), on_error="continueRegularOutput",
)
extract = code_node("Grafika: przygotuj", (x2 + 220, Y_GEN), "prepare_image")
has_img_if = if_node("Jest grafika?", (x2 + 440, Y_GEN), "={{ $json.hasImage }}", "true")
save_img = write_file("Zapisz grafikę na dysku", (x2 + 660, Y_GEN - 100),
                      "={{ " + CFG + ".storageDir }}/{{ $json.image.file }}", "data")
save_draft = write_file("Zapisz draft na dysku", (x2 + 880, Y_GEN),
                        "={{ " + CFG + ".storageDir }}/{{ $json.draftId }}.json", "draft")
connect(parse, img_req)
connect(own, img_req)
chain(img_req, extract, has_img_if)
connect(has_img_if, save_img, out=0)
connect(has_img_if, save_draft, out=1)
connect(save_img, save_draft)

# ------------------------------------------------------------------------------------------------
# 4) Telegram package (HITL)
# ------------------------------------------------------------------------------------------------
x3 = x2 + 1320
IMGP = "$('Grafika: przygotuj').first().json"
tg_head_if = if_node("Telegram: ze zdjęciem?", (x3 - 220, Y_GEN), "={{ " + IMGP + ".hasImage }}", "true")
tg_photo = http(
    "Telegram: wyślij grafikę", (x3, Y_GEN - 100), "POST", TG + "/sendPhoto",
    multipart=[
        ("chat_id", "={{ " + CFG + ".telegram.chatId }}"),
        ("photo", ("binary", "data")),
        ("caption", "={{ " + IMGP + ".telegram.caption }}"),
        ("parse_mode", "HTML"),
    ],
    timeout=120000, retry=(3, 5000),
)
tg_head = http(
    "Telegram: wyślij nagłówek", (x3, Y_GEN + 100), "POST", TG + "/sendMessage",
    json_body="={{ JSON.stringify({ chat_id: " + CFG + ".telegram.chatId, text: " + IMGP + ".telegram.caption, "
              "parse_mode: 'HTML', link_preview_options: { is_disabled: true } }) }}",
    retry=(3, 5000),
)
tg_prep = code_node("Telegram: przygotuj teksty", (x3 + 220, Y_GEN), "tg_texts")
TGP = "$('Telegram: przygotuj teksty').first().json"
tg_posts = http("Telegram: wyślij teksty postów", (x3 + 440, Y_GEN), "POST", TG + "/sendMessage",
                json_body="={{ JSON.stringify(" + TGP + ".posts) }}", retry=(3, 5000))
tg_script = http("Telegram: wyślij skrypt i przyciski", (x3 + 660, Y_GEN), "POST", TG + "/sendMessage",
                 json_body="={{ JSON.stringify(" + TGP + ".script) }}", retry=(3, 5000))
# auto = publikacja od razu (Config.autoPublish): tryb automatyczny bota albo własny post z „Publikuj teraz”
DRAFT_EVENT = ("={{ JSON.stringify({ type: 'draft', runId: " + CFG + ".runId, botId: " + CFG + ".botId, "
               "draftId: " + IMGP + ".draftId, title: " + IMGP + ".news.title, "
               "image: (" + IMGP + ".image || {}).source || 'none', auto: " + CFG + ".autoPublish === true }) }}")
rep_draft = http("Panel: zgłoś draft", (x3 + 880, Y_GEN), "POST", "{{ " + CFG + ".panelUrl }}/internal/events",
                 json_body=DRAFT_EVENT, timeout=15000, on_error="continueRegularOutput")
auto_if = if_node("Publikować bez akceptacji?", (x3 + 1100, Y_GEN), "={{ " + CFG + ".autoPublish === true }}", "true")
connect(save_draft, tg_head_if)
connect(tg_head_if, tg_photo, out=0)
connect(tg_head_if, tg_head, out=1)
connect(tg_photo, tg_prep)
connect(tg_head, tg_prep)
chain(tg_prep, tg_posts, tg_script, rep_draft, auto_if)

# ------------------------------------------------------------------------------------------------
# 5) Publication chain: X → Facebook → report
# ------------------------------------------------------------------------------------------------
DRAFT = "$('Parsuj draft').first().json"
IMG = "={{ " + CFG + ".storageDir }}/{{ " + DRAFT + ".image.file }}"
xp = x0
ctx = code_node("Kontekst publikacji", (xp, Y_PUB), "publish_context")
rd_draft = read_file("Wczytaj draft", (xp + 220, Y_PUB), "={{ " + CFG + ".storageDir }}/{{ $json.draftId }}.json")
pdraft = code_node("Parsuj draft", (xp + 440, Y_PUB), "parse_draft")
done_if = if_node("Już opublikowany?", (xp + 660, Y_PUB), "={{ $json.alreadyPublished }}", "true")
tg_done = http(
    "Telegram: już opublikowany", (xp + 880, Y_PUB - 220), "POST", TG + "/sendMessage",
    json_body="={{ JSON.stringify({ chat_id: $('Kontekst publikacji').first().json.chatId, "
              "text: $json.alreadyPublishedText }) }}",
    on_error="continueRegularOutput",
)
rep_done = http("Panel: zgłoś (już opublikowany)", (xp + 1100, Y_PUB - 220), "POST", "{{ " + CFG + ".panelUrl }}/internal/events",
                json_body="={{ JSON.stringify({ type: 'publish', runId: " + CFG + ".runId, botId: " + CFG + ".botId, "
                          "draftId: $('Parsuj draft').first().json.draftId, status: 'published', "
                          "results: $('Parsuj draft').first().json.results }) }}",
                timeout=15000, on_error="continueRegularOutput")
connect(auto_if, ctx, out=0)
connect(mode_if, ctx, out=0)
chain(ctx, rd_draft, pdraft, done_if)
connect(done_if, tg_done, out=0)
connect(tg_done, rep_done)

# X
x_if = if_node("X włączony?", (xp + 880, Y_PUB), "={{ " + DRAFT + ".todo.x }}", "true")
x_img_if = if_node("X: z grafiką?", (xp + 1100, Y_PUB - 120), "={{ " + DRAFT + ".xWithImage }}", "true")
x_rd = read_file("X: wczytaj grafikę", (xp + 1320, Y_PUB - 240), IMG)
x_up = http("X: upload grafiki", (xp + 1540, Y_PUB - 240), "POST", GW + "/x/2/media/upload",
            multipart=[("media", ("binary", "data")), ("media_category", "tweet_image")],
            timeout=120000, on_error="continueRegularOutput")
# bez grafiki (tryb „link” albo brak zdjęcia) – tekst z linkiem do artykułu, X pokaże kartę z podglądem
x_post = http(
    "X: opublikuj post", (xp + 1540, Y_PUB - 60), "POST", GW + "/x/2/tweets",
    json_body="={{ JSON.stringify(Object.assign({ text: " + DRAFT + ".xText }, "
              "(" + DRAFT + ".xWithImage && $json.data && $json.data.id) ? { media: { media_ids: [String($json.data.id)] } } : {})) }}",
    on_error="continueRegularOutput",
)
connect(done_if, x_if, out=1)
connect(x_if, x_img_if, out=0)
connect(x_img_if, x_rd, out=0)
connect(x_img_if, x_post, out=1)
chain(x_rd, x_up, x_post)

# Facebook
fb_if = if_node("Facebook włączony?", (xp + 1760, Y_PUB), "={{ " + DRAFT + ".todo.facebook }}", "true")
fb_img_if = if_node("FB: z grafiką?", (xp + 1980, Y_PUB - 120), "={{ " + DRAFT + ".fbWithImage }}", "true")
fb_rd = read_file("FB: wczytaj grafikę", (xp + 2200, Y_PUB - 240), IMG)
fb_post = http(
    "Facebook: opublikuj post", (xp + 2420, Y_PUB - 240), "POST",
    GRAPH + "/{{ " + CFG + ".meta.pageId }}/photos",
    multipart=[("source", ("binary", "data")), ("message", "={{ " + DRAFT + ".post_fb_insta }}"),
               ("published", "true")],
    timeout=120000, on_error="continueRegularOutput",
)
fb_feed = http(
    "Facebook: opublikuj tekst/link", (xp + 2420, Y_PUB - 60), "POST",
    GRAPH + "/{{ " + CFG + ".meta.pageId }}/feed",
    json_body="={{ JSON.stringify(Object.assign({ message: " + DRAFT + ".post_fb_insta }, "
              + DRAFT + ".fbLink ? { link: " + DRAFT + ".fbLink } : {})) }}",
    timeout=60000, on_error="continueRegularOutput",
)
connect(x_if, fb_if, out=1)
connect(x_post, fb_if)
connect(fb_if, fb_img_if, out=0)
connect(fb_img_if, fb_rd, out=0)
connect(fb_img_if, fb_feed, out=1)
chain(fb_rd, fb_post)


# Report
XR = xp + 2860
summary = code_node("Podsumowanie publikacji", (XR, Y_PUB), "summary")
save_status = write_file("Zapisz status draftu", (XR + 220, Y_PUB),
                         "={{ " + CFG + ".storageDir }}/{{ $json.draftId }}.json", "draft")
tg_report = http("Telegram: raport", (XR + 440, Y_PUB), "POST", TG + "/sendMessage",
                 json_body="={{ JSON.stringify($('Podsumowanie publikacji').first().json.reportBody) }}",
                 on_error="continueRegularOutput")
tg_buttons = http("Telegram: aktualizuj przyciski", (XR + 660, Y_PUB), "POST", TG + "/editMessageReplyMarkup",
                  json_body="={{ JSON.stringify($('Podsumowanie publikacji').first().json.markupBody) }}",
                  on_error="continueRegularOutput")
rep_pub = http("Panel: zgłoś wynik publikacji", (XR + 880, Y_PUB), "POST", "{{ " + CFG + ".panelUrl }}/internal/events",
               json_body="={{ JSON.stringify($('Podsumowanie publikacji').first().json.panelEvent) }}",
               timeout=15000, on_error="continueRegularOutput")
connect(fb_if, summary, out=1)
connect(fb_post, summary)
connect(fb_feed, summary)
chain(summary, save_status, tg_report, tg_buttons, rep_pub)

# ------------------------------------------------------------------------------------------------
# 7) Error handling (this workflow is its own Error Workflow)
# ------------------------------------------------------------------------------------------------
err_t = add(base("Błąd workflow", "n8n-nodes-base.errorTrigger", 1, (0, Y_ERR), {}))
# Panel zapisuje błąd w historii bota i wysyła alert na Telegram
alert = http("Panel: zgłoś błąd", (240, Y_ERR), "POST", "{{ $env.POSTER_PANEL_URL || 'http://panel:7081' }}/internal/error",
             json_body="={{ JSON.stringify($json) }}", timeout=20000, retry=(3, 5000))
connect(err_t, alert)

# ------------------------------------------------------------------------------------------------
# Sticky notes – po polsku i po angielsku (nazwy węzłów zostają po polsku)
# ------------------------------------------------------------------------------------------------
pos = {n["name"]: n["position"] for n in nodes}


# Przybliżona wysokość tekstu notatki w n8n (@n8n/design-system: Inter 14 px, linia 19 px, nagłówek h2 24 px, linia
# 33 px, akapit +8 px; ok. 7,5 px na znak) z zapasem – tekst PL + EN musi się zmieścić nad węzłami
def text_height(content, width):
    per_line = max(20, int((width - 24) / 7.5))
    h = 8 + 30
    for par in content.split("\n\n"):
        for line in par.split("\n"):
            if line.startswith("## "):
                h += 33 * -(-len(line) // max(10, per_line * 7 // 12))
            else:
                h += 19 * -(-max(1, len(line)) // per_line)
        h += 8
    return h


# Treść notatki: nagłówek „PL · EN”, akapit po polsku i akapit po angielsku (tekst może mieć kilka linii)
def bi(title, pl, en):
    pl = pl if isinstance(pl, str) else "\n".join(pl)
    en = en if isinstance(en, str) else "\n".join(en)
    return f"## {title}\n🇵🇱 {pl}\n\n🇬🇧 {en}"


def sticky(key, names, content, color, head=160, pad=50, width=None, xy=None, height=None):
    xs = [pos[n][0] for n in names]
    ys = [pos[n][1] for n in names]
    w = width or (max(xs) - min(xs) + 100 + 2 * pad)
    head = max(head, text_height(content, w) - pad)
    x = xy[0] if xy else min(xs) - pad
    y = xy[1] if xy else min(ys) - pad - head
    h = height or (max(ys) - y + 100 + pad)
    nodes.append({
        "parameters": {"content": content, "height": h, "width": w, "color": color},
        "id": uid("sticky:" + key),
        "name": "Sticky Note " + key,
        "type": "n8n-nodes-base.stickyNote",
        "typeVersion": 1,
        "position": [x, y],
    })


overview = bi("🤖 Poster – autonomiczny bot newsowy · autonomous news bot (n8n)", [
    "**Sterowanie: panel http://IP_NAS:7080** – tam ustawiasz bota (temat, źródła, harmonogram, model AI, platformy), klucze API i konta X / Facebook.",
    "Panel wywołuje ten workflow webhookiem **„Start: zlecenie z panelu”** z pełną konfiguracją bota:",
    "• `generate` – wg harmonogramu bota lub „Uruchom teraz”: źródła → deduplikacja → AI (tekst) → grafika → draft na Telegram,",
    "• `publish` – po kliknięciu ✅ w Telegramie (przyciski odbiera panel): publikacja X / FB.",
    "• `compose` – ✍️ własny post z panelu (*Nowy post*): teksty na platformy są gotowe (AI dopasowało je w panelu albo to tekst autora) → grafika → draft → Telegram do akceptacji albo publikacja od razu („Publikuj teraz”).",
    "🔐 n8n nie przechowuje kluczy: tekst i grafikę zamawia **panel** (`/internal/bots/{id}/llm|image`), a zapytania do Telegrama, X, Meta i Apify idą przez **bramkę panelu** (`{gateway}/…`), która dokleja klucze właściwe dla bota. Nagłówek `x-poster-token` = `PANEL_INTERNAL_TOKEN` z `.env`.",
    "📁 Drafty (JSON + grafika) zapisują się w `data/files` na NAS-ie – panel pokazuje je w zakładce *Drafty*.",
], [
    "**Control: the panel at http://NAS_IP:7080** – there you set up the bot (topic, sources, schedule, AI model, platforms), API keys and X / Facebook accounts.",
    "The panel calls this workflow through the **“Start: zlecenie z panelu”** webhook with the full bot configuration:",
    "• `generate` – on the bot's schedule or “Run now”: sources → deduplication → AI (text) → image → draft to Telegram,",
    "• `publish` – after a ✅ click in Telegram (the panel receives the buttons): publishing to X / FB.",
    "• `compose` – ✍️ own post from the panel (*New post*): the texts for the platforms are ready (AI adapted them in the panel, or it is the author's text) → image → draft → Telegram for approval or publishing at once (“Publish now”).",
    "🔐 n8n stores no keys: the **panel** orders text and images (`/internal/bots/{id}/llm|image`), and requests to Telegram, X, Meta and Apify go through the **panel gateway** (`{gateway}/…`), which adds the bot's keys. Header `x-poster-token` = `PANEL_INTERNAL_TOKEN` from `.env`.",
    "📁 Drafts (JSON + image) are saved in `data/files` on the NAS – the panel shows them in the *Drafts* tab.",
    "Node names are in Polish.",
])
overview_h = text_height(overview, 1150)
sticky("overview", [], overview, 7, xy=(-40, -120 - overview_h), width=1150, height=overview_h)

sticky("start", START, bi("▶️ Zlecenie z panelu · Job from the panel", [
    "Odpowiedź od razu zwraca panelowi ID wykonania (link w historii bota). Zlecenia bez poprawnego tokenu są ignorowane. Własny post (`compose`) omija źródła i AI.",
], [
    "The response returns the execution ID to the panel at once (a link in the bot's history). Jobs without a valid token are ignored. An own post (`compose`) skips the sources and AI.",
]),
       5, head=140, height=290)  # niższa notatka – nie nachodzi na notatkę publikacji
sticky("sources", [src, rss, norm, apify_if, apify, norm_apify, fresh, dedup], bi("1️⃣ Źródła + deduplikacja · Sources + deduplication", [
    "RSS portali i **profile X przez RSSHub** (wymaga `TWITTER_AUTH_TOKEN` w `.env`) lub **Apify**.",
    "**Deduplikacja** jest w panelu (reset: panel → bot → Zaawansowane). Tweet → `x:<id>`, artykuł → URL bez `utm_*`.",
], [
    "News site RSS feeds and **X profiles via RSSHub** (needs `TWITTER_AUTH_TOKEN` in `.env`) or **Apify**.",
    "**Deduplication** happens in the panel (reset: panel → bot → Advanced). Tweet → `x:<id>`, article → URL without `utm_*`.",
]),
       4)
sticky("llm", [prompt, llm, parse, own], bi(
    "2️⃣ AI: tekst · text (JSON Schema)",
    "Panel (`/internal/bots/{id}/llm`) wysyła zapytanie do dostawcy wybranego w bocie – **Gemini** albo API zgodnego z OpenAI (np. **Ollama**). AI wybiera 1 news i pisze `post_x`, `post_fb_insta` i `script_tiktok`. Limity (X 280 zn., FB/IG 2200 zn./30 #) pilnowane w kodzie. **✍️ Własny post**: *Post własny: przygotuj* składa draft z tekstów z panelu (AI dopasowało je już w edytorze).",
    "The panel (`/internal/bots/{id}/llm`) sends the request to the provider chosen in the bot – **Gemini** or an OpenAI-compatible API (e.g. **Ollama**). AI picks 1 story and writes `post_x`, `post_fb_insta` and `script_tiktok`. Limits (X 280 chars, FB/IG 2200 chars/30 #) are enforced in code. **✍️ Own post**: *Post własny: przygotuj* builds the draft from the texts sent by the panel (AI already adapted them in the editor)."),
       5)
sticky("image", [img_req, extract, has_img_if, save_img, save_draft], bi(
    "3️⃣ Grafika (wg trybu bota) · Image (by the bot's mode)",
    "Panel (`/internal/bots/{id}/image`): **📷 zdjęcie ze źródła** (RSS / og:image artykułu / tweet) albo **bez grafiki**. Tryb **🔗 link** i draft bez zdjęcia: X i FB dostają link z podglądem.",
    "The panel (`/internal/bots/{id}/image`): **📷 photo from the source** (RSS / the article's og:image / tweet) or **no image**. **🔗 Link** mode and a draft without a photo: X and FB get a link with a preview."),
       6)
sticky("telegram", [tg_head_if, tg_photo, tg_head, tg_prep, tg_posts, tg_script, rep_draft, auto_if], bi(
    "4️⃣ Telegram (akceptacja + backup · approval + backup)",
    "Grafika (albo sam nagłówek) → teksty postów → skrypt TikTok z przyciskami ✅/❌ (**po kolei**, przyciski zawsze pod ostatnią wiadomością). Publikacja startuje po kliknięciu ✅ (własny post z „Publikuj teraz” – od razu); grafikę i teksty możesz też wrzucić ręcznie na Instagram i TikTok.",
    "Image (or just the header) → post texts → TikTok script with the ✅/❌ buttons (**one by one**, so the buttons are always under the last message). Publishing starts after a ✅ click (an own post with “Publish now” – at once); you can also post the image and texts to Instagram and TikTok by hand."),
       3)
sticky("publish", [ctx, rd_draft, pdraft, done_if, tg_done, rep_done, x_if, x_img_if, x_rd, x_up, x_post, fb_if, fb_img_if, fb_rd,
                   fb_post, fb_feed], bi("5️⃣ Publikacja · Publishing: X → Facebook", [
    "**X**: `POST /2/media/upload` + `POST /2/tweets` (token konta X bota odświeża panel). **FB**: `POST /{page}/photos` (plik binarny). Bez grafiki / tryb link: X – tekst z linkiem, FB – `POST /{page}/feed` z `link`.",
    "Błąd jednej platformy nie blokuje drugiej; raport w Telegramie ma przycisk 🔁 „Ponów nieudane” (bez dublowania udanych).",
], [
    "**X**: `POST /2/media/upload` + `POST /2/tweets` (the panel refreshes the bot's X account token). **FB**: `POST /{page}/photos` (binary file). No image / link mode: X – text with a link, FB – `POST /{page}/feed` with `link`.",
    "An error on one platform does not block the other; the Telegram report has a 🔁 “Retry failed” button (successful ones are not repeated).",
]),
       2, head=200)
REPORT_TITLE = "6️⃣ Raport · Report"
sticky("report", [summary, save_status, tg_report, tg_buttons, rep_pub], bi(
    REPORT_TITLE,
    "Wyniki platform → plik draftu + wiadomość w Telegramie (🔁 ponawia tylko nieudane) + historia w panelu.",
    "Platform results → draft file + Telegram message (🔁 retries only the failed ones) + history in the panel."),
       2, head=140)
sticky("errors", [err_t, alert], bi(
    "❗ Błędy · Errors",
    "Workflow jest swoim własnym *Error Workflow* – panel zapisuje błąd w historii bota i wysyła alert na Telegram.",
    "The workflow is its own *Error Workflow* – the panel saves the error in the bot's history and sends a Telegram alert."),
       1, head=120)

workflow = {
    "id": WORKFLOW_ID,
    "name": "Poster – newsy → LLM → grafika → social media",
    "nodes": nodes,
    "connections": connections,
    "active": False,
    "settings": {
        "executionOrder": "v1",
        "saveManualExecutions": True,
        "saveDataErrorExecution": "all",
        "saveDataSuccessExecution": "all",
        "callerPolicy": "workflowsFromSameOwner",
        "errorWorkflow": WORKFLOW_ID,
    },
    "pinData": {},
    "meta": {"templateCredsSetupCompleted": True},
    "tags": [],
}

# ------------------------------------------------------------------------------------------------
# Sanity checks
# ------------------------------------------------------------------------------------------------
names = [n["name"] for n in nodes]
assert len(names) == len(set(names)), "duplicate node names"
for s, outs in connections.items():
    assert s in names, s
    for branch in outs["main"]:
        for c in branch:
            assert c["node"] in names, c["node"]


def walk(v):
    if isinstance(v, dict):
        for x in v.values():
            yield from walk(x)
    elif isinstance(v, list):
        for x in v:
            yield from walk(x)
    elif isinstance(v, str):
        yield v


for n in nodes:
    if n["type"] in ("n8n-nodes-base.code", "n8n-nodes-base.stickyNote"):
        continue
    for s in walk(n["parameters"]):
        if not s.startswith("="):
            continue
        # every {{ must be closed by the very next }} (no "}}" inside an expression)
        for m in re.finditer(r"\{\{(.*?)\}\}", s, re.S):
            assert "{{" not in m.group(1), (n["name"], m.group(0))
        assert s.count("{{") == s.count("}}"), (n["name"], s)
# every English text in i18n-en.json must still be used by some Code node (in PRO or LITE)
lite_used = set()
for f in sorted((HERE / "code").rglob("*.js")):
    if "pro" in f.relative_to(HERE / "code").parts:
        continue
    for m in TR_KEY.finditer(edition_view(f.read_text(encoding="utf-8"), "lite", str(f))):
        assert m.group(1) in I18N_EN, f"LITE {f.name}: no English text in workflows/src/i18n-en.json for: {m.group(1)}"
        lite_used.add(m.group(1))
unused = sorted(set(I18N_EN) - i18n_used - lite_used)
assert not unused, f"unused texts in workflows/src/i18n-en.json: {unused}"
# node references inside code / expressions must exist
for s in walk([n["parameters"] for n in nodes]):
    for ref in re.findall(r"\$\('([^']+)'\)", s):
        assert ref in names, f"unknown node reference: {ref}"

OUT.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {OUT} ({len(nodes)} nodes)")
