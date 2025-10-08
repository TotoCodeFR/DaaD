import { ChannelType, Client, GatewayIntentBits } from "discord.js";

class Bot {
    constructor(bot_token, guild_id, category_name = 'Dibcord') {
        this.guild_id = guild_id;
        this.guild = null;
        this.dbCategory = null;

        // A map to hold all ChannelTable instances
        this.tables = new Map();

        // Init the discord client with necessary intents
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ]
        });

        // A promise that resolves when the bot is ready and the guild is found
        this.ready = new Promise(resolve => {
            this.client.once('clientReady', async () => {
                try {
                    this.guild = await this.client.guilds.fetch(this.guild_id);
                } catch {
                    throw new Error("Could not find guild with ID " + this.guild_id)
                }

                await this.guild.channels.fetch();

                let category = this.guild.channels.cache.find(
                    c => c.name === category_name && c.type === ChannelType.GuildCategory
                );

                if (!category) {
                    category = await this.guild.channels.create({
                        name: category_name,
                        type: ChannelType.GuildCategory,
                        permissionOverwrites: [{
                            id: this.guild.roles.everyone,
                            deny: ['ViewChannel'],
                        }, ],
                    });
                }
                this.dbCategory = category;
                resolve();
            });
        });

        this.client.login(bot_token);
    }

    /**
     * Links a ChannelTable to this bot, initializing it with a channel.
     * @param {ChannelTable} table The table to link.
     */
    async linkTable(table) {
        await this.ready; // Ensure the bot is ready before proceeding
        if (!this.guild) throw new Error("Cannot link table, guild not found.");

        await table._initialize(this);
        this.tables.set(table.table_name, table);
    }
}

class ChannelTable {
    constructor(table_name, schema) {
        this.table_name = table_name;
        this.channel_id = null;
        this.channel = null;

        // Defines the structure of your data, e.g., { columns: ['id', 'name', 'value'], primaryKey: 'id' }
        this.schema = schema;

        // A cache for the "rows" (messages) of the table to reduce API calls.
        // Maps a primary key to the message object and its data.
        this.cache = new Map();
    }

    /**
     * Inserts a new row of data into the table.
     * Handles chunking data if it exceeds Discord's limits.
     * @param {object} data The data to insert. Must include the primary key.
     */
    async insert(data) {
        if (!this.channel) {
            throw new Error(`Table "${this.table_name}" has not been initialized. Link it to the bot first.`);
        }

        const primaryKey = this.schema.primaryKey;
        const pkValue = data[primaryKey];
        if (!pkValue) {
            throw new Error(`Data is missing primary key field: '${primaryKey}'`);
        }

        const dataString = JSON.stringify(data);
        const chunks = this._chunkData(dataString, 3800); // Chunk to fit in embed description

        let nextMessageId = null;
        let createdMessage = null;

        // Post chunks in reverse order to create the linked list
        for (let i = chunks.length - 1; i >= 0; i--) {
            const embed = {
                description: chunks[i],
                footer: nextMessageId ? { text: `next_chunk_id:${nextMessageId}` } : undefined,
            };

            createdMessage = await this.channel.send({
                content: `Row ID: ${pkValue} | Chunk ${i + 1} of ${chunks.length}`,
                embeds: [embed],
            });

            nextMessageId = createdMessage.id;
        }

        // Cache the head of the list (the first message)
        this.cache.set(pkValue, { message: createdMessage, data });
        return createdMessage;
    }

    /**
     * Finds a record by its primary key and reconstructs the full data from chunks.
     * @param {*} pkValue The primary key value to find.
     * @returns {Promise<{data: object, messages: Map<string, Message>}|null>} The reconstructed data and a map of the messages, or null if not found.
     */
    async find(pkValue) {
        if (!this.channel) {
            throw new Error(`Table "${this.table_name}" has not been initialized.`);
        }

        // 1. Find the head message
        const headMessageContent = `Row ID: ${pkValue} | Chunk 1 of`;
        // Fetch recent messages and find the one that starts our chain
        const messages = await this.channel.messages.fetch({ limit: 100 });
        let headMessage = messages.find(m => m.author.id === this.channel.client.user.id && m.content.startsWith(headMessageContent));

        if (!headMessage) {
            return null; // Not found
        }

        // 2. Traverse the linked list to get all chunks
        const allMessages = new Map();
        let currentMessage = headMessage;
        let jsonString = '';

        while (currentMessage) {
            allMessages.set(currentMessage.id, currentMessage);
            const embed = currentMessage.embeds[0];
            if (!embed) break; // Malformed record

            jsonString += embed.description;

            const nextChunkId = embed.footer?.text.startsWith('next_chunk_id:')
                ? embed.footer.text.substring('next_chunk_id:'.length)
                : null;

            if (nextChunkId) {
                try {
                    // Fetch the next message directly by its ID
                    currentMessage = await this.channel.messages.fetch(nextChunkId);
                } catch (error) {
                    console.error(`Could not fetch next chunk ${nextChunkId} for ${pkValue}. Chain is broken.`);
                    currentMessage = null;
                }
            } else {
                currentMessage = null; // End of the chain
            }
        }

        try {
            const data = JSON.parse(jsonString);
            return { data, messages: allMessages };
        } catch (error) {
            console.error(`Failed to parse JSON for ${pkValue}: ${error}`);
            return null;
        }
    }

    /**
     * Queries the table for records matching a predicate function.
     * NOTE: This can be a slow operation as it may need to read and parse many messages.
     * @param {function(object): boolean} predicate A function that returns true for matching records.
     * @returns {Promise<object[]>} An array of data objects for the matching records.
     */
    async query(predicate) {
        if (!this.channel) {
            throw new Error(`Table "${this.table_name}" has not been initialized.`);
        }

        // 1. Fetch all head messages in the channel.
        // For a full implementation, you'd need to paginate through all messages.
        // For now, we'll fetch the last 100, similar to the find method.
        const messages = await this.channel.messages.fetch({ limit: 100 });
        const headMessages = messages.filter(m =>
            m.author.id === this.channel.client.user.id &&
            m.content.includes('| Chunk 1 of')
        );

        const results = [];

        // 2. Iterate over each head message, reconstruct the data, and apply the predicate.
        for (const headMessage of headMessages.values()) {
            const record = await this._reconstructRecord(headMessage);
            if (record && predicate(record.data)) {
                results.push(record.data);
            }
        }

        return results;
    }

    /**
     * (Internal) Reconstructs a full data object from its starting message.
     * @param {Message} headMessage The first message in the data chain.
     * @returns {Promise<{data: object, messages: Map<string, Message>}|null>}
     * @private
     */
    async _reconstructRecord(headMessage) {
        const allMessages = new Map();
        let currentMessage = headMessage;
        let jsonString = '';

        while (currentMessage) {
            allMessages.set(currentMessage.id, currentMessage);
            const embed = currentMessage.embeds[0];
            if (!embed) break;

            jsonString += embed.description;

            const nextChunkId = embed.footer?.text.startsWith('next_chunk_id:') ?
                embed.footer.text.substring('next_chunk_id:'.length) :
                null;

            currentMessage = nextChunkId ? await this.channel.messages.fetch(nextChunkId).catch(() => null) : null;
        }

        try {
            const data = JSON.parse(jsonString);
            return { data, messages: allMessages };
        } catch (error) {
            console.error(`Failed to parse JSON for a record starting with message ${headMessage.id}: ${error}`);
            return null;
        }
    }

    /**
     * Deletes a record from the table.
     * @param {*} pkValue The primary key of the record to delete.
     * @returns {Promise<boolean>} True if deletion was successful.
     */
    async delete(pkValue) {
        const record = await this.find(pkValue);
        if (!record) {
            return false; // Nothing to delete
        }

        // Use bulk delete for efficiency. It requires an array of message IDs.
        // Note: bulkDelete typically only works for messages newer than 2 weeks.
        try {
            await this.channel.bulkDelete(Array.from(record.messages.keys()));
        } catch (error) {
            // Fallback to deleting one by one if bulk delete fails (e.g., for older messages)
            console.warn(`Bulk delete failed for ${pkValue}, falling back to individual deletion. Error: ${error.message}`);
            for (const message of record.messages.values()) {
                await message.delete();
            }
        }

        this.cache.delete(pkValue);
        return true;
    }

    /**
     * Updates a record in the table.
     * @param {object} newData The full new data object for the record, including its primary key.
     */
    async update(newData) {
        const pkValue = newData[this.schema.primaryKey];
        if (!pkValue) {
            throw new Error(`Data is missing primary key field: '${this.schema.primaryKey}'`);
        }
        await this.delete(pkValue);
        return await this.insert(newData);
    }

    /**
     * Splits a string into chunks of a specified size.
     * @param {string} str The string to chunk.
     * @param {number} size The maximum size of each chunk.
     * @returns {string[]} An array of string chunks.
     */
    _chunkData(str, size) {
        const numChunks = Math.ceil(str.length / size);
        const chunks = new Array(numChunks);
        for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
            chunks[i] = str.substr(o, size);
        }
        return chunks;
    }

    /**
     * (Internal) Initializes the table by finding its channel in the guild.
     * This is called by the Bot's linkTable method.
     * @param {Bot} bot The bot instance.
     * @private
     */
    async _initialize(bot) {
        // Convention: channel name is the lowercase table name
        const channelName = this.table_name.toLowerCase();
        let channel = bot.guild.channels.cache.find(
            ch => ch.name === channelName && ch.isTextBased()
        );
 
        if (!channel) {
            channel = await bot.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: bot.dbCategory,
            })
        };

        this.channel = channel;
        this.channel_id = channel.id;
    }
}

export { Bot, ChannelTable };
