# telegram-send-bot — Console Mass-Messenger

A terminal-based script for sending messages to multiple Telegram dialogs via your account session.

## Features

- Bulk messaging to users, bots, chats, and channels  
- Optionally include/exclude archived or pinned dialogs  
- Interactive console menu to view dialogs and toggle options  
- Auto-delete messages after sending  
- Session management with `session.txt`

## Installation

```bash
git clone https://github/redeflesq/telegram-send-bot
cd telegram-send-bot
npm install
```

## Configuration

Create `settings.ini` with your Telegram API credentials:

```ini
[main]
api_id=YOUR_API_ID
api_hash=YOUR_API_HASH
session=session.txt
```

Get your credentials at [my.telegram.org/auth](https://my.telegram.org/auth).

## Usage

```bash
node index.js 
```

Follow the prompts to log in with your phone number and code. Then use the interactive menu to manage dialogs and send messages.
