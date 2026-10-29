# Poster 🤖📰

🇬🇧 [English](README.md) · 🇵🇱 **Polski**

**Poster LITE** – darmowa, otwarta (AGPL) automatyzacja social mediów na NAS-ie lub serwerze, działająca 24/7:
**panel sterowania WWW** + **n8n (Community Edition)** w Dockerze.
Bot zbiera najświeższe wiadomości z kanałów RSS, Google News i profili X, a AI (Google Gemini albo model na Twoim
sprzęcie, np. Ollama) wybiera najważniejszą i pisze posty. Grafika to **zdjęcie z artykułu** (0 zł), a gdy go brak –
post z linkiem. Pakiet trafia na **Telegram** z przyciskami ✅/❌. Po akceptacji bot publikuje na **X i Facebooku**,
a grafikę, tekst i skrypt wideo z draftu wrzucisz ręcznie na Instagram i TikTok.

Możesz też w każdej chwili **napisać własny post** (*✍️ Nowy post* w panelu): AI dopasuje go do X i Facebooka, a Ty
poprawiasz wersje i publikujesz od razu albo po akceptacji w Telegramie ([„📣 Własny post”](#-własny-post)).

Wszystko ustawiasz w panelu **`http://IP_NAS:7080`**, bez SSH i bez edycji `.env`:
- bota (temat, źródła, pauza, „Uruchom teraz”);
- harmonogram („co 4 h od 8 do 20”, „o 9:05, 13:05 i 18:05 w dni robocze”);
- model AI, klucze API i konta X i Facebook.

> ⭐ **Wersja PRO** dodaje wiele botów, tryb strony/bloga, bota kanału YouTube, Instagram, Threads, Bluesky, kanał Telegram, TikTok z wideo, grafikę
> marki, planowanie własnych postów (także cyklicznych) z kalendarzem treści, autopilot (publikację newsów bez akceptacji) i kolejnych
> dostawców AI z dostawcą zapasowym –
> [porównanie wersji](#-wersja-pro) i [strona produktu](https://posterapp.pl/).

**Instalacja** to jedno polecenie wklejone przez SSH na NAS-ie z Dockerem albo serwerze z Linuksem – na czystym Ubuntu i Debianie instalator sam zainstaluje Dockera: `curl -fsSL https://posterapp.pl/install.sh | sudo bash`
(szczegóły: [„🚀 Instalacja jednym poleceniem”](#-instalacja-jednym-poleceniem)).

![Pulpit Postera: karta bota, stan usług i ostatnie działania](docs/img/lite-dashboard-pl.webp)

```mermaid
flowchart LR
  subgraph NAS["NAS / serwer · Docker"]
    subgraph panel["Panel :7080"]
      UI["🖥️ Panel WWW<br/>bot · harmonogram · konta"]
      SCH["⏰ Harmonogram"]
      TGP["📥 Przyciski ✅/❌<br/>Telegram long-poll"]
      GW["🔐 Bramka API + router AI<br/>dokleja klucze bota"]
    end
    subgraph n8n["n8n · workflow Poster"]
      G["Źródła → deduplikacja → AI → zdjęcie → draft"]
      P["Publikacja X → FB → raport"]
    end
    RSSHub["RSSHub<br/>X → RSS"]
  end
  SCH == "zlecenie generate" ==> G
  TGP == "zlecenie publish" ==> P
  G & P == "zapytania API" ==> GW
  GW ==> API["Gemini · Ollama · API zgodne z OpenAI<br/>Telegram · X · Meta"]
  RSSHub ==> G
```

| Element | Rozwiązanie |
|---|---|
| Panel sterowania | Własny kontener `poster-panel` (Node.js, bez bibliotek i CDN), interfejs po polsku i angielsku, hasło, tryb jasny/ciemny, działa na telefonie |
| Bot | Temat, język postów, wytyczne dla AI, źródła, harmonogram, model AI, platformy i własne konta X / Facebook |
| Harmonogram | W panelu: co N godzin w oknie od–do albo wybrane godziny, minuta, dni tygodnia; pauza; „Uruchom teraz” |
| Własny post | Panel → *✍️ Nowy post*: Twój tekst (+ link, zdjęcie z dysku lub aparatu) → AI pisze wersje na X i Facebooka (albo tekst bez AI) → poprawiasz → akceptacja w Telegramie albo **Publikuj teraz** |
| Klucze i tokeny | Tylko w panelu (`data/panel/secrets.json`, chmod 600). n8n **nie przechowuje żadnych kluczy**: woła API przez bramkę panelu, która dokleja klucze i sama odświeża token X |
| Odczyt X bez płatnego API | **RSSHub** (self-hosted, ciasteczko `auth_token` z osobnego konta) → kanał RSS. Alternatywy: Apify, Nitter |
| Deduplikacja | W panelu: klucz `x:<id tweeta>` lub URL bez `utm_*`, do tego filtr tych samych tytułów i lista ostatnich tematów przekazywana do LLM |
| Tekst (AI) | **Gemini** albo dowolne API zgodne z OpenAI, np. **Ollama** na Twoim sprzęcie. Zawsze czysty JSON wg schematu: `post_x`, `post_fb_insta`, `script_tiktok` |
| Grafika | Tryb w bocie: **📷 zdjęcie z artykułu** (RSS / og:image / tweet), **🔗 post z linkiem** albo **🚫 bez grafiki**. Gdy artykuł nie ma zdjęcia, X i Facebook dostają post z linkiem |
| Koszty | Karta „Koszt jednego posta”: tekst AI i publikacja na X. Grafika zawsze kosztuje 0 zł |
| Human-in-the-Loop | Bot Telegrama z przyciskami. Panel **odpytuje** Telegram (long-polling), więc kliknięcie działa od razu, a **NAS nie musi być wystawiony do internetu** |
| Publikacja | X API v2 (OAuth2 + `media.write`), Meta Graph API (FB `/{page}/photos` albo `/{page}/feed`). Instagram i TikTok: grafika, teksty i skrypt wideo w drafcie do ręcznej publikacji |
| Archiwum | Każdy draft (JSON + grafika) zapisuje się w `data/files` na NAS-ie; panel pokazuje galerię draftów |

## ⭐ Wersja PRO

Poster LITE jest darmowy i otwarty (AGPL). Wersja PRO to ten sam program z dodatkowymi funkcjami:

| Funkcja | LITE | PRO |
|---|:---:|:---:|
| Boty | 1 | bez limitu, z kopią ustawień i osobnym czatem Telegram |
| Źródła: RSS, Google News, profile X (RSSHub / Apify) | ✅ | ✅ |
| Harmonogram, pauza, „Uruchom teraz” | ✅ | ✅ |
| Akceptacja draftów w Telegramie | ✅ | ✅ |
| Publikacja newsów bez akceptacji (autopilot) | – | ✅ |
| Własny post: AI dopasowuje Twój tekst do platform, „Publikuj teraz” | X i Facebook | X, Facebook, Instagram, Threads, Bluesky, kanał Telegram, TikTok |
| Planowanie własnych postów na dzień i godzinę, kilka botów naraz | – | ✅ |
| Posty cykliczne (seria) z nową wersją tekstu od AI przed każdą powtórką, kalendarz treści | – | ✅ |
| Post z telefonu: `/post` w Telegramie – AI dopasowuje tekst, draft wraca z ✅/❌ | – | ✅ |
| X i Facebook | ✅ | ✅ |
| Instagram | ręcznie | ✅ |
| Threads i Bluesky (tekst, zdjęcie, karta linku) | – | ✅ |
| Kanał Telegram (zdjęcie z podpisem albo post z podglądem linku) | – | ✅ |
| TikTok: wideo z grafiki posta (animacja, 0 zł) | skrypt do ręcznego nagrania | ✅ |
| Tryb strony / bloga: każdy nowy artykuł z Twojej strony to posty | – | ✅ |
| Kanał YouTube: każdy nowy film z Twojego kanału to posty (bez logowania do YouTube) | – | ✅ |
| Tekst AI: Gemini, Ollama, własne API zgodne z OpenAI | ✅ | ✅ |
| Groq, OpenRouter, Mistral i dostawca zapasowy | – | ✅ |
| Grafika: zdjęcie z artykułu, post z linkiem | ✅ | ✅ |
| Grafika marki (gdy artykuł nie ma zdjęcia albo do każdego posta) | – | ✅ |
| Miesięczny licznik użycia AI | – | ✅ |
| Panel PL/EN, drafty, historia, alerty, koszt posta | ✅ | ✅ |

Szczegóły i cena: **[posterapp.pl](https://posterapp.pl/)**.

**Po zakupie** otwórz stronę zamówienia (przycisk *Access purchase* w e-mailu od Polara), skopiuj klucz licencyjny, wklej
go w panelu (*Ustawienia → Wersja PRO*) i kliknij *Sprawdź klucz*. Panel sprawdzi go i pokaże jedno polecenie do uruchomienia przez SSH – boty, klucze i historia zostają bez zmian:

```bash
sudo bash scripts/upgrade-to-pro.sh
```

Skrypt bierze klucz z panelu (gdy go tam nie ma – pyta o niego), aktywuje licencję na tym NAS-ie, czeka na dostęp do
repozytorium PRO (zwykle kilka minut) i przełącza instalację na PRO. Gdy dostęp nie jest jeszcze gotowy, uruchom skrypt ponownie za
kilka minut – nie zajmie drugiego urządzenia. Licencja obejmuje 2 urządzenia i 12 miesięcy aktualizacji; potem
zainstalowana wersja działa dalej, a przedłużenie licencji przywraca aktualizacje.

**Zwrot.** W ciągu 14 dni od zakupu możesz zwrócić licencję bez podania przyczyny, dopóki jej nie aktywujesz –
aktywuje ją dopiero `upgrade-to-pro.sh` (sprawdzenie klucza w panelu nie). Napisz na kontakt@posterapp.pl.
Szczegóły: [warunki licencji PRO](https://posterapp.pl/license.html?lang=pl).

## Zawartość repozytorium

```
poster/
├── docker-compose.yml          # panel + n8n + RSSHub, wolumeny, strefa czasowa, healthcheck
├── .env.example                # szablon: IP NAS-a, porty, strefa czasowa, klucze generowane automatycznie
├── README.md · README.pl.md        # opis po angielsku i po polsku
├── CHANGELOG.md · CHANGELOG.pl.md  # historia zmian i ewentualne kroki ręczne przy aktualizacji
├── SECURITY.md · CONTRIBUTING.md   # zgłaszanie podatności, zasady współpracy (po polsku: *.pl.md)
├── CLA.md · LICENSE                # umowa dla współtwórców, licencja GNU AGPL v3
├── .github/workflows/ci.yml    # automatyczne testy (GitHub Actions)
├── docs/                       # instalator (install.sh), dodatkowe instrukcje (deploy key), zrzuty ekranu, strona produktu
├── panel/                      # panel sterowania (Node.js, Dockerfile, bez zależności npm)
│   ├── server.js · lib/        # API, harmonogram, bramka API, router AI, grafika, Telegram, konta OAuth
│   ├── public/                 # interfejs WWW
│   └── test/                   # testy: node --test panel/test/*.test.js
├── workflows/
│   ├── poster_workflow.json    # workflow do importu w n8n (generowany – nie edytuj ręcznie)
│   └── src/                    # źródła workflow: build.py + code/*.js (węzły Code), validate.js
└── scripts/
    ├── init-nas.sh             # .env, klucze, katalogi data/ z właścicielem 1000:1000
    ├── import-to-n8n.sh        # import + publikacja workflow w n8n (CLI n8n)
    ├── update.sh               # aktualizacja jednym poleceniem
    ├── upgrade-to-pro.sh       # przejście z LITE na PRO po zakupie licencji
    └── setup-deploy-key.sh     # jednorazowo: pobieranie z GitHuba bez hasła/tokenu (deploy key)
```

---

## ⬆️ Aktualizacja

```bash
cd /volume1/docker/poster          # katalog projektu (na UGOS także /volume2/…, na serwerze np. /opt/poster)
sudo bash scripts/update.sh
```

`update.sh` wykonuje kolejno:
1. pobiera nową wersję z GitHuba (`git pull` w kontenerze `alpine/git`, bez instalowania gita);
2. `init-nas.sh`: uzupełnia w `.env` brakujące klucze generowane automatycznie i poprawia uprawnienia `data/`, nie zmieniając istniejących wartości;
3. `docker compose up -d --build`: przebudowuje obraz panelu i restartuje kontenery;
4. `import-to-n8n.sh`: importuje nowy workflow (to samo ID, nadpisuje stary), publikuje go i restartuje n8n.

Co się zmieniło i czy dana wersja wymaga czegoś więcej – [CHANGELOG.pl.md](CHANGELOG.pl.md).
Instalujesz z prywatnej kopii repozytorium (np. własnego forka)? Aktualizacje bez wpisywania tokenu opisuje [docs/deploy-key.pl.md](docs/deploy-key.pl.md).


---

## 🚀 Instalacja jednym poleceniem

Na NAS-ie z Dockerem i Docker Compose v2 (patrz „Krok 0”) albo serwerze z Linuksem zaloguj się przez SSH (patrz „Jak
połączyć się z NAS-em przez SSH”) i wklej:

```bash
curl -fsSL https://posterapp.pl/install.sh | sudo bash
```

Instalator po kolei:
1. sprawdza Dockera i Docker Compose v2. Na serwerze z Ubuntu albo Debianem bez Dockera instaluje go sam z oficjalnego
   repozytorium Dockera (zwykle 1–3 min). Gdy zegar serwera jest źle ustawiony (częste w maszynie wirtualnej), apt odrzuca
   listy pakietów – instalator podpowiada wtedy, jak ustawić czas;
2. pobiera Postera do folderu `docker` na NAS-ie – `/volume1/docker/poster`, a gdy ten folder jest na innym woluminie,
   np. `/volume2/docker/poster` – albo do `/opt/poster` (serwer). Inne miejsce wybierzesz opcją `--dir` (niżej). Git
   działa w kontenerze `alpine/git`, więc nie trzeba go instalować;
3. uruchamia `scripts/init-nas.sh` (`.env`, klucze, katalogi `data/`), a do nowego `.env` wpisuje adres IP NAS-a,
   strefę czasową hosta i wolne porty;
4. uruchamia kontenery (`docker compose up -d --build`) – za pierwszym razem pobiera ok. 1 GB, zwykle 3–15 min;
5. zakłada konto właściciela n8n (login `admin@poster.local`, losowe hasło), żeby nikt w Twojej sieci nie przejął n8n,
   a potem importuje i publikuje workflow (`scripts/import-to-n8n.sh`);
6. wypisuje adres panelu z jednorazowym kodem do ustawienia hasła oraz hasło do n8n – **zapisz je**, instalator
   pokazuje je tylko raz.

Dalej otwórz panel i przejdź do [Kroku 7](#krok-7-panel-hasło-klucze-pierwszy-bot): hasło, klucze i pierwszy bot.

- **Inny katalog albo język komunikatów:**
  `curl -fsSL https://posterapp.pl/install.sh | sudo bash -s -- --dir /opt/poster --lang en`.
- **Serwer z publicznym adresem IP (VPS):** instalator ustawia `BIND_ADDRESS=127.0.0.1`, a na końcu podaje polecenie
  tunelu SSH (patrz „Dostęp spoza domu i serwer w internecie”).
- **Przerwana instalacja** (np. brak internetu): uruchom to samo polecenie jeszcze raz – dokończy instalację. Gotowej
  instalacji nie zmienia, tylko podpowiada aktualizację.
- **Najpierw przeczytać skrypt:** `curl -fsSLO https://posterapp.pl/install.sh`, obejrzyj go (`less install.sh`)
  i uruchom: `sudo bash install.sh`. Bez `curl`: `wget -qO- https://posterapp.pl/install.sh | sudo bash`.

Wolisz zrobić wszystko ręcznie? Instrukcja krok po kroku jest poniżej.

---

## 🧭 Instalacja krok po kroku (NAS lub serwer z Dockerem)

> Instrukcja powstała na NAS-ie **UGREEN DXP2800 (UGOS Pro)**, więc jego menu i ścieżki (`/volume1/docker/poster`)
> służą za przykład. Na innym NAS-ie albo serwerze Linux z Dockerem i Docker Compose v2 kroki są takie same:
> podstaw swój katalog projektu (np. `/opt/poster`) i pomiń uwagi dotyczące UGOS.
> Sprawdzone na x86-64 (DXP2800 ma procesor Intel N100). Stos zużywa ok. 0,6–1,2 GB RAM.
> Nazwy menu mogą się nieznacznie różnić między wersjami UGOS Pro.

### Krok 0. Przygotowanie NAS-a lub serwera (jednorazowo)

1. **Docker z Docker Compose v2**: na UGOS *App Center (Centrum aplikacji)* → zainstaluj **Docker**. Na serwerze z Ubuntu albo Debianem zainstaluje go [instalator jednym poleceniem](#-instalacja-jednym-poleceniem), a na innym Linuksie zainstaluj Docker Engine z wtyczką `docker compose`.
2. **SSH**: na UGOS *Panel sterowania → Terminal* → włącz **SSH** (port 22). Loguj się kontem administratora.
3. **Stały adres IP**: w routerze zarezerwuj adres DHCP dla NAS-a (np. `192.168.1.50`). Tego adresu użyjesz w `NAS_IP` i w przeglądarce.
4. **Strefa czasowa**: na UGOS *Panel sterowania → Data i godzina* → `Europe/Warsaw` + synchronizacja NTP.
5. **Folder współdzielony `docker`** (UGOS): jeśli aplikacja Docker nie utworzyła go sama, dodaj go w *Menedżerze plików* lub w *Panelu sterowania → Foldery współdzielone*. Zwykle leży pod `/volume1/docker`. Numer wolumenu sprawdzisz przez SSH: `ls -d /volume*/docker`.

#### Jak połączyć się z NAS-em przez SSH
Terminal otwierasz **na swoim komputerze**, nie na NAS-ie. Po zalogowaniu każde wklejone polecenie wykonuje się już na NAS-ie.

1. Otwórz terminal na PC:
   - **Windows 10/11:** *Start* → **PowerShell** lub **Terminal**. Klient `ssh` jest wbudowany.
   - **macOS / Linux:** aplikacja **Terminal**.
2. Połącz się, podając login administratora UGOS i IP NAS-a:
   ```bash
   ssh twoj_login@192.168.1.50
   ```
   Przy pierwszym połączeniu potwierdź odcisk klucza (`yes`) i podaj hasło do konta UGOS. Znaki hasła nie są wyświetlane.
3. Znak zachęty zmieni się na np. `twoj_login@DXP2800:~$`: jesteś na NAS-ie. Wklejaj polecenia z tej instrukcji pojedynczo (w PowerShellu prawym przyciskiem myszy). `sudo` pyta o to samo hasło do konta UGOS.
4. Sesję kończysz poleceniem `exit`.

### Krok 1. Gdzie umieścić pliki projektu

Docelowa struktura:

```
/volume1/docker/poster/
├── docker-compose.yml
├── .env                         ← konfiguracja NAS-a (chmod 600)
├── panel/  workflows/  scripts/
└── data/                        ← tworzy scripts/init-nas.sh, właściciel 1000:1000
    ├── n8n/                     → n8n: /home/node/.n8n        (baza SQLite, config)
    ├── files/                   → n8n: /home/node/.n8n-files  (drafty *.json, grafiki, wideo)
    └── panel/                   → panel: /data                (boty, klucze, historia, pamięć duplikatów)
```

Pliki skopiujesz na dwa sposoby:

- **Przez SSH (zalecane; git w kontenerze, bez instalowania gita)**. Repozytorium jest publiczne, więc nie trzeba się logować:
  ```bash
  cd /volume1/docker          # lub /volume2/docker – tam, gdzie jest Twój folder docker (na serwerze np. /opt)
  sudo docker run --rm -v "$PWD":/git alpine/git clone https://github.com/imdangro/poster-app.git poster
  cd poster                   # kolejne polecenia wykonujesz w katalogu projektu
  ```
  Tak pobraną kopię zaktualizujesz jednym poleceniem (sekcja „Aktualizacja”). Instalację z prywatnej kopii
  repozytorium (np. własnego forka) opisuje [docs/deploy-key.pl.md](docs/deploy-key.pl.md).
- **Przez SMB z komputera**: pobierz repozytorium jako ZIP (GitHub → *Code → Download ZIP*), rozpakuj i skopiuj zawartość do `\\IP_NAS\docker\poster`.
  Taka kopia nie ma katalogu `.git`, więc `update.sh` nie pobierze zmian sam: przy aktualizacji skopiujesz nowe pliki
  i uruchomisz `sudo bash scripts/update.sh --no-pull`.

### Krok 2. Uprawnienia (UID/GID 1000:1000) i `.env`

Procesy n8n i panelu działają w kontenerach jako użytkownik o **UID 1000 i GID 1000**. Katalogi w `data/` muszą do niego należeć.
Inaczej w logach pojawi się np. `EACCES: permission denied` albo `SQLITE_CANTOPEN`.

```bash
cd /volume1/docker/poster
sudo bash scripts/init-nas.sh
```

Skrypt:
1. tworzy `.env` z `.env.example` (jeśli go nie ma) i ustawia mu `chmod 600`;
2. generuje `N8N_ENCRYPTION_KEY` i `PANEL_INTERNAL_TOKEN`, jeśli są puste;
3. tworzy `data/n8n`, `data/files`, `data/panel` i wykonuje `chown -R 1000:1000 data` + `chmod -R u+rwX,g+rwX,o-rwx data`.

Skrypt możesz uruchamiać wielokrotnie. Jeśli `EACCES` nadal występuje, udział może mieć restrykcyjne ACL-e UGOS.
Dodaj wtedy ACL dla UID 1000: `sudo setfacl -R -m u:1000:rwx,d:u:1000:rwx data`. Nie uruchamiaj kontenerów jako root i nie ustawiaj `chmod 777`.

Uzupełnij `.env` (`sudo nano .env`). To naprawdę wszystko, bo resztę ustawiasz w panelu:

| Zmienna | Przykład | Uwagi |
|---|---|---|
| `NAS_IP` | `192.168.1.50` | adres LAN NAS-a (linki w panelu, callback X) |
| `PANEL_PORT` | `7080` | panel sterowania |
| `N8N_PORT` | `5678` | edytor n8n |
| `TZ` | `Europe/Warsaw` | harmonogram botów i daty w postach |
| `N8N_ENCRYPTION_KEY`, `PANEL_INTERNAL_TOKEN` | *(wygenerowane)* | **zrób kopię `.env` i nigdy nie zmieniaj `N8N_ENCRYPTION_KEY`** |
| `TWITTER_AUTH_TOKEN` | `a1b2…` | dla RSSHub, gdy bot śledzi profile X (patrz „Źródło X”) |
| `RSSHUB_PROXY_URI` | puste | opcjonalne proxy tylko dla odczytu X (patrz „Źródło X”) |

### Krok 3a. Uruchomienie stosu przez SSH (zalecane)

```bash
cd /volume1/docker/poster
sudo docker compose pull              # obrazy n8n i RSSHub
sudo docker compose up -d --build     # buduje panel i startuje wszystko; restart: unless-stopped → wstaje po restarcie NAS-a
sudo docker compose ps                # poster-panel, poster-n8n: Up … (healthy), poster-rsshub: Up
```

Po zmianie `.env` lub `docker-compose.yml` wystarczy ponownie wykonać `sudo docker compose up -d --build`.

### Krok 3b. Alternatywa: aplikacja Docker w UGOS (bez konsoli)

1. Skopiuj pliki przez SMB do `docker/poster`. Plik `.env.example` zapisz jako `.env` i uzupełnij na komputerze. `N8N_ENCRYPTION_KEY` i `PANEL_INTERNAL_TOKEN` wygeneruj np. na stronie generatora haseł (min. 32 znaki, same litery i cyfry).
2. Katalogi `data/n8n`, `data/files` i `data/panel` utwórz w *Menedżerze plików*. **Uprawnienia 1000:1000 i tak ustawisz przez SSH (Krok 2)**, bo interfejs UGOS nie zmienia właściciela na UID 1000.
3. *Docker → Projekt (Project) → Utwórz (Create)*: nazwa `poster`, ścieżka `/docker/poster` (folder z `docker-compose.yml`), potem **Wdróż (Deploy)**. Compose zbuduje obraz panelu z folderu `panel/`. Jeśli Twoja wersja UGOS nie obsługuje budowania obrazów w projektach, uruchom stos przez SSH (Krok 3a).
4. Logi są w *Kontener → poster-panel / poster-n8n → Log*.

### Krok 4. Sieć, porty i strefa czasowa

- **Panel**: `http://<NAS_IP>:7080`. **n8n**: `http://<NAS_IP>:5678`.
- **Nie przekierowuj tych portów na routerze.** Bot nie potrzebuje ruchu przychodzącego, bo Telegram, AI i platformy social media obsługuje połączeniami wychodzącymi. Zdalny dostęp najlepiej przez VPN (np. Tailscale) – patrz „Dostęp spoza domu i serwer w internecie”.
- `BIND_ADDRESS` w `.env` ustala, na jakim adresie hosta nasłuchują panel i n8n: `0.0.0.0` (domyślnie) to wszystkie adresy IPv4, `127.0.0.1` – tylko sam host.
- Port `7081` (API panelu dla n8n) i RSSHub (`1200`) są dostępne **tylko wewnątrz sieci Dockera**.
- Jeśli port jest zajęty, zmień w `.env` `PANEL_PORT` lub `N8N_PORT` i wykonaj `sudo docker compose up -d`.
- Włączona **zapora UGOS** (*Panel sterowania → Zabezpieczenia → Zapora*) wymaga reguł: TCP `7080` i `5678`, źródło: podsieć LAN (np. `192.168.1.0/24`).
- **Strefa czasowa**: `TZ=Europe/Warsaw` trafia do panelu (harmonogram) i n8n, z automatyczną zmianą czasu letniego i zimowego. Sprawdzenie: `sudo docker exec poster-panel date`.

#### Dostęp spoza domu i serwer w internecie
Panel i n8n działają po HTTP i są przeznaczone do sieci lokalnej, więc nie wystawiaj ich bezpośrednio do internetu.
- **NAS w domu**: zdalnie wchodź przez VPN, np. [Tailscale](https://tailscale.com) (aplikacja na NAS-ie i telefonie).
- **Serwer w internecie (VPS)**: w `.env` ustaw `BIND_ADDRESS=127.0.0.1` i `NAS_IP=localhost` (instalator jednym
  poleceniem robi to sam, gdy serwer ma publiczny adres IP), wykonaj `sudo docker compose up -d`, a potem łącz się
  tunelem SSH ze swojego komputera:
  ```bash
  ssh -L 7080:127.0.0.1:7080 -L 5678:127.0.0.1:5678 twoj_login@adres_serwera
  ```
  Dopóki tunel jest otwarty, panel działa pod `http://localhost:7080`, a n8n pod `http://localhost:5678` (także adres
  zwrotny X z panelu). Zamiast tunelu możesz użyć Tailscale na serwerze.
- Za odwrotnym proxy z HTTPS (np. Caddy) panel sam doda flagę `Secure` do ciasteczka sesji (nagłówek
  `X-Forwarded-Proto: https`). Linki w panelu nadal powstają z `NAS_IP` i portów, więc tunel lub VPN to prostsza droga.

### Krok 5. Logi: czy wszystko wstało

```bash
cd /volume1/docker/poster
sudo docker compose logs --tail=50 panel         # „Panel: http://…:7080”, „API dla n8n: port 7081”
sudo docker compose logs -f --tail=200 n8n       # „Editor is now accessible via: …” (Ctrl+C kończy podgląd)
sudo docker compose ps                           # poster-panel / poster-n8n … (healthy)
curl -s http://127.0.0.1:5678/healthz/readiness  # {"status":"ok"} = baza n8n podłączona
```

Te komunikaty w logach n8n są **niegroźne**:
- `Failed to start Python task runner … Python 3 is missing`: Poster używa tylko węzłów JavaScript.
- `There are deprecations related to your n8n setup …`: zapowiedzi zmian w przyszłych wersjach n8n.
- `ExperimentalWarning: localStorage is not available`: ostrzeżenie Node.js z procesu task runnera.

| Komunikat w logach | Przyczyna | Rozwiązanie |
|---|---|---|
| `EACCES: permission denied …` (n8n) / `Nie mogę użyć katalogu danych /data` (panel) | zły właściciel `data/` | `sudo bash scripts/init-nas.sh` |
| `SQLITE_CANTOPEN` / `SQLITE_READONLY` | jw. albo brak miejsca | jw.; `df -h /volume1` |
| `Mismatching encryption keys` | `N8N_ENCRYPTION_KEY` w `.env` ≠ klucz w `data/n8n/config` | przywróć poprzedni klucz |
| `required variable … is missing` | brak klucza w `.env` | `sudo bash scripts/init-nas.sh` |
| `port is already allocated` | port zajęty | zmień `PANEL_PORT` / `N8N_PORT` |

### Krok 6. n8n: konto właściciela i import workflow

1. Otwórz `http://NAS_IP:5678` i od razu załóż **konto właściciela** (owner) – dopóki go nie ma, może je założyć każdy
   w Twojej sieci. Instalator jednym poleceniem zakłada je sam.
2. Zaimportuj i opublikuj workflow: `sudo bash scripts/import-to-n8n.sh`. Workflow nie potrzebuje żadnych poświadczeń n8n.

### Krok 7. Panel: hasło, klucze, pierwszy bot

1. Otwórz **`http://NAS_IP:7080`** i ustaw hasło do panelu. Panel poprosi o **jednorazowy kod** – instalator jednym
   poleceniem pokazuje go na końcu, a z logów wypiszesz go poleceniem `sudo docker compose logs panel | grep -i kod`
   (bez konsoli: aplikacja Docker w UGOS → *Kontener → poster-panel → Log*). Dzięki temu nikt inny w sieci nie ustawi hasła przed Tobą.
   Na tym samym ekranie wybierasz **język panelu** – polski albo angielski (zmienisz go później w *Ustawieniach*).
   Reset hasła: `sudo docker compose exec panel node reset-password.js` (wypisze nowy kod).
2. **Ustawienia → Google Gemini**: wklej klucz i kliknij *Sprawdź klucz*.
   Klucz z projektu bez billingu jest darmowy (patrz „Koszty”). Zamiast Gemini możesz użyć modelu na swoim sprzęcie (*Ustawienia → Dostawcy AI*, np. Ollama).
3. **Ustawienia → Telegram**: wklej token bota, napisz do bota `/start` i kliknij **Wykryj**, a potem *Wyślij test* i *Zapisz*.
4. **Dodaj bota** (albo użyj przeniesionego z `.env`) i uzupełnij kolejno:
   - temat i źródła, przy czym *Dodaj Google News* to najszybszy start;
   - harmonogram;
   - zakładkę *Publikacja*. Platformy zostaw na razie wyłączone: drafty przyjdą tylko na Telegram.
5. **Uruchom teraz**, a gdy draft wygląda dobrze, kliknij **Wznów**. Bot będzie działał według harmonogramu.
6. Podepnij konta platform w zakładce **Konta** bota i włącz je w zakładce *Publikacja* (patrz „Konta i klucze API”).

---

## 🎛️ Panel sterowania

| Miejsce | Co tam jest |
|---|---|
| **Pulpit** | Stan n8n, Telegrama, Gemini i konta-czytnika X. Karta bota z następnym uruchomieniem, ostatnim wynikiem i platformami. Przyciski *Napisz post*, *Uruchom teraz* i *Wstrzymaj/Wznów*. Tabela ostatnich działań z linkami do draftu i do wykonania w n8n |
| **Nowy post** | Własny post: treść, link, zdjęcie (z dysku albo aparatu), platformy X i Facebook, wskazówka dla AI. *Dopasuj pod platformy* – AI pisze wersje na każdą platformę, *Bez AI* – Twój tekst w limitach platform. Wersje poprawiasz przed wysłaniem: *Wyślij do akceptacji* albo *Publikuj teraz* |
| **Bot → Ogólne** | Nazwa, temat, nazwa marki, język postów, **dodatkowe wytyczne dla AI** (ton, grupa docelowa, tematy do unikania) |
| **Bot → Źródła** | Kanały RSS z przyciskiem *Test* (wystarczy adres strony – panel sam znajdzie jej kanał) i kreatorem Google News. Profile X (RSSHub / Apify / wyłączone) z testem przez RSSHub. Maks. wiek newsa, liczba kandydatów dla AI |
| **Bot → Harmonogram** | Aktywny / wstrzymany. *Co kilka godzin* (co 1–24 h w oknie od–do) lub *O wybranych godzinach* (siatka 0–23). Minuta, **losowe przesunięcie** (do 15/30/45 min), dni tygodnia, podgląd najbliższych uruchomień |
| **Bot → Tekst i grafika** | Koszt jednego posta. Dostawca i model tekstu, „myślenie” Gemini. **Skąd grafika** (zdjęcie z artykułu / post z linkiem / bez grafiki) |
| **Bot → Publikacja** | Włączniki X i Facebook – publikacja po kliknięciu ✅ w Telegramie |
| **Bot → Konta** | Połączenie kont: X (OAuth2) i strona Facebook (token strony) |
| **Bot → Historia** | Uruchomienia i drafty bota |
| **Bot → Zaawansowane** | Pamięć duplikatów (reset), **usuwanie bota** |
| **Drafty** | Galeria draftów z grafikami, tekstami do skopiowania (także do ręcznej publikacji na Instagramie i TikToku), wynikami publikacji i pobieraniem grafiki |
| **Ustawienia** | Klucz Gemini, **Dostawcy AI** (Ollama, własne API zgodne z OpenAI), bot Telegram (+ wykrywanie ID czatu, administratorzy), aplikacja X, wersja Graph API, Apify, **język panelu**, hasło panelu, **Wersja PRO** (klucz licencyjny po zakupie) |

<details>
<summary>📸 Zrzuty ekranu: nowy post, harmonogram, tekst i koszty, drafty, telefon</summary>

![Nowy post: Twój tekst i wersje na X i Facebooka](docs/img/lite-compose-pl.webp)

![Harmonogram: co kilka godzin albo o wybranych godzinach, losowe przesunięcie, dni tygodnia](docs/img/lite-schedule-pl.webp)

![Tekst i grafika: koszt jednego posta, dostawca i model tekstu](docs/img/lite-ai-pl.webp)

![Draft: grafika, teksty na X i Facebooka, scenariusz TikToka](docs/img/lite-draft-pl.webp)

<img src="docs/img/lite-phone-pl.webp" width="320" alt="Panel na telefonie">

</details>

**Język panelu** (polski / English) obejmuje interfejs, wiadomości w Telegramie (drafty, raporty, alerty) i komunikaty
błędów. Język postów to osobne ustawienie w każdym bocie (*Bot → Ogólne*), a polecenia dla AI zostają po polsku.

**Harmonogram.**
- Panel sprawdza terminy co 20 s w strefie `TZ`. Każdy termin uruchamia bota **dokładnie raz** – także z losowym przesunięciem.
- Po awarii lub restarcie NAS-a panel nie nadrabia terminów starszych niż 10 min, więc nie ma serii zaległych postów.
- Zmiana harmonogramu nie uruchamia bota za termin, który właśnie minął.
- Nowy bot startuje jako **wstrzymany**.
- *Uruchom teraz* działa zawsze, także dla wstrzymanego bota.

**Bezpieczeństwo.**
- Klucze API i tokeny kont leżą tylko w `data/panel/secrets.json` (chmod 600). Panel nie wysyła ich do przeglądarki: pokazuje wyłącznie końcówkę `••••abcd`.
- n8n dostaje od panelu konfigurację bota **bez sekretów** i woła API przez bramkę `http://panel:7081/gw/<bot>/<usługa>/…`. Bramka dokleja właściwy klucz lub token, więc sekrety nie trafiają do historii wykonań n8n.
- Webhook n8n i bramkę chroni wspólny sekret `PANEL_INTERNAL_TOKEN`, a bramka jest dostępna tylko w sieci Dockera.
- Logowanie: hasło (scrypt), sesja w podpisanym ciasteczku (30 dni), limit prób logowania. Pierwsze hasło ustawisz tylko z jednorazowym kodem z logów panelu.
- Więcej o zabezpieczeniach i zgłaszaniu podatności: [SECURITY.pl.md](SECURITY.pl.md).

**Kopia zapasowa panelu**: katalog `data/panel` (bot, klucze, historia). Pełny backup opisuje sekcja „Utrzymanie”.

---

## 📣 Własny post

Poza postami z newsów możesz w każdej chwili opublikować własny: ogłoszenie, promocję, zaproszenie, opinię.

1. Panel → **✍️ Nowy post** (albo *Napisz post* na Pulpicie i ✍️ na karcie bota).
2. Wpisz treść, opcjonalnie link i zdjęcie (z dysku albo prosto z aparatu telefonu – duże zdjęcia panel sam
   zmniejsza) i wybierz platformy. Do wyboru są platformy włączone w bocie (zakładka *Publikacja*).
3. **Dopasuj pod platformy** – AI pisze osobną wersję na każdą platformę:
   - **X** – krótko, do 280 znaków; link trafia na koniec i liczy się jak 23 znaki;
   - **Facebook** – dłuższy tekst w akapitach, pytanie albo zachęta, link na końcu;

   AI trzyma się Twojej treści – nie dopisuje faktów, cen ani obietnic – i pisze w języku bota, z jego wytycznymi.
   *Wskazówka dla AI* zmienia ton tylko tego posta (np. „luźniej, z humorem”). **Bez AI – mój tekst** daje wersje
   bez AI: Twój tekst przycięty do limitów platform.
4. Popraw wersje i wybierz:
   - **Wyślij do akceptacji** – draft przychodzi na Telegram z przyciskami ✅/❌, jak każdy inny;
   - **Publikuj teraz** – post wychodzi od razu, a raport z linkami trafia do Telegrama i do panelu.

Do samych własnych postów bot nie potrzebuje źródeł ani harmonogramu (może zostać wstrzymany) – wystarczą Telegram
i podłączone konta. Koszt: jedno zapytanie do AI tekstu na kliknięcie *Dopasuj* (tyle co jeden draft z newsów),
bez AI – 0 zł; publikacja na X według cennika API X.
Wersja PRO dodaje własne posty na Instagram, Threads, Bluesky, kanał Telegram i TikTok, grafikę marki, wybór bota, planowanie postów na dzień i godzinę (także cyklicznych), kalendarz treści, kilka botów naraz oraz posty wysyłane z telefonu komendą `/post` w Telegramie.

---

## 💸 Koszty

Płatny może być tylko **tekst AI** – i zwykle mieści się w darmowym limicie. Karta *Koszt jednego posta*
w **Bot → Tekst i grafika** pokazuje, co przy obecnych ustawieniach kosztuje. Grafika zawsze kosztuje 0 zł.

Osobno płacisz za publikację na **X**: nowe aplikacje X rozliczają się za każdy post, a post z linkiem kosztuje
wielokrotnie więcej niż post ze zdjęciem (patrz „X”). Karta *Koszt jednego posta* pokazuje orientacyjny koszt X
dla ustawień bota.

**Grafika – skąd bot ją bierze** (wybór w bocie):

| Tryb | Co robi | Koszt |
|---|---|---|
| 📷 Zdjęcie z artykułu (domyślnie) | Zdjęcie z RSS (`enclosure`, `media:content`, `<img>`), z tweeta albo ze strony artykułu (`og:image`). Pomija logotypy, małe obrazki (< 600 px) i obrazek powtarzający się w kolejnych postach | 0 zł |
| 🔗 Post z linkiem | X i Facebook dostają tekst z linkiem – podgląd artykułu robi sama platforma. Zdjęcie z artykułu przychodzi z draftem na Telegram | 0 zł |
| 🚫 Bez grafiki | X i Facebook: tekst z linkiem | 0 zł |

Gdy artykuł nie ma zdjęcia, X i Facebook dostają post z linkiem.
Linki Google News nie prowadzą wprost do artykułu – dla zdjęć dodaj bezpośredni kanał RSS portalu.

⚖️ Zdjęcia z artykułów są chronione prawem autorskim. Publikuj je tylko wtedy, gdy masz do tego prawo (własne źródła, licencja agencji). W razie wątpliwości wybierz **post z linkiem** – to standardowy, bezpieczny sposób dzielenia się newsem.

**Tekst – darmowe opcje** (*Ustawienia*, potem wybór w bocie):
- **Gemini z kluczem z projektu bez billingu**: utwórz klucz w AI Studio w projekcie **bez billingu**. Teksty idą wtedy w darmowym limicie Google (Google może wykorzystywać te dane do ulepszania usług).
- **Ollama** – model na własnym komputerze/NAS-ie (`http://IP:11434/v1`); 0 zł, ale na słabym sprzęcie wolno.
- **Własne API zgodne z OpenAI** – np. LM Studio, vLLM albo dostawca w chmurze z darmowym planem.
- „Myślenie” Gemini jest domyślnie **niskie** – wybór newsa i pisanie postów nie wymaga długiego rozumowania, a to obniża koszt.

---

## Konta i klucze API

### Telegram (akceptacja draftów i alerty)
1. W [@BotFather](https://t.me/BotFather) wyślij `/newbot`. Token wklej w **panelu → Ustawienia → Telegram** i kliknij *Sprawdź token*.
2. Napisz do swojego bota `/start`. Bot odpowie ID czatu, a przycisk **Wykryj** wpisze je za Ciebie.
   Dla grupy dodaj bota do grupy i napisz w niej `/start`.
3. W grupie wpisz też **ID administratorów** (swoje user ID), żeby tylko Ty mógł klikać ✅.
4. Jeśli bot Telegrama miał wcześniej webhook, usuń go: `curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`.

### Google Gemini
Klucz utworzysz w [Google AI Studio](https://aistudio.google.com/apikey) i wklejasz w **panelu → Ustawienia → Google Gemini**.
Wystarczy klucz z projektu **bez billingu** – teksty mieszczą się wtedy w darmowym limicie Google. Model wybierasz
w *Bot → Tekst i grafika* (podpowiedzi z listy pobranej dla Twojego klucza). Wybieraj stabilne nazwy (np. `gemini-3.8-flash`).
Aliasy typu `gemini-flash-latest` częściej zwracają 503. Gdy model jest chwilowo przeciążony (503) albo skończy się
limit zapytań (429), przebieg bota ponawia zapytanie z rosnącymi przerwami przez ok. 2 minuty i dopiero potem wysyła alert.

### X (publikacja przez API v2)
Do publikacji potrzebujesz aplikacji deweloperskiej X.

**Koszt.** Od lutego 2026 r. nowe konta deweloperskie X nie dostają darmowego planu: płacisz za użycie, kupując
kredyty w *X Developer Console*. Według zestawień z 2026 r. zwykły post kosztuje ok. 0,015 USD, a **post z linkiem
ok. 0,20 USD**. X może zmienić ceny – sprawdź je w konsoli, zanim włączysz publikację.
Link trafia do posta na X w trybie grafiki *🔗 post z linkiem* i w poście bez grafiki; post ze *📷 zdjęciem z artykułu* nie ma linku.

1. W [developer.x.com](https://developer.x.com) otwórz *Projects & Apps → Twoja aplikacja → User authentication settings → Set up*:
   - **App permissions**: *Read and write*
   - **Type of App**: *Web App, Automated App or Bot* (confidential client)
   - **Callback URI**: adres z **panelu → Ustawienia → Aplikacja X** (`http://<NAS_IP>:7080/oauth/x/callback`)
   - **Website URL**: np. adres Twojej strony lub profilu
2. *Keys and tokens → OAuth 2.0 Client ID and Client Secret*: wklej je w **panelu → Ustawienia → Aplikacja X**.
3. W bocie otwórz zakładkę **Konta → Połącz konto X**, zaloguj się na konto, z którego ten bot ma publikować, i kliknij *Authorize*.
   Panel zapisze tokeny i będzie je odświeżał (zakres `offline.access`).
4. Jeśli portal X nie przyjmie adresu `http://IP…`:
   - zarejestruj dowolny adres, np. `http://localhost/poster-x`;
   - wpisz go w panelu jako *Własny Callback URI*;
   - po autoryzacji przeglądarka pokaże błąd strony. Skopiuj **cały adres z paska** i wklej go w panelu w polu, które pojawi się pod przyciskiem *Połącz*.

### Meta: strona na Facebooku
1. W [Meta for Developers](https://developers.facebook.com) utwórz aplikację typu *Business*. Token wygenerujesz jednym z dwóch sposobów:
   - najlepiej: *Business Manager → Użytkownicy systemowi* → token dla aplikacji z uprawnieniami
     `pages_show_list, pages_read_engagement, pages_manage_posts, business_management`
     i przypisaną stroną. Taki token nie wygasa;
   - albo: *Graph API Explorer* → token użytkownika z powyższymi uprawnieniami, wymieniony na długoterminowy.
2. W bocie otwórz **Konta → Facebook**, wklej token i kliknij **Sprawdź i połącz**. Panel sam znajdzie stronę
   (przy wielu stronach da wybór) i pobierze token strony.
3. Przełącz aplikację Meta w tryb **Live** (wymaga URL polityki prywatności). W trybie deweloperskim posty mogą być widoczne tylko dla ról aplikacji.

### Źródło X: RSSHub (domyślne)
1. Załóż **osobne** konto X. Nie używaj głównego, bo scraping może skończyć się blokadą konta.
2. Zaloguj się nim na x.com w przeglądarce, otwórz *DevTools (F12) → Application → Cookies → https://x.com* i skopiuj wartość `auth_token` do `TWITTER_AUTH_TOKEN` w `.env`. Kilka tokenów rozdziel przecinkami.
   Potem wykonaj `sudo docker compose up -d`.
3. Test: *Bot → Źródła → Sprawdź profile przez RSSHub*.
- **Alternatywy**: Apify (token w *Ustawieniach*, źródło *Apify* w bocie) albo własny Nitter lub RSS-Bridge (*Szablon adresu RSS* w bocie).

**Jak chronić konta przed blokadą.**
- **Konto-czytnik ≠ konto publikujące.** Odczyt X idzie przez osobne konto (ciasteczko w `.env`), a publikacja – przez oficjalne X API v2 na koncie podpiętym w bocie. Jeśli X zablokuje czytnika, konta publikujące zostają nietknięte. Czytnik najlepiej założyć na osobny e-mail i zwykły numer prepaid; raz na jakiś czas zaloguj się na nie w przeglądarce.
- **Zapasowy czytnik**: wpisz od razu dwa tokeny po przecinku (`TWITTER_AUTH_TOKEN=token1,token2`) – RSSHub rozkłada na nie zapytania.
- **Konto publikujące oznacz jako automatyczne**: w X *Ustawienia → Twoje konto → Automatyzacja → „Automated by @…”* – tego wymagają zasady X dla botów.
- **Losowe godziny**: *Bot → Harmonogram → Losowe przesunięcie* (do 15/30/45 min) – każdy termin startuje o losową liczbę minut później (np. 8:00 → 8:17, 12:00 → 12:41), więc bot nie odpytuje X i nie publikuje co do minuty. Wylosowane godziny widać w podglądzie i nie zmieniają się po restarcie.
- **Mało zapytań**: każdy śledzony profil to jedno zapytanie przy każdym uruchomieniu bota (5 profili × 4 uruchomienia = 20 dziennie). Przy wielu profilach dodaj drugi token.
- **Alert o padniętym czytniku**: gdy 3 uruchomienia z rzędu nie pobiorą **żadnego** profilu X, panel wysyła alert na Telegram (z instrukcją podmiany tokenu), pokazuje ostrzeżenie w bocie i czerwony kafelek *X – konto-czytnik* na Pulpicie. Po podmianie tokenu kliknij *Sprawdź profile przez RSSHub* – udany test zdejmuje alert, a panel potwierdza „Odczyt X znowu działa”. Liczbę uruchomień zmienisz w `.env`: `POSTER_X_ALERT_AFTER=3`.
- **Proxy dla odczytu X (opcjonalnie)**: `RSSHUB_PROXY_URI=socks5h://user:haslo@host:port` (lub `http://…`) w `.env`, potem `sudo docker compose up -d rsshub`. Przez proxy idzie tylko RSSHub, czyli wyłącznie odczyt X – publikacja i reszta zostają na Twoim łączu. Wybierz proxy ze **stałym IP** (sticky), najlepiej domowe lub mobilne: adresy z centrów danych X blokuje najczęściej, a IP zmieniane przy każdym zapytaniu wygląda podejrzanie. Po zmianie sprawdź profile przyciskiem w bocie.

⚖️ Rozdzielenie kont ogranicza szkody, ale nie zmienia regulaminu X, który zabrania pobierania treści bez zgody. W pełni „czyste” źródła to kanały RSS portali, Apify (pobiera po swojej stronie) albo płatny odczyt przez oficjalne X API.

---

## Jak to działa pod spodem

1. **Harmonogram / „Uruchom teraz”.** Panel wysyła `POST http://n8n:5678/webhook/poster` z nagłówkiem `x-poster-token`.
   Treść zapytania to `{ kind: "generate", runId, config: {…pełna konfiguracja bota bez sekretów…} }`.
   n8n od razu odpowiada ID wykonania, które staje się linkiem w historii panelu.
2. **n8n** wykonuje kolejno:
   - pobiera źródła;
   - pyta panel o nowe newsy (`/internal/bots/<id>/candidates`, pamięć duplikatów bota);
   - prosi panel o tekst (`/internal/bots/<id>/llm` – dostawca wybrany w bocie) i o zdjęcie z artykułu
     (`/internal/bots/<id>/image`, wg trybu grafiki bota);
   - zapisuje draft w `data/files`;
   - wysyła do Telegrama grafikę (albo sam nagłówek, gdy draft jest bez grafiki), potem teksty postów, a na końcu skrypt z przyciskami (po kolei, więc przyciski są zawsze pod ostatnią wiadomością);
   - zgłasza draft panelowi.
3. **Kliknięcie ✅** odbiera panel (long-polling `getUpdates`): od razu odpowiada „⏳ Publikuję…” i zleca n8n `kind: "publish"` dla tego draftu z aktualną konfiguracją bota.
4. **Własny post** (*✍️ Nowy post*): wersje na platformy pisze panel (router AI, jak niżej), a n8n dostaje
   `kind: "compose"` z gotowymi tekstami. Zdjęcie czeka w `data/panel/compose` i n8n odbiera je przez
   `/internal/bots/<id>/image`. Węzeł *Post własny: przygotuj* składa draft (bez źródeł i bez AI), dalej jak wyżej:
   Telegram z przyciskami albo – przy „Publikuj teraz” – od razu publikacja.
5. **Publikacja**: X → Facebook. Bez grafiki (lub w trybie *link*) X i Facebook dostają tekst z linkiem. Błąd jednej platformy nie blokuje drugiej. Raport trafia do Telegrama (z przyciskiem 🔁 dla nieudanych) i do historii w panelu.
6. **Błędy**: workflow jest swoim *Error Workflow*. Zgłasza błąd panelowi, a ten zapisuje go przy bocie i wysyła alert na Telegram.

### Tekst i grafika przez panel (router AI)

Węzły **„AI: wybierz news i napisz posty”** i **„Grafika: panel”** to zwykłe węzły *HTTP Request* (`POST`, nagłówek
`x-poster-token: {{ $env.PANEL_INTERNAL_TOKEN }}`, body JSON). Klucze API zna tylko panel.

| Węzeł | URL | Body | Odpowiedź |
|---|---|---|---|
| AI: wybierz news… | `{{ panelUrl }}/internal/bots/{{ botId }}/llm` | `{ system, user, schema, maxTokens }` (buduje *Przygotuj prompt LLM*) | `{ text, provider, model }` – `text` to JSON wg schematu |
| Grafika: panel | `{{ panelUrl }}/internal/bots/{{ botId }}/image` | `{ news: { url, title, images }, compose }` (`compose` – zdjęcie własnego posta) | `{ source: source\|upload\|none, data (base64), mimeType, width, height, url, warnings }` |

Węzeł *Grafika: przygotuj* zamienia `data` na plik binarny (trafia do `sendPhoto` w Telegramie, `media/upload` w X,
`/{page}/photos` w Graph API) i dopisuje do podpisu w Telegramie, skąd jest zdjęcie (📷 źródło / 🚫 brak).

---

## Utrzymanie

| Zadanie | Jak |
|---|---|
| Aktualizacja Postera | `sudo bash scripts/update.sh` (pobranie, uzupełnienie `.env`, przebudowa, import workflow) |
| Zmiana harmonogramu, tematu, modeli, platform | panel → bot. Zmiany działają od następnego uruchomienia, bez restartów |
| Zmiana promptu LLM | tekst stylu: *Bot → Ogólne → Dodatkowe wytyczne dla AI*; cały prompt: `workflows/src/code/build_prompt.js` + `python3 workflows/src/build.py` (zmiana w samym n8n zniknie przy następnym imporcie workflow) |
| Reset deduplikacji | panel → bot → *Zaawansowane → Wyczyść pamięć* |
| Aktualizacja n8n | backup, potem `N8N_VERSION=…` w `.env` → `sudo docker compose pull && sudo docker compose up -d` |
| Backup | `sudo tar czf poster-backup-$(date +%F).tgz data .env`: w `data/` są baza n8n, ustawienia i klucze panelu oraz drafty, w `.env` klucz szyfrujący |
| Podgląd draftów | panel → *Drafty*, albo folder `docker/poster/data/files` (SMB) |
| Historia wykonań n8n | przycinana po 7 dniach (`EXECUTIONS_DATA_MAX_AGE=168`) |
| Reset hasła panelu | `sudo docker compose exec panel node reset-password.js` – wyloguje wszystkie sesje i wypisze kod, z którym ustawisz nowe hasło w przeglądarce (bez restartu panelu) |
| Zapomniane hasło n8n | `sudo docker compose exec n8n n8n user-management:reset`, potem od razu otwórz `http://NAS_IP:5678` i załóż konto właściciela od nowa. Workflow i historia wykonań zostają |

## Rozwiązywanie problemów

- **Pulpit: „n8n nie odpowiada” / „n8n nie zna webhooka poster”.** Kontener n8n nie działa albo workflow nie jest opublikowany. Wykonaj `sudo docker compose ps` i `sudo bash scripts/import-to-n8n.sh`.
- **„n8n odrzucił zapytanie – PANEL_INTERNAL_TOKEN…”.** Kontenery mają różne tokeny: po zmianie `.env` wykonaj `sudo docker compose up -d` (restartuje oba).
- **Brak nowych draftów.** Pulpit pokazuje status każdego uruchomienia:
  - *Brak nowych newsów*: źródła nie mają nic świeżego albo wszystko już było. Sprawdź kanały przyciskiem *Test*.
  - *Pominięto*: AI uznało, że żaden news nie pasuje do tematu.
  - *Błąd*: opis z nazwą węzła i link do wykonania w n8n.
- **Telegram: „inny program odbiera wiadomości tego bota”.** Stary workflow n8n z odpytywaniem co minutę nadal działa. Zaimportuj nowy (`scripts/import-to-n8n.sh`) albo usuń webhook bota (`deleteWebhook`).
- **X: „odrzucił odświeżenie tokenu”.** Autoryzacja wygasła lub została cofnięta. Kliknij *Połącz ponownie* w *Kontach*.
- **X: 403 przy uploadzie.** Aplikacja ma uprawnienia *Read only* albo token nie ma `media.write`. Popraw ustawienia w portalu X i połącz konto ponownie.
- **„Odczyt X nie działa” (alert / czerwony kafelek).** Konto-czytnik zostało wylogowane albo zablokowane, albo nie działa proxy. Podmień `TWITTER_AUTH_TOKEN` (patrz „Źródło X”), wykonaj `sudo docker compose up -d rsshub` i kliknij *Sprawdź profile przez RSSHub*.
- **Posty bez zdjęć, choć artykuły je mają.** Źródło to Google News (linki nie prowadzą do artykułu) albo portal blokuje pobieranie. Dodaj bezpośredni kanał RSS portalu; ostrzeżenie widać w podpisie draftu w Telegramie.
- **Ochrona SSRF (opcjonalnie).** Po włączeniu `N8N_SSRF_PROTECTION_ENABLED=true` dodaj `N8N_SSRF_ALLOWED_HOSTNAMES=rsshub,panel`, inaczej n8n nie połączy się z RSSHub i panelem w sieci Dockera.
- **Przyciski nie reagują.** Sprawdź na Pulpicie kafelek Telegram. Kliknięcia są przyjmowane tylko z czatu z Ustawień; przy liście administratorów – tylko od nich.
- **„Bot … nie ma podłączonego konta X/strony Facebook”.** Platforma jest włączona w *Publikacji*, ale konto nie jest połączone w zakładce *Konta* bota.
- **FB: `(#200)` lub `(#10)` permissions.** Token strony nie ma wymaganych uprawnień albo aplikacja nie jest w trybie Live.

## Licencja

Copyright © 2026 Daniel Grodowski.

Poster jest udostępniany na licencji **GNU Affero General Public License v3.0** (`AGPL-3.0-only`) – pełny tekst
w pliku [LICENSE](LICENSE). Możesz go używać, zmieniać i rozpowszechniać, także komercyjnie. Zmienioną wersję
udostępnianą innym – również jako usługę przez sieć – musisz jednak udostępnić z kodem źródłowym na tej samej licencji.
Panel pokazuje link *Kod źródłowy*; jeśli udostępniasz zmienioną wersję, wpisz w `PROJECT_URL` (`panel/lib/util.js`)
adres swojego kodu.

- Potrzebujesz Postera w zamkniętym produkcie lub usłudze bez obowiązków AGPL? Możliwa jest osobna licencja
  komercyjna – napisz na kontakt@posterapp.pl.
- Poster nie zawiera n8n ani RSSHub: `docker compose` pobiera ich oficjalne obrazy, które mają własne licencje
  (n8n – Sustainable Use License, RSSHub – MIT).
- Jak zgłaszać błędy i wysyłać poprawki: [CONTRIBUTING.pl.md](CONTRIBUTING.pl.md).
