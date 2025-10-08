# Dibcord

A library for using Discord as a database.

## Features

- 🗃️ Use Discord channels as database tables
- 📝 Full CRUD operations (Create, Read, Update, Delete)
- 🔍 Query data with custom predicates
- 📊 Schema-based data structure
- 💾 Built-in caching for better performance
- 📦 Handles large data with automatic chunking
- 🔗 Linked-list storage for data exceeding Discord limits

## Installation

```bash
npm install dibcord
```

## Quick Start

```javascript
import { Bot, ChannelTable } from 'dibcord';

// Initialize the bot
const bot = new Bot('YOUR_BOT_TOKEN', 'YOUR_GUILD_ID');

// Define a table schema
const userSchema = {
    columns: ['id', 'name', 'email', 'createdAt'],
    primaryKey: 'id'
};

// Create a table
const usersTable = new ChannelTable('users', userSchema);

// Link the table to the bot
await bot.linkTable(usersTable);

// Insert data
await usersTable.insert({
    id: 'user123',
    name: 'John Doe',
    email: 'john@example.com',
    createdAt: new Date().toISOString()
});

// Find a record
const user = await usersTable.find('user123');
console.log(user.data);

// Query records
const recentUsers = await usersTable.query(user => {
    const createdDate = new Date(user.createdAt);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return createdDate > oneWeekAgo;
});

// Update a record
await usersTable.update({
    id: 'user123',
    name: 'John Smith',
    email: 'johnsmith@example.com',
    createdAt: user.data.createdAt
});

// Delete a record
await usersTable.delete('user123');
```

## API Reference

### Bot Class

#### `new Bot(bot_token, guild_id)`
Creates a new bot instance.

- `bot_token` (string): Your Discord bot token
- `guild_id` (string): The Discord server ID where tables will be created

#### `bot.link_table(table)`
Links a ChannelTable to the bot and initializes it.

- `table` (ChannelTable): The table instance to link

### ChannelTable Class

#### `new ChannelTable(table_name, schema)`
Creates a new table instance.

- `table_name` (string): Name of the table (will be used as channel name)
- `schema` (object): Table schema with `columns` array and `primary_key` string

#### `table.insert(data)`
Inserts a new record into the table.

- `data` (object): The data object to insert (must include primary key)
- Returns: Promise resolving to the created Discord message

#### `table.find(primary_key_value)`
Finds a record by its primary key.

- `primary_key_value`: The value of the primary key to search for
- Returns: Promise resolving to `{data: object, messages: Map}` or `null`

#### `table.query(predicate)`
Queries records using a predicate function.

- `predicate` (function): Function that receives a data object and returns boolean
- Returns: Promise resolving to an array of matching data objects

#### `table.update(new_data)`
Updates an existing record.

- `new_data` (object): The complete new data object (must include primary key)
- Returns: Promise resolving to the created Discord message

#### `table.delete(primary_key_value)`
Deletes a record from the table.

- `primary_key_value`: The primary key value of the record to delete
- Returns: Promise resolving to boolean (true if successful)

## Setup Requirements

1. **Discord Bot**: Create a Discord application and bot at https://discord.com/developers/applications
2. **Bot Permissions**: Ensure your bot has the following permissions in your server:
   - Manage Channels
   - Send Messages
   - Read Message History
   - Manage Messages
3. **Bot Intents**: The bot requires these Gateway Intents:
   - Guilds
   - Guild Messages
   - Message Content

## How It Works

Dibcord uses Discord channels as database tables:

- Each table becomes a Discord channel under a "Dibcord" category
- Records are stored as Discord messages with embedded JSON data
- Large records are automatically chunked across multiple messages
- Messages are linked together using footer references for data reconstruction
- The bot manages all Discord API interactions transparently

## Limitations

- Discord API rate limits apply to all operations
- Message history is limited (older messages may not be accessible)
- Bulk operations are limited by Discord's bulk delete restrictions (14-day limit)
- Query performance depends on channel message history size

## License

AGPL-3.0-or-later

## Author

TotoCodeFR