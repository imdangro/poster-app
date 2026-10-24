# Instalacja i aktualizacje z prywatnego repozytorium

🇬🇧 [English](deploy-key.md) · 🇵🇱 **Polski**

Publiczne repozytorium Postera sklonujesz i zaktualizujesz bez logowania ([README](../README.pl.md) → „Instalacja krok po kroku”).
Ta instrukcja jest dla **prywatnej** kopii repozytorium (np. własnego forka): jednorazowo podłączasz NAS kluczem
tylko do odczytu, a potem `sudo bash scripts/update.sh` pobiera zmiany bez wpisywania tokenu.

## 1. Pierwsze pobranie (token fine-grained)

Prywatne repozytorium wymaga tokenu **fine-grained**, nie klasycznego.
GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens*:
- **Repository access**: *Only select repositories* → `<właściciel>/<repozytorium>`
- **Permissions → + Add permissions → Contents**: *Read-only* (*Metadata: Read-only* doda się sam)
- **Expiration**: ustaw datę ważności

Uruchom klonowanie z flagą `-it`. Git zapyta o login GitHub i hasło – jako hasło wklejasz **token**.
Token nie zostaje zapisany ani w repozytorium, ani w historii poleceń.

```bash
cd /volume1/docker          # na UGOS lub /volume2/docker; na serwerze np. /opt
sudo docker run --rm -it -v "$PWD":/git alpine/git clone https://github.com/<właściciel>/<repozytorium>.git poster
cd poster                   # kolejne polecenia wykonujesz w katalogu projektu
```

## 2. Aktualizacje bez tokenu (deploy key)

Klucz SSH typu *deploy key* działa tylko w trybie do odczytu i tylko dla jednego repozytorium, a do tego nie wygasa:

```bash
cd /volume1/docker/poster          # katalog projektu
sudo bash scripts/setup-deploy-key.sh
```

Skrypt:
1. tworzy klucz w `.git/poster-deploy-key`;
2. wypisuje link i klucz publiczny do wklejenia w *GitHub → repozytorium → Settings → Deploy keys → Add deploy key*
   (bez zaznaczania *Allow write access*);
3. przełącza repozytorium na SSH i sprawdza połączenie.

Od tej chwili `sudo bash scripts/update.sh` pobiera zmiany bez logowania. Dostęp cofniesz, usuwając klucz na GitHubie.
