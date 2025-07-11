import { 
  Client, 
  GatewayIntentBits, 
  Events, 
  ChannelType, 
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  CommandInteraction,
  ButtonInteraction,
  TextChannel,
  EmbedBuilder
} from "npm:discord.js@14.14.1";

import { sanitizeChannelName } from "./utils.ts";
import type { 
  BotConfig, 
  CommandHandlers, 
  ButtonHandlers,
  MessageContent, 
  InteractionContext,
  BotDependencies
} from "./types.ts";


// ================================
// Helper Functions
// ================================

// deno-lint-ignore no-explicit-any
function convertMessageContent(content: MessageContent): any {
  // deno-lint-ignore no-explicit-any
  const payload: any = {};
  
  if (content.content) payload.content = content.content;
  
  if (content.embeds) {
    payload.embeds = content.embeds.map(e => {
      const embed = new EmbedBuilder();
      if (e.color !== undefined) embed.setColor(e.color);
      if (e.title) embed.setTitle(e.title);
      if (e.description) embed.setDescription(e.description);
      if (e.fields) e.fields.forEach(f => embed.addFields(f));
      if (e.footer) embed.setFooter(e.footer);
      if (e.timestamp) embed.setTimestamp();
      return embed;
    });
  }
  
  if (content.components) {
    payload.components = content.components.map(row => {
      const actionRow = new ActionRowBuilder<ButtonBuilder>();
      row.components.forEach(comp => {
        const button = new ButtonBuilder()
          .setCustomId(comp.customId)
          .setLabel(comp.label);
        
        switch (comp.style) {
          case 'primary': button.setStyle(ButtonStyle.Primary); break;
          case 'secondary': button.setStyle(ButtonStyle.Secondary); break;
          case 'success': button.setStyle(ButtonStyle.Success); break;
          case 'danger': button.setStyle(ButtonStyle.Danger); break;
          case 'link': button.setStyle(ButtonStyle.Link); break;
        }
        
        actionRow.addComponents(button);
      });
      return actionRow;
    });
  }
  
  return payload;
}

// ================================
// Main Bot Creation Function
// ================================

export async function createDiscordBot(
  config: BotConfig, 
  handlers: CommandHandlers,
  buttonHandlers: ButtonHandlers,
  dependencies: BotDependencies
) {
  const { discordToken, applicationId, workDir, repoName, branchName, categoryName } = config;
  const actualCategoryName = categoryName || repoName;
  
  let myChannel: TextChannel | null = null;
  // deno-lint-ignore no-explicit-any no-unused-vars
  let myCategory: any = null;
  
  const botSettings = dependencies.botSettings || {
    mentionEnabled: !!config.defaultMentionUserId,
    mentionUserId: config.defaultMentionUserId || null,
  };
  
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  
  // Use commands from dependencies
  const commands = dependencies.commands;
  
  // Channel management
  // deno-lint-ignore no-explicit-any
  async function ensureChannelExists(guild: any): Promise<TextChannel> {
    const channelName = sanitizeChannelName(branchName);
    
    console.log(`カテゴリー「${actualCategoryName}」を確認中...`);
    
    let category = guild.channels.cache.find(
      // deno-lint-ignore no-explicit-any
      (c: any) => c.type === ChannelType.GuildCategory && c.name === actualCategoryName
    );
    
    if (!category) {
      console.log(`カテゴリー「${actualCategoryName}」を作成中...`);
      try {
        category = await guild.channels.create({
          name: actualCategoryName,
          type: ChannelType.GuildCategory,
        });
        console.log(`カテゴリー「${actualCategoryName}」を作成しました`);
      } catch (error) {
        console.error(`カテゴリー作成エラー: ${error}`);
        throw new Error(`カテゴリーを作成できません。ボットに「Manage Channels」権限があることを確認してください。`);
      }
    }
    
    myCategory = category;
    
    let channel = guild.channels.cache.find(
      // deno-lint-ignore no-explicit-any
      (c: any) => c.type === ChannelType.GuildText && c.name === channelName && c.parentId === category.id
    );
    
    if (!channel) {
      console.log(`チャンネル「${channelName}」を作成中...`);
      try {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `リポジトリ: ${repoName} | ブランチ: ${branchName} | マシン: ${Deno.hostname()} | パス: ${workDir}`,
        });
        console.log(`チャンネル「${channelName}」を作成しました`);
      } catch (error) {
        console.error(`チャンネル作成エラー: ${error}`);
        throw new Error(`チャンネルを作成できません。ボットに「Manage Channels」権限があることを確認してください。`);
      }
    }
    
    return channel as TextChannel;
  }
  
  // Create interaction context wrapper
  function createInteractionContext(interaction: CommandInteraction | ButtonInteraction): InteractionContext {
    return {
      async deferReply(): Promise<void> {
        console.log('Attempting to defer reply, interaction.deferred =', interaction.deferred, 'interaction.replied =', interaction.replied);
        await interaction.deferReply();
        console.log('Successfully deferred reply');
      },
      
      async editReply(content: MessageContent): Promise<void> {
        console.log('Attempting to edit reply, interaction.deferred =', interaction.deferred, 'interaction.replied =', interaction.replied);
        await interaction.editReply(convertMessageContent(content));
        console.log('Successfully edited reply');
      },
      
      async followUp(content: MessageContent & { ephemeral?: boolean }): Promise<void> {
        const payload = convertMessageContent(content);
        payload.ephemeral = content.ephemeral || false;
        await interaction.followUp(payload);
      },
      
      async reply(content: MessageContent & { ephemeral?: boolean }): Promise<void> {
        const payload = convertMessageContent(content);
        payload.ephemeral = content.ephemeral || false;
        await interaction.reply(payload);
      },
      
      async update(content: MessageContent): Promise<void> {
        if ('update' in interaction) {
          await (interaction as ButtonInteraction).update(convertMessageContent(content));
        }
      },
      
      getString(name: string, required?: boolean): string | null {
        if (interaction.isCommand && interaction.isCommand()) {
          // deno-lint-ignore no-explicit-any
          return (interaction as any).options.getString(name, required ?? false);
        }
        return null;
      },
      
      getInteger(name: string, required?: boolean): number | null {
        if (interaction.isCommand && interaction.isCommand()) {
          // deno-lint-ignore no-explicit-any
          return (interaction as any).options.getInteger(name, required ?? false);
        }
        return null;
      }
    };
  }
  
  // Command handler - completely generic
  async function handleCommand(interaction: CommandInteraction) {
    if (!myChannel || interaction.channelId !== myChannel.id) {
      return;
    }
    
    const ctx = createInteractionContext(interaction);
    const handler = handlers.get(interaction.commandName);
    
    if (!handler) {
      await ctx.reply({
        content: `Unknown command: ${interaction.commandName}`,
        ephemeral: true
      });
      return;
    }
    
    try {
      await handler.execute(ctx);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);
      // Try to send error message if possible
      try {
        if (interaction.deferred) {
          await ctx.editReply({
            content: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        } else {
          await ctx.reply({
            content: `Error executing command: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ephemeral: true
          });
        }
      } catch {
        // Ignore errors when sending error message
      }
    }
  }
  
  // Button handler - completely generic
  async function handleButton(interaction: ButtonInteraction) {
    if (!myChannel || interaction.channelId !== myChannel.id) {
      return;
    }
    
    const ctx = createInteractionContext(interaction);
    const handler = buttonHandlers.get(interaction.customId);
    
    if (handler) {
      try {
        await handler(ctx);
      } catch (error) {
        console.error(`Error handling button ${interaction.customId}:`, error);
        try {
          await ctx.followUp({
            content: `Error handling button: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ephemeral: true
          });
        } catch {
          // Ignore errors when sending error message
        }
      }
      return;
    }
    
    // If no specific handler found, try to delegate to command handlers with handleButton method
    const commandHandler = Array.from(handlers.values()).find(h => h.handleButton);
    if (commandHandler?.handleButton) {
      try {
        await commandHandler.handleButton(ctx, interaction.customId);
      } catch (error) {
        console.error(`Error handling button ${interaction.customId} via command handler:`, error);
        try {
          await ctx.followUp({
            content: `Error handling button: ${error instanceof Error ? error.message : 'Unknown error'}`,
            ephemeral: true
          });
        } catch {
          // Ignore errors when sending error message
        }
      }
    } else {
      console.warn(`No handler found for button: ${interaction.customId}`);
    }
  }
  
  // Register commands
  const rest = new REST({ version: '10' }).setToken(discordToken);
  
  try {
    console.log('スラッシュコマンドを登録中...');
    await rest.put(
      Routes.applicationCommands(applicationId),
      { body: commands.map(cmd => cmd.toJSON()) },
    );
    console.log('スラッシュコマンドを登録しました');
  } catch (error) {
    console.error('スラッシュコマンドの登録に失敗しました:', error);
    throw error;
  }
  
  // Event handlers
  client.once(Events.ClientReady, async () => {
    console.log(`ボットがログインしました: ${client.user?.tag}`);
    console.log(`カテゴリー: ${actualCategoryName}`);
    console.log(`ブランチ: ${branchName}`);
    console.log(`作業ディレクトリ: ${workDir}`);
    
    const guilds = client.guilds.cache;
    if (guilds.size === 0) {
      console.error('エラー: ボットが参加しているサーバーがありません');
      return;
    }
    
    const guild = guilds.first();
    if (!guild) {
      console.error('エラー: ギルドが見つかりません');
      return;
    }
    
    try {
      myChannel = await ensureChannelExists(guild);
      console.log(`チャンネル「${myChannel.name}」を使用します`);
      
      await myChannel.send(convertMessageContent({
        embeds: [{
          color: 0x00ff00,
          title: '🚀 起動完了',
          description: `ブランチ ${branchName} のClaude Codeボットが起動しました`,
          fields: [
            { name: 'カテゴリー', value: actualCategoryName, inline: true },
            { name: 'リポジトリ', value: repoName, inline: true },
            { name: 'ブランチ', value: branchName, inline: true },
            { name: '作業ディレクトリ', value: `\`${workDir}\``, inline: false }
          ],
          timestamp: true
        }]
      }));
    } catch (error) {
      console.error('チャンネル作成/取得エラー:', error);
    }
  });
  
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isCommand()) {
      await handleCommand(interaction as CommandInteraction);
    } else if (interaction.isButton()) {
      await handleButton(interaction as ButtonInteraction);
    }
  });
  
  // Login
  await client.login(discordToken);
  
  // Return bot control functions
  return {
    client,
    getChannel() {
      return myChannel;
    },
    updateBotSettings(settings: { mentionEnabled: boolean; mentionUserId: string | null }) {
      botSettings.mentionEnabled = settings.mentionEnabled;
      botSettings.mentionUserId = settings.mentionUserId;
    },
    getBotSettings() {
      return { ...botSettings };
    }
  };
}