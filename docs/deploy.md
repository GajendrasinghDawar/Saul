# Deployment Architecture

Saul uses a **zero-dependency, platform-agnostic** deployment strategy. We completely bypass heavy CI/CD pipelines (like GitHub Actions) and third-party registries (like Docker Hub). 

Instead, deployment is handled by a lightweight local script that pushes code directly to your VPS (e.g., AWS EC2) over SSH, where it is built and orchestrated using Docker and Caddy.

## Core Components
1. **The Scripts (`deploy.ps1` / `deploy.sh`):** Zips the source code locally (excluding `node_modules`), uploads it via `scp` to the server, and runs the remote build.
2. **Docker Engine:** The server uses Docker to create an isolated environment for the Node.js backend and React frontend.
3. **Caddy Web Server:** Configured in `docker-compose.yml`, Caddy acts as a reverse proxy. It automatically provisions and renews **Let's Encrypt SSL certificates** for your domain.

---

## Prerequisites

Before running a deployment, ensure your server is properly prepared.

### 1. Server Requirements
* **OS:** Ubuntu Linux (AWS EC2, DigitalOcean, etc.)
* **RAM:** At least 1GB (2GB+ recommended for building).
* **Disk Space:** At least 15GB-20GB total disk space (Docker builds generate a lot of temporary cache).

### 2. DNS Configuration
Point your domain's A-Record to your server's public IP address.
*(e.g., `saul.gajendrasinghdawar.me -> 13.127.147.239`)*

### 3. Server Environment File
On your VPS, you must manually create the production `.env` file once.

```bash
# Log into your server
ssh ubuntu@YOUR_SERVER_IP

# Create the directory and environment file
sudo mkdir -p /var/www/saul
sudo chown -R ubuntu:ubuntu /var/www/saul
cd /var/www/saul
nano .env
```

**Required variables in `.env`:**
```env
# Critical for Caddy SSL to work
DOMAIN=saul.gajendrasinghdawar.me

# Your production database credentials
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...

# Authentication Secrets
BETTER_AUTH_SECRET=your-random-secure-string
BETTER_AUTH_URL=https://saul.gajendrasinghdawar.me
```

---

## How to Deploy

From your local machine, simply run the deploy script. 
If you are on **Windows PowerShell**, use:
```powershell
.\deploy.ps1
```

If you are on **Linux, Mac, or WSL**, use:
```bash
bash deploy.sh
```

### What the script does:
1. Compresses the source code into a `.tar.gz` file.
2. Uses `scp` to upload it to `/var/www/saul` on your VPS.
3. SSHs into the VPS and unzips the code.
4. Aggressively cleans up old server logs and Docker caches to prevent `ENOSPC` (No space left on device) errors.
5. Runs `sudo docker build` to compile the app.
6. Runs `sudo docker compose up -d` to restart the live server.
7. Automatically commits your changes to GitHub if the deployment succeeds.

---

## Troubleshooting

### 1. `ENOSPC: no space left on device` during Docker build
Docker uses a lot of disk space for intermediate build layers. If you hit this error:
* Check your free space with `df -h`.
* If you are on an 8GB AWS EC2 instance, expand your EBS volume to 20GB or 30GB in the AWS Console, then reboot the server.

### 2. SSH Permission Denied
If the script fails to connect, ensure your local SSH key is authorized on the server. You can authorize your computer by pasting your public key (`~/.ssh/id_ed25519.pub`) into the `~/.ssh/authorized_keys` file on the VPS.

### 3. Caddy SSL is not working (Not Secure)
* Ensure port `80` and `443` are open in your AWS EC2 Security Group.
* Ensure the `DOMAIN` variable is set correctly in `/var/www/saul/.env`.
* Check Caddy logs: `sudo docker logs saul_caddy`.
