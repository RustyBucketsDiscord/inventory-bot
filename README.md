# 📦 Inventory Bot — Discord Order Management

A fully button-driven Discord bot for managing products, orders, payments, and shipping. Zero typing required for buyers — everything is buttons and dropdowns.

---

## 🚀 Setup Guide (Step by Step)

### Step 1: Create a Discord Bot Application

1. Go to **[Discord Developer Portal](https://discord.com/developers/applications)**
2. Click **"New Application"** → give it any name → click **Create**
3. Go to the **Bot** tab on the left
4. Click **"Reset Token"** → copy the token (you'll need this)
5. Scroll down and enable these **Privileged Intents**:
   - ✅ MESSAGE CONTENT INTENT
   - ✅ SERVER MEMBERS INTENT
6. Go to the **OAuth2** tab → copy the **Client ID** (also called Application ID)

### Step 2: Invite the Bot to Your Server

Use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

This gives the bot Administrator permissions (needed for managing channels, roles, etc).

### Step 3: Configure the Bot

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your token + client ID:
   ```
   DISCORD_TOKEN=your-actual-bot-token
   CLIENT_ID=your-actual-client-id
   ```

### Step 4: Install & Run

```bash
# Install dependencies
npm install

# Deploy slash commands (do this once, or after adding new commands)
npm run deploy

# For instant testing on a specific server:
npm run deploy:guild YOUR_SERVER_ID

# Start the bot
npm start
```

---

## 📋 Commands Reference

### Product Management (Staff Only)

| Command | Description |
|---------|-------------|
| `/product-add` | Add a new product with name, price, stock, image, category |
| `/product-edit` | Edit an existing product (dropdown → modal form) |
| `/product-remove` | Remove a product (with confirmation) |
| `/product-restock` | Update stock count for a product |
| `/inventory` | View all products at a glance |
| `/inventory-post` | Post product embeds to a channel (auto-updates) |

### Order Processing (Staff Only)

| Command | Description |
|---------|-------------|
| `/process-order` | Start processing an order in a ticket (select buyer + product) |
| `/tracking` | Add tracking, DM the buyer, close the ticket |
| `/orders` | View order history with filters |

### Payment Methods (Staff Only)

| Command | Description |
|---------|-------------|
| `/payment-add` | Add a payment option (name, instructions, emoji) |
| `/payment-remove` | Remove a payment option |

### Server Settings (Admin Only)

| Command | Description |
|---------|-------------|
| `/brand` | Set bot nickname, log channel |

---

## 🔄 The Order Flow

```
1. BUYER opens a ticket (via Ticket King or whatever ticketing you use)

2. STAFF runs /process-order @buyer
   → Bot shows dropdown of in-stock products

3. STAFF selects the product
   → Bot shows payment method BUTTONS to buyer

4. BUYER clicks a payment method button
   → Bot shows payment instructions + amount

5. BUYER uploads a screenshot of their payment
   → Bot shows screenshot to staff with Approve/Deny buttons

6. STAFF clicks ✅ Approve
   → Stock decreases automatically
   → Inventory display updates automatically
   → Bot asks buyer for their name

7. BUYER types their full name
   → Bot asks for shipping address

8. BUYER types their address
   → Bot shows complete order summary

9. STAFF runs /tracking [order-id] [tracking-number]
   → Bot DMs buyer with tracking info
   → Ticket auto-closes
```

**The buyer only needs to:**
- Click 1 button (payment method)
- Upload 1 image (payment screenshot)
- Type 2 things (name + address)

That's it. Monkey-proof. 🐒

---

## 💡 Quick Start After Setup

1. **Add payment methods:**
   ```
   /payment-add name:CashApp instructions:Send to $YourCashTag emoji:💵
   /payment-add name:PayPal instructions:Send to your@email.com emoji:🅿️
   /payment-add name:Zelle instructions:Send to 555-0123 emoji:💸
   ```

2. **Add products:**
   ```
   /product-add name:Cool Shirt price:29.99 stock:10 description:Premium cotton tee image:https://i.imgur.com/example.jpg category:Clothing
   ```

3. **Post to inventory channel:**
   ```
   /inventory-post channel:#inventory
   ```

4. **Process orders in tickets:**
   ```
   /process-order buyer:@TheBuyer
   ```

---

## 🏗️ Project Structure

```
inventory-bot/
├── index.js              # Main bot entry point
├── deploy-commands.js    # Slash command deployer
├── .env                  # Your bot token (DO NOT SHARE)
├── .env.example          # Template for .env
├── inventory.db          # SQLite database (auto-created)
├── package.json
├── commands/
│   ├── product-add.js
│   ├── product-edit.js
│   ├── product-remove.js
│   ├── product-restock.js
│   ├── inventory.js
│   ├── inventory-post.js
│   ├── process-order.js
│   ├── tracking.js
│   ├── orders.js
│   ├── payment-add.js
│   ├── payment-remove.js
│   └── brand.js
├── events/
│   └── interactionCreate.js   # All button/menu/modal handlers
└── utils/
    ├── database.js            # SQLite database layer
    └── helpers.js             # Embed builders, helpers
```

---

## 🔒 Security Notes

- **Never share your `.env` file** — it contains your bot token
- Bot token = full access to your bot. Treat it like a password.
- The database file (`inventory.db`) contains order info including names and addresses — keep it safe
- Only users with **Manage Server** permission can use staff commands
- Only **Administrators** can use `/brand`

---

## 🌐 Multi-Server Ready

The bot is built to work across multiple servers. Each server has its own:
- Products
- Payment methods
- Orders
- Settings

All stored in the same database, separated by server (guild) ID. When you're ready to sell the bot, it's already set up for it.
