# deploy.ps1 - Minimalist, dependency-free deploy script for Windows PowerShell

# --- Configuration ---
$SERVER_IP = "13.127.147.239"
$SERVER_USER = "ubuntu"
$DEST_DIR = "/var/www/saul"
$IMAGE_NAME = "saul-app"
$SSH_KEY_PATH = "" # e.g. "-i C:\path\to\key.pem"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🚀 Starting Deployment for Saul..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Build the Web UI and Backend locally
Write-Host "📦 1. Building the Docker image locally..."
docker build -t $IMAGE_NAME .
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed! Aborting deployment." -ForegroundColor Red
    exit 1
}

# 2. Ship the compiled app over SSH to the VPS
Write-Host "🚢 2. Shipping the compiled app over SSH to $SERVER_IP..."
# We use cmd.exe here because native PowerShell pipelines can sometimes corrupt binary Docker streams
$SshCommand = "ssh"
if ($SSH_KEY_PATH) {
    $SshCommand = "ssh $SSH_KEY_PATH"
}
cmd.exe /c "docker save $IMAGE_NAME | gzip | $SshCommand $SERVER_USER@$SERVER_IP `"gunzip | docker load`""
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ SSH Transfer failed! Please check your connection and ensure Docker is running on the server." -ForegroundColor Red
    exit 1
}

# 3. Restart the public server and Caddy proxy
Write-Host "🔄 3. Restarting the public server..."
# Using scp instead of rsync since scp is natively built into Windows 10/11 OpenSSH
$ScpCommand = "scp"
if ($SSH_KEY_PATH) {
    $ScpCommand = "scp $SSH_KEY_PATH"
}
Invoke-Expression "$ScpCommand docker-compose.yml .env ${SERVER_USER}@${SERVER_IP}:$DEST_DIR/"

Invoke-Expression "$SshCommand $SERVER_USER@$SERVER_IP `"cd $DEST_DIR && docker compose up -d`""

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Server successfully restarted!" -ForegroundColor Green
    
    # 4. Backup to GitHub
    Write-Host "💾 4. Backing up code to GitHub..."
    git add .
    git commit -m "Auto-deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    git push origin main
    
    Write-Host "🎉 Deployment complete! Your app is live." -ForegroundColor Green
} else {
    Write-Host "❌ Server restart failed. Code was NOT pushed to GitHub." -ForegroundColor Red
}
