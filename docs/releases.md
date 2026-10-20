# Releases and deployment

The repository includes workflows, not a preconfigured hosted service. Finish this setup once, then use **Release** and **Deploy backend** in GitHub Actions. Publishing an APK does not deploy the server. GitHub Pages serves only the download page.

## 1. GitHub access and download page

- Use a GitHub account with write/admin access to this repository. `gh auth status` shows the active account; if necessary use `gh auth switch --user <your-account>`.
- Push reviewed changes to `main`. Workflow files must exist there before manual runs are available.
- In repository **Settings → Pages**, choose **GitHub Actions** as the source. Run **Actions → Download page**. Its deployment output gives the actual site URL; the default for this repository is `https://gajendrasinghdawar.github.io/Saul/`.
- The page always links to `releases/latest/download/saul.apk`. This link becomes usable only after the first successful signed release. No page update is needed for subsequent releases.
- For anonymous APK sharing, release assets must be publicly accessible. A private repository's assets require authentication. Do not change repository visibility without reviewing its complete history for sensitive data.
- Enable Actions and allow the workflows' declared token permissions. GHCR publication needs package-write access. Make the container package public for anonymous VPS pulls, or log Docker into GHCR on the VPS with a read-only package token. GitHub's release token is not installed on the VPS.

## 2. Android signing and public URLs

Create a GitHub Actions environment named **release**, restricted to `main`. Add these environment variables:

| Variable | Value |
| --- | --- |
| `SAUL_GATEWAY_URL` | Public HTTPS backend URL, e.g. `https://saul.example.com` |
| `SAUL_WEB_URL` | Public HTTPS web URL; normally the same URL because the container serves both |

These are not localhost URLs and not the Pages URL. Verify the backend's health, browser sign-in, and device authorization over HTTPS before sharing the APK.

Create a signing key **only if this app has never had a release key**. Reuse an existing release key instead of replacing it. Run with a JDK's `keytool`, outside the repository:

```sh
keytool -genkeypair -keystore saul-release.jks -alias saul -keyalg RSA -keysize 3072 -validity 10000
```

Let the command prompt for passwords. Back up the key, alias, and passwords securely; losing them prevents compatible updates. Base64 is only an encoding, not encryption.

Add these **environment secrets** through GitHub's UI or `gh secret set --env release <name>`. Never paste credentials into issues, commits, or an agent conversation:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded bytes of the keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias, e.g. `saul` |
| `ANDROID_KEY_PASSWORD` | Private-key password; commonly the same as the keystore password |

For example, from Linux/WSL, send the key directly to GitHub without a temporary encoded file:

```sh
base64 -w 0 /secure/path/saul-release.jks | gh secret set --env release ANDROID_KEYSTORE_BASE64
```

PowerShell equivalent:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure\saul-release.jks')) | gh secret set --env release ANDROID_KEYSTORE_BASE64
```

Debug and release signing identities differ. If a debug app with this application ID is installed, uninstall it before the first release installation. This removes its local sign-in/drafts, not server history. Later release updates should install over the existing release without uninstalling.

## 3. VPS setup, once

Use a Linux VPS with Docker Engine, Compose v2 supporting `--wait`, and `flock` (util-linux). The image currently targets Linux x86-64. Point your domain's DNS at it, allow inbound TCP 80/443, and secure SSH. Ensure only one installation uses the production Pi database.

Create `/opt/saul`, owned by the deployment user. Docker access is effectively root access: use a dedicated deployment identity and protect its SSH key. Put `docker-compose.yml` and `deploy.sh` there from the reviewed checkout. Never copy the laptop's development `.env` over a production installation.

Create `/opt/saul/.env` on the VPS with permissions `600`:

```dotenv
DOMAIN=saul.example.com
NODE_ENV=production
BETTER_AUTH_URL=https://saul.example.com
BETTER_AUTH_SECRET=<independent-random-secret>
COOKIE_SECRET=<independent-random-secret>
CSRF_SECRET=<independent-random-secret>
SAUL_SECRETS_KEY=<64-hex-character-key-kept-for-this-installation>
SAUL_APP_STORAGE_DATABASE_URL=libsql://<app-database>
SAUL_APP_STORAGE_DATABASE_TOKEN=<app-token>
SAUL_DURABLE_STORAGE_DATABASE_URL=libsql://<different-pi-database>
SAUL_DURABLE_STORAGE_DATABASE_TOKEN=<pi-token>
```

Generate each new secret independently with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` on a trusted machine, or a password manager. Restore an existing installation's secrets instead of generating replacements. Production requires two distinct remote libSQL databases. Startup applies checked-in migrations; never run schema push or generate SQL on the VPS.

Email (`RESEND_API_KEY`, `MY_EMAIL_ADDRESS`) and [private attachment storage](attachments.md) are optional configuration. Password-reset delivery requires working email; production validation warns if Resend is absent. Configure the verified sender before promising password reset to other users; the current auth implementation uses Resend's `onboarding@resend.dev` test sender. Configure an AI provider through web Settings after the first boot. Keep production secrets on the server and in secure backups.

If upgrading an existing Docker volume, check its ownership before changing from an old root-run image to the new non-root Node user (UID 1000). Fix permissions for `/app/data` only as needed after backing it up; do not delete the volume. Retain the Compose project/volume names when moving the deployment directory, or explicitly migrate the existing volume data.

For Actions deployment, create an environment named **production**, restricted to `main`, with required reviewers where available:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `VPS_HOST` | VPS hostname or IPv4 address |
| Variable | `VPS_USER` | SSH deployment user |
| Secret | `VPS_SSH_KEY` | Dedicated private SSH key, matching an authorized key on the VPS |
| Secret | `VPS_KNOWN_HOSTS` | Trusted SSH known_hosts entry, verified against the server's host-key fingerprint through its console |

SSH currently uses port 22. Do not obtain trust merely by accepting an unverified `ssh-keyscan` response. The workflow copies only the Compose file and deployment script, never `.env`. These files and the deployment are serialized through Actions; do not manually replace them during a deployment.

## 4. Normal release: two manual workflow runs

1. Merge reviewed changes to `main`; confirm **Checks** passes. Back up production state before deploying migrations.
2. Run **Release** on `main`, entering a version such as `1.0.1` and a strictly increasing Android version code such as `2`. The workflow reruns checks, builds and verifies the signed APK, pushes the backend container, and creates a GitHub release containing `saul.apk`, `saul.apk.sha256`, `backend-image.txt`, and a version-code record. Do not manually edit or delete those records; later releases use them to prevent version-code reuse.
3. Run **Deploy backend** on `main`, pasting the immutable GHCR digest from `backend-image.txt`. The workflow uploads current deployment files, pulls before stopping the old backend, stops it before starting its replacement, and waits for container readiness. Expect brief downtime; this deliberately avoids overlapping Pi owners. No automatic deployment occurs when you push code or publish an APK.
4. Check `/health`, `/ready`, HTTPS login, a real chat, and Android browser authorization. Verify an approval/scheduled task survives a controlled restart before calling the installation daily-use ready. Share the Pages URL only after these checks.

Manual alternative, from `/opt/saul` on the VPS:

```sh
bash deploy.sh ghcr.io/gajendrasinghdawar/saul@sha256:<digest-from-backend-image.txt>
```

The script never commits/pushes, builds on the VPS, prunes Docker, or deletes volumes. For subsequent Compose diagnostics, export `SAUL_IMAGE` to that same digest first, since Compose requires it. A Docker restart uses the existing container image; a future Compose replacement must explicitly select an image again.

## Failures, backups, and rollback

- A failed deployment exits nonzero. Inspect `docker compose logs --tail=100 saul-api` with the intended `SAUL_IMAGE` exported. A failed pull leaves the old backend running; a failure after the stop may leave the service unavailable. Do not blindly restart repeatedly.
- `/ready` checks the harness, not provider credentials or all external services. Compose health checks do not themselves restart an unhealthy-but-running process. Fatal harness failure exits the backend, which `restart: unless-stopped` restarts. Monitor restart loops and external availability.
- Keep backups of both databases, the separate encryption key and other signing secrets, attachment objects, and agent workspace files. Caddy's certificate state and `/app/data` use persistent Docker volumes. The VPS is not fully disposable unless those files are backed up too.
- Roll back by deploying a prior immutable image **only if its code is compatible with the migrated databases**. Otherwise restore a consistent backup in a controlled maintenance window. Never restore or migrate storage while another Saul process owns it.
- A stopped/interrupted release may have pushed a container without creating a release. Inspect Actions and GHCR before retrying. A completed release cannot be overwritten; use a new version/versionCode.
- GitHub-hosted workflow execution, registry access, VPS deployment, production credentials, and physical-phone release installation must be verified in your environment. Passing local builds alone does not prove those integrations.
