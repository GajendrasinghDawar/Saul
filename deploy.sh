#!/bin/bash
# deploy.sh - Minimalist, dependency-free deploy script for Saul

# --- Configuration ---
# Update this with your actual AWS EC2 IP address or domain
SERVER_IP="1.2.3.4" 
SERVER_USER="ubuntu"
DEST_DIR="/var/www/saul"
IMAGE_NAME="saul-app"

echo "========================================"
echo "🚀 Starting Deployment for Saul..."
echo "========================================"

# 1. Build the Web UI and Backend locally (Uses your laptop CPU/RAM, prevents server crash)
echo "📦 1. Building the Docker image locally..."
docker build -t $IMAGE_NAME .
if [ $? -ne 0 ]; then
  echo "❌ Build failed! Aborting deployment."
  exit 1
fi

# 2. Ship the compiled app over SSH to the VPS
echo "🚢 2. Shipping the compiled app over SSH to $SERVER_IP..."
# This compresses the image, streams it over SSH, and loads it directly into the server's Docker daemon
docker save $IMAGE_NAME | gzip | ssh $SERVER_USER@$SERVER_IP 'gunzip | docker load'
if [ $? -ne 0 ]; then
  echo "❌ SSH Transfer failed! Please check your connection and ensure Docker is running on the server."
  exit 1
fi

# 3. Restart the public server and Caddy proxy
echo "🔄 3. Restarting the public server..."
# We also sync the docker-compose.yml and .env files to ensure the server has the latest config
rsync -avz docker-compose.yml .env $SERVER_USER@$SERVER_IP:$DEST_DIR/
ssh $SERVER_USER@$SERVER_IP "cd $DEST_DIR && docker compose up -d"

if [ $? -eq 0 ]; then
  echo "✅ Server successfully restarted!"
  
  # 4. Backup to GitHub
  echo "💾 4. Backing up code to GitHub..."
  git add .
  git commit -m "Auto-deploy: $(date +'%Y-%m-%d %H:%M')"
  git push origin main
  
  echo "🎉 Deployment complete! Your app is live."
else
  echo "❌ Server restart failed. Code was NOT pushed to GitHub."
fi
