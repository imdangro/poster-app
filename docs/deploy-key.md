# Installing and updating from a private repository

🇬🇧 **English** · 🇵🇱 [Polski](deploy-key.pl.md)

You can clone and update the public Poster repository without logging in ([README](../README.md) → “Step-by-step installation”).
This guide is for a **private** copy of the repository (e.g. your own fork): you connect the NAS once with a read-only
key, and then `sudo bash scripts/update.sh` pulls updates without typing a token.

## 1. First download (fine-grained token)

A private repository needs a **fine-grained** token, not a classic one.
GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens*:
- **Repository access**: *Only select repositories* → `<owner>/<repository>`
- **Permissions → + Add permissions → Contents**: *Read-only* (*Metadata: Read-only* is added by itself)
- **Expiration**: set an expiry date

Run the clone with the `-it` flag. Git asks for your GitHub login and password – paste the **token** as the password.
The token is saved neither in the repository nor in the command history.

```bash
cd /volume1/docker          # on UGOS or /volume2/docker; on a server e.g. /opt
sudo docker run --rm -it -v "$PWD":/git alpine/git clone https://github.com/<owner>/<repository>.git poster
cd poster                   # run the next commands in the project directory
```

## 2. Updates without a token (deploy key)

A *deploy key* is an SSH key that works read-only and for one repository only, and it does not expire:

```bash
cd /volume1/docker/poster          # project directory
sudo bash scripts/setup-deploy-key.sh
```

The script:
1. creates a key in `.git/poster-deploy-key`;
2. prints a link and the public key to paste in *GitHub → repository → Settings → Deploy keys → Add deploy key*
   (without ticking *Allow write access*);
3. switches the repository to SSH and checks the connection.

From then on `sudo bash scripts/update.sh` pulls updates without logging in. You revoke access by deleting the key on GitHub.
