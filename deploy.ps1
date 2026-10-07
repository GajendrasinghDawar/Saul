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

# 1. Package the source code (Excluding heavy/unnecessary folders)
Write-Host "📦 1. Zipping source code..."
# Use Windows native tar to compress the project
tar.exe -czf saul-src.tar.gz --exclude=node_modules --exclude=.git --exclude=.scratch --exclude=saul-src.tar.gz .
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to zip source code." -ForegroundColor Red
    exit 1
}

# 2. Ship the code to the VPS
Write-Host "🚢 2. Uploading code to $SERVER_IP..."
$ScpCommand = "scp"
$SshCommand = "ssh"
if ($SSH_KEY_PATH) {
    $ScpCommand = "scp $SSH_KEY_PATH"
    $SshCommand = "ssh $SSH_KEY_PATH"
}

# Ensure destination directory exists and has correct permissions
Invoke-Expression "$SshCommand $SERVER_USER@$SERVER_IP `"sudo mkdir -p $DEST_DIR && sudo chown -R $SERVER_USER:$SERVER_USER $DEST_DIR`""

# Upload the zip file
Invoke-Expression "$ScpCommand saul-src.tar.gz ${SERVER_USER}@${SERVER_IP}:$DEST_DIR/"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ SCP Transfer failed!" -ForegroundColor Red
    exit 1
}

# Clean up local zip
Remove-Item saul-src.tar.gz -ErrorAction SilentlyContinue

# 3. Build and Restart on the Server
Write-Host "🔄 3. Building and restarting the server (This may take a few minutes)..."
$RemoteScript = @"
cd $DEST_DIR
tar -xzf saul-src.tar.gz
rm saul-src.tar.gz
echo '🧹 Cleaning up old Docker files to save disk space...'
docker system prune -f
echo '🏗️ Building new Docker image...'
docker build -t $IMAGE_NAME .
echo '🚀 Starting Docker Compose...'
docker compose up -d
"@

Invoke-Expression "$SshCommand $SERVER_USER@$SERVER_IP `"$RemoteScript`""

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Server successfully updated and restarted!" -ForegroundColor Green
    
    # 4. Backup to GitHub
    Write-Host "💾 4. Backing up code to GitHub..."
    git add .
    git commit -m "Auto-deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    git push origin main
    
    Write-Host "🎉 Deployment complete! Your app is live." -ForegroundColor Green
} else {
    Write-Host "❌ Server build/restart failed." -ForegroundColor Red
}
