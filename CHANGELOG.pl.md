# Historia zmian

🇬🇧 [English](CHANGELOG.md) · 🇵🇱 **Polski**

Najnowsze zmiany są na górze. Aktualizację robisz zawsze tak samo: `sudo bash scripts/update.sh`
([README](README.pl.md) → „Aktualizacja”). Jeśli wersja wymaga czegoś więcej, opis jest przy niej.

## Niewydane

## 1.4.1 – 2026-11-03

- **Draft tylko z tekstami platform, na które publikujesz:** wiadomość z draftem w Telegramie i szczegóły draftu
  w panelu mają teksty tylko dla platform włączonych w bocie (*Bot → Publikacja*), a AI pisze tylko te teksty – draft
  jest krótszy, a zapytanie do AI tańsze. Wcześniej draft miał zawsze tekst na X i skrypt wideo TikToka, także gdy bot
  publikował np. tylko na Facebooku i Instagramie. Skrypt wideo i podpis TikToka powstają tylko przy włączonym TikToku
  (wersja PRO), a tekst Facebooka możesz jak dotąd wkleić ręcznie na Instagramie. Platformę włączoną po powstaniu draftu
  publikacja tego draftu pomija z dopiskiem w raporcie – nowe drafty już ją mają.

## 1.4.0 – 2026-11-03

- **Bezpieczeństwo panelu:** panel przyjmuje zmiany tylko z własnej strony. Inna aplikacja pod adresem NAS-a (inny
  port), strona otwarta w przeglądarce przy tunelu SSH (`localhost`) ani sąsiednia subdomena za reverse proxy nie wyślą
  już zapytania w imieniu zalogowanego użytkownika – wcześniej dało się obejść sprawdzanie typu treści. Skrypty
  zapisujące pliki w `data/panel` jako root nie idą też za podłożonymi tam dowiązaniami symbolicznymi.
- **Bez podwójnych publikacji:** drugie kliknięcie ✅ tego samego draftu (podwójne tapnięcie, dwóch administratorów
  w czacie), zanim skończy się pierwsza publikacja, nie wysyła posta drugi raz – Telegram odpowiada „⏳ Ten draft właśnie
  się publikuje”. Tak samo ten sam własny post wysłany dwa razy naraz (np. z dwóch kart): drugie zapytanie dostaje
  komunikat, że post został przed chwilą wysłany.
- **Awaria zasilania nie zatrzymuje panelu:** ustawienia, klucze, historia i pamięć duplikatów zapisują się
  z wymuszonym zapisem na dysk, a panel trzyma poprzednią wersję plików (`*.bak` w `data/panel`). Uszkodzony plik (np.
  ucięty po zaniku prądu na NAS-ie) panel odkłada jako `*.corrupt-<data>` i startuje z poprzedniej wersji – wcześniej
  uszkodzony `state.json` zatrzymywał panel i wszystkie boty. Gdy uszkodzone są ustawienia albo klucze, a kopii brak,
  panel nie startuje z pustymi ustawieniami, tylko podaje w logach plik do poprawienia; uszkodzony plik hasła – prosi
  o nowe hasło z kodem z logów, jak po resecie.
- Adres artykułu z cudzysłowem w kanale RSS nie psuje już wiadomości z draftem w Telegramie.
- **Aktualizacje z poprawkami bezpieczeństwa:** `update.sh` przy każdej aktualizacji pobiera nowe obrazy n8n i RSSHub
  i buduje panel na aktualnym obrazie bazowym (poprawki Node.js, Alpine i ffmpeg) – wcześniej obrazy zostawały w wersji
  z dnia instalacji. Aktualizacja trwa przez to dłużej o czas pobierania; bez połączenia z Docker Hub kończy się na
  dotychczasowych obrazach, a `--no-images` pomija ten krok.
- **n8n aktualizuje się razem z Posterem:** `.env` nie przypina już wersji n8n – działa wersja sprawdzona z workflow
  danego wydania. Wpisaną przy instalacji wartość `N8N_VERSION=2.40.7` `update.sh` czyści sam; inną, świadomie
  przypiętą wersję zostawia i przypomina o niej (jeśli celowo przypiąłeś właśnie 2.40.7, wpisz ją ponownie).
- **Webhook n8n tylko z tokenem panelu:** n8n przyjmuje zlecenia wyłącznie z tokenem panelu (poświadczenie „Poster:
  token panelu”, które tworzy `import-to-n8n.sh` – uruchamia go `update.sh`). Obce zapytanie z sieci dostaje odmowę,
  zanim w n8n powstanie wykonanie. Workflow zaimportowany ręcznie w n8n wymaga uruchomienia
  `sudo bash scripts/import-to-n8n.sh`.
- **Konto właściciela n8n zakłada skrypt:** `import-to-n8n.sh` (także w `update.sh`) zakłada konto właściciela n8n, jeśli
  go jeszcze nie ma, i raz pokazuje login i hasło – przy instalacji krok po kroku nikt w sieci nie przejmie n8n przed
  Tobą. Istniejącego konta skrypt nie zmienia.
- **Bramka panelu przepuszcza tylko zapytania workflow Postera:** przejęte n8n nie użyje kluczy botów do niczego
  innego, np. nie przejmie odbioru wiadomości bota Telegram ani nie odczyta tokenu strony na Facebooku. Pliki przez
  bramkę: do 50 MB (limit wysyłki Telegrama).
- Git w skryptach instalacji i aktualizacji działa z przypiętej wersji obrazu `alpine/git` (zmienia ją dopiero nowe
  wydanie Postera).
- **Zdjęcia i strony z kanałów tylko z internetu:** adres z cudzego kanału RSS albo ze strony artykułu, który prowadzi
  do sieci lokalnej (np. obraz z kamery w domu, strona routera, usługi Dockera), panel pomija z ostrzeżeniem w drafcie –
  także po przekierowaniu i gdy nazwa wskazuje adres lokalny dopiero przy połączeniu. Spoza kanałów bota panel pobiera
  tylko z portów 80 i 443. Hosty kanałów RSS ustawionych w bocie (np. blog na NAS-ie) działają jak dotąd. Test kanału
  w panelu pobiera wpisany adres jak dotąd, ale nie idzie za przekierowaniem do innego serwera w sieci lokalnej.
- **Czat draftów w grupie:** gdy drafty przychodzą do grupy Telegram, a lista *ID administratorów* (*Ustawienia →
  Telegram*) jest pusta, panel ostrzega przy bocie – drafty może wtedy zatwierdzić każdy uczestnik grupy.
- **Tekst AI sprawdzany ze źródłem:** treść z kanałów trafia do AI jako dane oddzielone od poleceń, a gotowy draft
  z adresem strony, @kontem, e-mailem albo telefonem spoza newsa i ustawień bota ma dopisek „🔍 Sprawdź tekst” – np. gdy
  AI wykonało polecenie przemycone w cudzym kanale. Adresy i konta marki podane w *Dodatkowych wytycznych dla AI* nie są
  oznaczane.
- **Klucz hosta GitHuba znany z góry:** połączenie SSH skryptów z GitHubem (deploy key, przejście na PRO) przyjmuje tylko
  klucz opublikowany przez GitHuba – wcześniej ufało kluczowi z pierwszego połączenia. `update.sh` przestawia to
  w istniejących instalacjach sam.
- **Kontenery z mniejszymi uprawnieniami i limitami:** żaden kontener nie podniesie sobie uprawnień
  (`no-new-privileges`), panel i n8n działają bez uprawnień jądra, a program panelu jest tylko do odczytu (pliki
  robocze ffmpeg są w pamięci). Kontenery mają limity pamięci – w `.env` `PANEL_MEMORY`, `N8N_MEMORY` i `RSSHUB_MEMORY`,
  domyślnie 1g, 2g i 1g – a panel i n8n także liczby procesów. RSSHub ma healthcheck.
- **Panel bez ffmpeg się nie zbuduje:** gdy instalacja ffmpeg się nie uda (np. NAS nie łączy się z serwerem pakietów
  Alpine), aktualizacja kończy się czytelnym komunikatem, a dotychczasowa wersja działa dalej – wystarczy ponowić
  `update.sh`. Wcześniej panel budował się bez ffmpeg i po cichu pomijał zdjęcia WebP.
- **Łagodne zamykanie panelu:** przy aktualizacji i restarcie NAS-a panel daje trwającym zadaniom (np. zapytaniom
  n8n i publikacji po ✅) do 25 s na koniec i zapisuje stan, zamiast przerywać je w połowie.
- **Stan dla monitoringu:** `http://NAS_IP:7080/healthz` bez logowania odpowiada 200, gdy działa n8n, odbiór
  wiadomości z Telegrama i harmonogram, a 503 przy kłopocie – np. dla Uptime Kuma (README → „Utrzymanie”).
- **Odporność:** zapis ustawień bota w trakcie łączenia konta nie gubi już połączenia; ✅ w Telegramie nie wstrzymuje
  obsługi kolejnych kliknięć, gdy n8n wolno przyjmuje zlecenie; takty harmonogramu się nie nakładają; przebieg bota
  z wolnym modelem (np. Ollama) kończy się w czasie, na który czeka n8n; ffmpeg działa najwyżej w 2 procesach naraz.
- **Logowanie i sesje:** limit nieudanych prób obejmuje też zmianę hasła i działa także łącznie dla wszystkich adresów.
  Za odwrotnym proxy w sieci lokalnej liczy się adres klienta (`X-Forwarded-For`), więc pomyłki jednej osoby nie
  blokują innych. Nowy przycisk *Ustawienia → Hasło do panelu → Wyloguj na wszystkich urządzeniach* (np. po zgubieniu
  telefonu) – hasło zostaje bez zmian.
- **Błędy i uprawnienia:** niezalogowany nie widzi szczegółów błędów serwera, a zły adres API daje błąd 400 zamiast
  błędu serwera. `init-nas.sh` (uruchamia go też `update.sh`) zostawia `data/panel` tylko dla właściciela – wcześniej
  przy każdej aktualizacji grupa dostawała dostęp do plików z kluczami aż do najbliższego zapisu panelu.
- **Szyfrowana kopia zapasowa:** README podaje kopię `data/` i `.env` szyfrowaną hasłem (`openssl`) – są w niej klucze
  API i tokeny kont.
- **Stare drafty i miejsce na dysku:** nowa karta *Ustawienia → Pliki draftów*. Panel może sam usuwać drafty (tekst,
  grafikę i wideo w `data/files`), których nic nie zmieniło przez podaną liczbę dni – sprawdza co 6 godzin, a draftu
  w trakcie publikacji nie rusza. Domyślnie nic nie usuwa (0). Karta pokazuje wolne miejsce na dysku; gdy zostaje mniej
  niż 1 GB, ostrzega Pulpit i `/healthz` (pole `disk`, odpowiedź 503). Panel ma przez to zapis w `data/files`
  (wcześniej tylko odczyt).
- **Szybszy panel przy wielu draftach:** lista draftów nie czyta katalogu `data/files` przy każdym odświeżeniu, a pamięć
  podręczna draftów ma limit, więc zużycie pamięci nie rośnie z liczbą draftów. Pamięć duplikatów bota panel czyta
  z dysku raz, a nie przy każdym przebiegu, a sprawdzanie hasła przy logowaniu nie wstrzymuje innych zapytań.
- **Porządki:** panel nie przenosi już ustawień z `.env` przy pierwszym starcie (pozostałość wersji sprzed publikacji),
  a `docker-compose.yml` nie przekazuje mu dawnych zmiennych, np. `GEMINI_API_KEY` czy `TELEGRAM_BOT_TOKEN` – klucze
  ustawiasz tylko w panelu. Jeśli Twój `.env` z bardzo starej instalacji je jeszcze ma, możesz je stamtąd usunąć.
  `import-to-n8n.sh` nie przyjmuje dawnych opcji `--publish`, `--only-workflow`, `--only-credentials` i `--force-x`.

## 1.3.0 – 2026-11-02

- **Platforma bez odpowiedzi:** gdy platforma (np. X albo Facebook) przyjmie post, ale nie odpowie na czas albo
  połączenie się zerwie, raport w Telegramie nie pokazuje już błędu, tylko ⚠️ „nie wiadomo, czy opublikowano” z prośbą
  o sprawdzenie profilu. 🔁 nie wysyła takiego posta drugi raz (wcześniej mógł powstać duplikat), a dwa nowe przyciski
  zapisują go jako opublikowany („✅ Jest na profilu”) albo wysyłają ponownie („📤 Nie ma – wyślij”). W panelu taki post
  ma status „Nie wiadomo”. Raport pokazuje też czytelniej błędy z odpowiedzi API – sam opis zamiast surowego JSON-u.

## 1.2.1 – 2026-10-29

- Strona produktu: polska wersja jest pod [posterapp.pl](https://posterapp.pl/), angielska pod
  [posterapp.pl/en](https://posterapp.pl/en/). Panel po angielsku, instalator i angielskie README linkują od razu do
  angielskiej strony, a stare linki (np. z paneli 1.0–1.2) dalej prowadzą do właściwej wersji.

## 1.2.0 – 2026-10-29

- **Instalator na czystym serwerze:** na Ubuntu albo Debianie bez Dockera instalator jednym poleceniem sam instaluje
  Docker Engine i Docker Compose v2 z oficjalnego repozytorium Dockera (zwykle 1–3 min) i dalej instaluje Postera –
  wcześniej kończył się komunikatem „Brak Dockera”. Gdy system akurat instaluje aktualizacje, instalator na nie czeka,
  a przy źle ustawionym zegarze serwera (apt odrzuca wtedy listy pakietów – częste w maszynie wirtualnej) podpowiada,
  jak ustawić czas. Na NAS-ie Docker instalujesz jak dotąd z centrum aplikacji.
- Skrypt wideo TikToka w drafcie bota, który pisze w innym języku niż polski, ma angielskie nazwy sekcji (np. *DETAILS*,
  *ON-SCREEN TEXT*) – wcześniej AI przepisywało z wzoru polskie „ROZWINIĘCIE” i „NAPISY NA EKRANIE”.
- **AI chwilowo przeciążone:** gdy dostawca tekstu odpowiada, że jest przeciążony albo skończył się limit zapytań (np.
  Gemini: HTTP 503 „high demand”, HTTP 429), przebieg bota ponawia zapytanie z rosnącymi przerwami (16, 32 i 60 s)
  przez ok. 2 minuty, zanim wyśle alert do Telegrama – alert podaje, jak długo Poster próbował. Edytor własnego posta,
  jak dotąd, pokazuje błąd od razu.
- *Ustawienia → Dostawcy AI*: przycisk *Zapisz i sprawdź* jest pod polami swojego dostawcy – w nagłówku łatwo było
  kliknąć przycisk następnej karty (np. *Własny* zamiast *Ollama*). Po udanym sprawdzeniu plakietka od razu zmienia się
  na „skonfigurowany”, a opis karty i komunikat podpowiadają, że model (np. `gemma4:12b` w Ollamie) wybierasz w bocie:
  *Tekst i grafika → Model* albo *Model zapasowy*.
- Panel po angielsku: podpowiedź do klucza API Gemini w *Ustawieniach* zaczyna się od „From” zamiast polskiego „Z”,
  a tytuły w cudzysłowie (np. w wyniku testu kanału RSS) mają angielskie cudzysłowy.

## 1.1.1 – 2026-10-27

- Przy poleceniu przejścia na PRO (*Ustawienia*, po sprawdzeniu klucza licencyjnego) panel przypomina, że do
  aktywacji licencji (`upgrade-to-pro.sh`) można ją zwrócić w ciągu 14 dni od zakupu, i linkuje do warunków licencji
  PRO na posterapp.pl.

## 1.1.0 – 2026-10-27

- Karta *Wersja PRO*: dla klucza, który nie obejmuje już aktualizacji, przycisk *Przedłuż licencję* otwiera kasę
  przedłużenia z końcówką tego klucza.

## 1.0.1 – 2026-10-24

- Przycisk *Kopiuj* (np. przy poleceniu przejścia na PRO w *Ustawieniach*) działa także w panelu otwartym przez
  `http://adres-NAS-a:7080` – wcześniej kończył się komunikatem „Nie udało się skopiować”. Przy poleceniu przejścia na
  PRO panel podpowiada, że można je uruchomić z dowolnego katalogu, a `upgrade-to-pro.sh` kończy się poleceniem
  aktualizacji z pełną ścieżką.
- W menu są *Kalendarz* i *Zaplanowane* z plakietką PRO – prowadzą do opisu tych funkcji wersji PRO z linkiem do strony
  produktu.

## 1.0.0 – 2026-10-24

- Pierwsza publiczna wersja Postera LITE – darmowego bota newsowego: jeden bot, źródła RSS, Google News i profile X,
  tekst AI (Gemini, Ollama albo API zgodne z OpenAI), akceptacja draftów w Telegramie, publikacja na X i Facebooku,
  własne posty dopasowane przez AI, panel po polsku i po angielsku. Instalacja jednym poleceniem:
  `curl -fsSL https://posterapp.pl/install.sh | sudo bash` (README → „🚀 Instalacja jednym poleceniem”). Po zakupie PRO
  klucz licencyjny wklejasz w panelu (*Ustawienia → Wersja PRO*).
