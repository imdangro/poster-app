# Historia zmian

🇬🇧 [English](CHANGELOG.md) · 🇵🇱 **Polski**

Najnowsze zmiany są na górze. Aktualizację robisz zawsze tak samo: `sudo bash scripts/update.sh`
([README](README.pl.md) → „Aktualizacja”). Jeśli wersja wymaga czegoś więcej, opis jest przy niej.

## Niewydane

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
