# Historia zmian

🇬🇧 [English](CHANGELOG.md) · 🇵🇱 **Polski**

Najnowsze zmiany są na górze. Aktualizację robisz zawsze tak samo: `sudo bash scripts/update.sh`
([README](README.pl.md) → „Aktualizacja”). Jeśli wersja wymaga czegoś więcej, opis jest przy niej.

## Niewydane

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
