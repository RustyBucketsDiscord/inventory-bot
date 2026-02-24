#!/bin/bash
echo "🎯 Cybranceze Bot Fresh Start Script"
echo "====================================="

# Step 1: Stop bot if running
echo "1. Stopping bot..."
pm2 stop all 2>/dev/null || true

# Step 2: Update code from GitHub
echo "2. Updating from GitHub..."
git pull origin main

# Step 3: Install dependencies
echo "3. Installing dependencies..."
npm install

# Step 4: Reset ticket database
echo "4. Resetting ticket database..."
node reset-tickets.js

# Step 5: Start bot
echo "5. Starting bot..."
pm2 start index.js --name ticketbot
pm2 save

echo "✅ Done! Bot has been restarted with fresh database."
echo ""
echo "⚠️ IMPORTANT: Discord Command Refresh Required!"
echo "1. Go to your Discord server"
echo "2. Right-click your bot in member list"
echo "3. Click 'Apps' → 'Sync App Commands'"
echo "4. Wait 2 minutes for Discord to update"
echo ""
echo "🧪 Test with: /ticket setup staff-role:@Support"