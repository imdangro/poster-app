# Bezpieczeństwo

🇬🇧 [English](SECURITY.md) · 🇵🇱 **Polski**

## Zgłaszanie podatności

Nie opisuj podatności w publicznych zgłoszeniach (Issues). Zgłoś ją prywatnie – na GitHubie:
[imdangro/poster-app → Security → Report a vulnerability](https://github.com/imdangro/poster-app/security/advisories/new)
albo e-mailem na kontakt@posterapp.pl.
Postaram się odpowiedzieć jak najszybciej, a poprawka trafi do najnowszej wersji.

## Obsługiwane wersje

Poprawki bezpieczeństwa trafiają tylko do najnowszej wersji z gałęzi `main` (aktualizacja: `sudo bash scripts/update.sh`).

## Jak Poster jest zabezpieczony

- **Tylko sieć lokalna.** Panel (port 7080) i n8n (5678) działają po HTTP. Nie wystawiaj ich do internetu – z zewnątrz
  korzystaj z VPN albo tunelu SSH ([README](README.pl.md) → „Dostęp spoza domu i serwer w internecie”). Na serwerze
  w internecie ustaw w `.env` `BIND_ADDRESS=127.0.0.1` (instalator jednym poleceniem robi to sam, gdy serwer ma
  publiczny adres IP).
- **Klucze tylko w panelu.** Klucze API i tokeny kont leżą wyłącznie w `data/panel/secrets.json` (chmod 600).
  Przeglądarka widzi tylko końcówkę klucza. n8n nie zna żadnych kluczy: woła API przez bramkę panelu, dostępną tylko
  w sieci Dockera (port 7081) i chronioną wspólnym sekretem `PANEL_INTERNAL_TOKEN`.
- **Licencja PRO.** Klucz licencyjny wklejony w panelu czeka na `scripts/upgrade-to-pro.sh` w
  `data/panel/license-key.json` (chmod 600, przeglądarka widzi tylko końcówkę) i znika po aktywacji. Aktywację, klucz SSH
  NAS-a i stan licencji ma tylko skrypt (`.git/`, tylko root) – kontener panelu nie ma do nich dostępu.
- **Logowanie.** Pierwsze hasło (i nowe po resecie) ustawisz tylko z jednorazowym kodem z logów panelu. Hasło jest
  haszowane (scrypt), sesja to podpisane ciasteczko (HttpOnly, SameSite=Lax, 30 dni; za proxy z HTTPS także Secure),
  a logowanie i kod mają limit prób. Reset hasła (`reset-password.js`) od razu wylogowuje wszystkie sesje.
- **n8n.** Konto właściciela n8n zakłada instalator jednym poleceniem (losowe hasło). Przy instalacji ręcznej załóż je
  od razu po pierwszym starcie – dopóki go nie ma, może to zrobić każdy w sieci.
- **Przeglądarka.** Zapytania zmieniające dane muszą mieć typ JSON (ochrona przed CSRF), a panel wysyła nagłówki
  Content-Security-Policy, X-Frame-Options i X-Content-Type-Options.
- **Telegram.** Przyciski ✅/❌ działają tylko w czatach ustawionych w panelu, a przy liście administratorów – tylko dla nich.
- **Kontenery.** Panel i n8n działają jako zwykły użytkownik (UID 1000), bez uprawnień roota.

## Znane ograniczenia

- Panel pobiera strony artykułów i zdjęcia z adresów podanych w kanałach RSS – także z sieci lokalnej (np. blog na tym
  samym NAS-ie). Dodawaj tylko kanały, którym ufasz. Pobieranie ma limit czasu i rozmiaru.
- Odczyt profili X przez RSSHub używa ciasteczka konta X zapisanego w `.env`. Trzymaj `.env` z uprawnieniami 600
  (ustawia je `scripts/init-nas.sh`) i używaj osobnego konta X.
