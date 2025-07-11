import { 
  Client, 
  GatewayIntentBits, 
  Events, 
  ChannelType, 
  PermissionFlagsBits,
  SlashCommandBuilder,
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

import { cleanSessionId } from "./claude/client.ts";
import { claudeCommands } from "./commands/claude.ts";
import { gitCommands } from "./commands/git.ts";
import { shellCommands } from "./commands/shell.ts";
import { utilsCommands } from "./commands/utils.ts";

// ================================
// Types and Interfaces
// ================================

// Discord-agnostic types for use by index.ts
export interface EmbedData {
  color?: number;
  title?: string;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: boolean;
}

export interface ComponentData {
  type: 'button';
  customId: string;
  label: string;
  style: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
}

export interface MessageContent {
  content?: string;
  embeds?: EmbedData[];
  components?: Array<{ type: 'actionRow'; components: ComponentData[] }>;
}

export interface InteractionContext {
  deferReply(): Promise<void>;
  editReply(content: MessageContent): Promise<void>;
  followUp(content: MessageContent & { ephemeral?: boolean }): Promise<void>;
  reply(content: MessageContent & { ephemeral?: boolean }): Promise<void>;
  update(content: MessageContent): Promise<void>;
  
  // Command option getters
  getString(name: string, required?: boolean): string | null;
  getInteger(name: string, required?: boolean): number | null;
}

export interface BotConfig {
  discordToken: string;
  applicationId: string;
  workDir: string;
  repoName: string;
  branchName: string;
  categoryName?: string;
  defaultMentionUserId?: string;
}

export interface ClaudeResponse {
  response: string;
  sessionId?: string;
  cost?: number;
  duration?: number;
  modelUsed?: string;
}

export interface ClaudeMessage {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'system' | 'other';
  content: string;
  metadata?: any;
}

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

export interface ShellProcess {
  command: string;
  startTime: Date;
  child: any;
  stdin?: WritableStreamDefaultWriter;
}

export interface CommandHandlers {
  onClaude: (ctx: InteractionContext, prompt: string, sessionId?: string) => Promise<ClaudeResponse>;
  onContinue: (ctx: InteractionContext, prompt?: string) => Promise<ClaudeResponse>;
  onClaudeCancel: (ctx: InteractionContext) => Promise<boolean>;
  onGit: (ctx: InteractionContext, command: string) => Promise<string>;
  onWorktree: (ctx: InteractionContext, branch: string, ref?: string) => Promise<{ result: string; fullPath: string; baseDir: string }>;
  onWorktreeList: (ctx: InteractionContext) => Promise<{ result: string; baseDir: string }>;
  onWorktreeRemove: (ctx: InteractionContext, branch: string) => Promise<{ result: string; fullPath: string; baseDir: string }>;
  onShell: (ctx: InteractionContext, command: string, input?: string) => Promise<{
    processId: number;
    onOutput: (callback: (output: string) => void) => void;
    onComplete: (callback: (code: number, output: string) => void) => void;
    onError: (callback: (error: Error) => void) => void;
  }>;
  onShellInput: (ctx: InteractionContext, processId: number, text: string) => Promise<{ success: boolean; process?: ShellProcess }>;
  onShellList: (ctx: InteractionContext) => Map<number, ShellProcess>;
  onShellKill: (ctx: InteractionContext, processId: number) => Promise<{ success: boolean; process?: ShellProcess }>;
  onStatus: (ctx: InteractionContext) => Promise<{
    claudeStatus: string;
    gitStatus: string;
    gitBranch: string;
    gitRemote: string;
    runningProcessCount: number;
  }>;
  onSettings: (ctx: InteractionContext, action: string, value?: string) => {
    success: boolean;
    mentionEnabled?: boolean;
    mentionUserId?: string | null;
    message?: string;
  };
  onShutdown: (ctx: InteractionContext) => Promise<void>;
  onWorktreeBot?: (ctx: InteractionContext, fullPath: string, branch: string) => Promise<void>;
}

// ================================
// Utility Functions
// ================================

export function sanitizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}

// ================================
// Helper Functions
// ================================

function convertMessageContent(content: MessageContent): any {
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

export async function createDiscordBot(config: BotConfig, handlers: CommandHandlers) {
  const { discordToken, applicationId, workDir, repoName, branchName, categoryName } = config;
  const actualCategoryName = categoryName || repoName;
  
  let myChannel: TextChannel | null = null;
  let myCategory: any = null;
  
  const botSettings = {
    mentionEnabled: !!config.defaultMentionUserId,
    mentionUserId: config.defaultMentionUserId || null,
  };
  
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  
  // Combine all commands from modules
  const commands = [
    ...claudeCommands,
    ...gitCommands,
    ...shellCommands,
    ...utilsCommands,
  ];
  
  // Channel management
  async function ensureChannelExists(guild: any): Promise<TextChannel> {
    const channelName = sanitizeChannelName(branchName);
    
    console.log(`カテゴリー「${actualCategoryName}」を確認中...`);
    
    let category = guild.channels.cache.find(
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
        await interaction.deferReply();
      },
      
      async editReply(content: MessageContent): Promise<void> {
        await interaction.editReply(convertMessageContent(content));
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
          return (interaction as any).options.getString(name, required ?? false);
        }
        return null;
      },
      
      getInteger(name: string, required?: boolean): number | null {
        if (interaction.isCommand && interaction.isCommand()) {
          return (interaction as any).options.getInteger(name, required ?? false);
        }
        return null;
      }
    };
  }
  
  // Command handler
  async function handleCommand(interaction: CommandInteraction) {
    if (!myChannel || interaction.channelId !== myChannel.id) {
      return;
    }
    
    const ctx = createInteractionContext(interaction);
    
    switch (interaction.commandName) {
      case 'claude': {
        const prompt = ctx.getString('prompt', true)!;
        const inputSessionId = ctx.getString('session_id');
        await ctx.deferReply();
        
        try {
          await ctx.editReply({
            embeds: [{
              color: 0xffff00,
              title: 'Claude Code 実行中...',
              description: '応答を待っています...',
              fields: [{ name: 'プロンプト', value: `\`${prompt.substring(0, 1020)}\``, inline: false }],
              timestamp: true
            }]
          });
          
          const result = await handlers.onClaude(ctx, prompt, inputSessionId ? cleanSessionId(inputSessionId) : undefined);
          
          // Send completion message with mention if enabled
          let completionMessage = `✅ Claude Code 完了`;
          if (result.sessionId) {
            completionMessage += ` (Session: \`${result.sessionId}\`)`;
          }
          if (botSettings.mentionEnabled && botSettings.mentionUserId) {
            completionMessage = `<@${botSettings.mentionUserId}> ${completionMessage}`;
          }
          
          const resultEmbedData: EmbedData = {
            color: 0x00ff00,
            title: '✅ 完了',
            timestamp: true,
            fields: []
          };
          
          if (result.sessionId) {
            resultEmbedData.fields!.push({ name: 'Session ID', value: `\`${result.sessionId}\``, inline: true });
          }
          if (result.cost !== undefined) {
            resultEmbedData.fields!.push({ name: 'Cost', value: `$${result.cost.toFixed(4)}`, inline: true });
          }
          if (result.duration !== undefined) {
            resultEmbedData.fields!.push({ name: 'Duration', value: `${(result.duration / 1000).toFixed(2)}s`, inline: true });
          }
          if (result.modelUsed) {
            resultEmbedData.fields!.push({ name: 'Model', value: result.modelUsed, inline: true });
          }
          
          await ctx.followUp({
            content: completionMessage,
            embeds: [resultEmbedData]
          });
          
        } catch (error: any) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: '❌ エラー',
              description: `Claude Code実行中にエラーが発生しました:\n\`\`\`\n${error.message}\n\`\`\``,
              timestamp: true
            }]
          });
        }
        break;
      }
      
      case 'continue': {
        const prompt = ctx.getString('prompt');
        await ctx.deferReply();
        
        try {
          const embedData: EmbedData = {
            color: 0xffff00,
            title: 'Claude Code 会話継続中...',
            description: '最新の会話を読み込んで応答を待っています...',
            timestamp: true
          };
          
          if (prompt) {
            embedData.fields = [{ name: 'プロンプト', value: `\`${prompt.substring(0, 1020)}\``, inline: false }];
          }
          
          await ctx.editReply({ embeds: [embedData] });
          
          const result = await handlers.onContinue(ctx, prompt || undefined);
          
          let completionMessage = `✅ Claude Code 継続完了`;
          if (result.sessionId) {
            completionMessage += ` (Session: \`${result.sessionId}\`)`;
          }
          if (botSettings.mentionEnabled && botSettings.mentionUserId) {
            completionMessage = `<@${botSettings.mentionUserId}> ${completionMessage}`;
          }
          
          const resultEmbedData: EmbedData = {
            color: 0x00ff00,
            title: '✅ 継続完了',
            timestamp: true,
            fields: []
          };
          
          if (result.sessionId) {
            resultEmbedData.fields!.push({ name: 'Session ID', value: `\`${result.sessionId}\``, inline: true });
          }
          if (result.cost !== undefined) {
            resultEmbedData.fields!.push({ name: 'Cost', value: `$${result.cost.toFixed(4)}`, inline: true });
          }
          if (result.duration !== undefined) {
            resultEmbedData.fields!.push({ name: 'Duration', value: `${(result.duration / 1000).toFixed(2)}s`, inline: true });
          }
          if (result.modelUsed) {
            resultEmbedData.fields!.push({ name: 'Model', value: result.modelUsed, inline: true });
          }
          
          await ctx.followUp({
            content: completionMessage,
            embeds: [resultEmbedData]
          });
          
        } catch (error: any) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: '❌ エラー',
              description: `会話継続中にエラーが発生しました:\n\`\`\`\n${error.message}\n\`\`\``,
              timestamp: true
            }]
          });
        }
        break;
      }
      
      case 'claude-cancel': {
        const success = await handlers.onClaudeCancel(ctx);
        
        if (!success) {
          await ctx.reply({
            embeds: [{
              color: 0xff9900,
              title: '⚠️ キャンセル不要',
              description: '現在実行中のClaude Codeコマンドはありません。',
              timestamp: true
            }],
            ephemeral: true
          });
          return;
        }
        
        await ctx.reply({
          embeds: [{
            color: 0x00ff00,
            title: '✅ キャンセル完了',
            description: '実行中のClaude Codeコマンドをキャンセルしました。',
            timestamp: true
          }]
        });
        break;
      }
      
      case 'git': {
        const command = ctx.getString('command', true)!;
        await ctx.deferReply();
        
        try {
          const result = await handlers.onGit(ctx, command);
          
          await ctx.editReply({
            embeds: [{
              color: result.includes("エラー") ? 0xff0000 : 0x00ff00,
              title: `Git: ${command}`,
              description: `\`\`\`\n${result.substring(0, 4000)}\n\`\`\``,
              timestamp: true
            }]
          });
          
          if (result.length > 4000) {
            const chunks = result.substring(4000).match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
              await ctx.followUp({ content: `\`\`\`\n${chunk}\n\`\`\`` });
            }
          }
        } catch (error: any) {
          await ctx.editReply({
            content: `Git コマンド実行エラー: ${error.message}`
          });
        }
        break;
      }
      
      case 'worktree': {
        const branch = ctx.getString('branch', true)!;
        const ref = ctx.getString('ref') || branch;
        
        await ctx.deferReply();
        
        try {
          const { result, fullPath, baseDir } = await handlers.onWorktree(ctx, branch, ref);
          
          await ctx.editReply({
            embeds: [{
              color: result.includes("エラー") ? 0xff0000 : 0x00ff00,
              title: `Git Worktree: ${branch}`,
              description: `\`\`\`\n${result}\n\`\`\``,
              fields: [
                { name: 'パス', value: fullPath, inline: false },
                { name: '基準ディレクトリ', value: baseDir, inline: false }
              ],
              timestamp: true
            }]
          });
          
          // Launch new bot if handler is provided
          if (handlers.onWorktreeBot && !result.includes("エラー")) {
            try {
              await handlers.onWorktreeBot(ctx, fullPath, branch);
              
              await ctx.followUp({
                embeds: [{
                  color: 0x00ff00,
                  title: '🚀 新しいボットプロセス',
                  description: `Worktreeディレクトリで新しいボットプロセスを起動しました`,
                  fields: [
                    { name: 'ディレクトリ', value: fullPath, inline: false },
                    { name: 'ブランチ', value: branch, inline: false }
                  ],
                  timestamp: true
                }]
              });
            } catch (botError: any) {
              await ctx.followUp({
                content: `⚠️ ボットプロセスの起動に失敗しました: ${botError.message}`,
                ephemeral: true
              });
            }
          }
        } catch (error: any) {
          await ctx.editReply({
            content: `Worktree作成エラー: ${error.message}`
          });
        }
        break;
      }
      
      case 'worktree-list': {
        await ctx.deferReply();
        
        try {
          const { result, baseDir } = await handlers.onWorktreeList(ctx);
          
          await ctx.editReply({
            embeds: [{
              color: 0x0099ff,
              title: 'Git Worktree 一覧',
              description: `\`\`\`\n${result}\n\`\`\``,
              fields: [{ name: '基準ディレクトリ', value: baseDir, inline: false }],
              timestamp: true
            }]
          });
        } catch (error: any) {
          await ctx.editReply({
            content: `Worktree一覧取得エラー: ${error.message}`
          });
        }
        break;
      }
      
      case 'worktree-remove': {
        const branch = ctx.getString('branch', true)!;
        await ctx.deferReply();
        
        try {
          const { result, fullPath, baseDir } = await handlers.onWorktreeRemove(ctx, branch);
          
          await ctx.editReply({
            embeds: [{
              color: result.includes("エラー") ? 0xff0000 : 0x00ff00,
              title: `Git Worktree 削除: ${branch}`,
              description: `\`\`\`\n${result}\n\`\`\``,
              fields: [
                { name: '削除したパス', value: fullPath, inline: false },
                { name: '基準ディレクトリ', value: baseDir, inline: false }
              ],
              timestamp: true
            }]
          });
        } catch (error: any) {
          await ctx.editReply({
            content: `Worktree削除エラー: ${error.message}`
          });
        }
        break;
      }
      
      case 'shell': {
        const command = ctx.getString('command', true)!;
        const input = ctx.getString('input');
        await ctx.deferReply();
        
        try {
          const shell = await handlers.onShell(ctx, command, input || undefined);
          const processId = shell.processId;
          const startTime = Date.now();
          let output = '';
          let lastUpdate = Date.now();
          let isCompleted = false;
          
          await ctx.editReply({
            embeds: [{
              color: 0xffff00,
              title: `🔧 実行中: ${command}`,
              description: '```\n出力を待っています...\n```',
              footer: { text: `プロセスID: ${processId} | 対話的コマンドの場合は /shell-input ${processId} で入力可能` },
              timestamp: true
            }]
          });
          
          shell.onOutput((data) => {
            output += data;
            const now = Date.now();
            
            if (now - lastUpdate > 2000 && !isCompleted) {
              lastUpdate = now;
              ctx.editReply({
                embeds: [{
                  color: 0xffff00,
                  title: `🔧 実行中: ${command}`,
                  description: `\`\`\`\n${output.substring(Math.max(0, output.length - 3900))}\n\`\`\``,
                  footer: { text: `プロセスID: ${processId} | 経過時間: ${Math.floor((now - startTime) / 1000)}秒 | /shell-input ${processId} で入力可能` },
                  timestamp: true
                }]
              }).catch(() => {});
            }
          });
          
          shell.onComplete((code, finalOutput) => {
            isCompleted = true;
            
            ctx.editReply({
              embeds: [{
                color: code === 0 ? 0x00ff00 : 0xff0000,
                title: `🔧 完了: ${command}`,
                description: `\`\`\`\n${finalOutput.substring(0, 4000)}\n\`\`\``,
                fields: [
                  { name: '終了コード', value: code.toString(), inline: true },
                  { name: '実行時間', value: `${Math.floor((Date.now() - startTime) / 1000)}秒`, inline: true }
                ],
                timestamp: true
              }]
            }).catch(() => {});
            
            if (finalOutput.length > 4000) {
              const chunks = finalOutput.substring(4000).match(/[\s\S]{1,1900}/g) || [];
              for (const chunk of chunks) {
                ctx.followUp({ content: `\`\`\`\n${chunk}\n\`\`\`` }).catch(() => {});
              }
            }
          });
          
          shell.onError((error) => {
            isCompleted = true;
            ctx.editReply({
              embeds: [{
                color: 0xff0000,
                title: '❌ エラー',
                description: `コマンド実行中にエラーが発生しました:\n\`\`\`\n${error.message}\n\`\`\``,
                timestamp: true
              }]
            }).catch(() => {});
          });
          
        } catch (error: any) {
          await ctx.editReply({
            content: `シェルコマンド実行エラー: ${error.message}`
          });
        }
        break;
      }
      
      case 'shell-input': {
        const processId = ctx.getInteger('id', true)!;
        const text = ctx.getString('text', true)!;
        
        try {
          const result = await handlers.onShellInput(ctx, processId, text);
          
          if (!result.success) {
            await ctx.reply({
              content: `❌ プロセスID ${processId} が見つかりません。`,
              ephemeral: true
            });
            return;
          }
          
          await ctx.reply({
            embeds: [{
              color: 0x00ff00,
              title: '✅ 入力送信',
              description: `プロセスID ${processId} に入力を送信しました`,
              fields: [
                { name: 'コマンド', value: `\`${result.process!.command}\``, inline: false },
                { name: '送信内容', value: `\`${text}\``, inline: false }
              ],
              timestamp: true
            }]
          });
        } catch (error: any) {
          await ctx.reply({
            content: `入力送信エラー: ${error.message}`,
            ephemeral: true
          });
        }
        break;
      }
      
      case 'shell-list': {
        const processes = handlers.onShellList(ctx);
        
        if (processes.size === 0) {
          await ctx.reply({
            embeds: [{
              color: 0x0099ff,
              title: '🔧 実行中のプロセス',
              description: '現在実行中のプロセスはありません。',
              timestamp: true
            }]
          });
          return;
        }
        
        const fields: { name: string; value: string; inline: boolean }[] = [];
        for (const [id, process] of processes) {
          const runningTime = Math.floor((Date.now() - process.startTime.getTime()) / 1000);
          fields.push({
            name: `ID: ${id}`,
            value: `コマンド: \`${process.command}\`\n実行時間: ${runningTime}秒`,
            inline: false
          });
        }
        
        await ctx.reply({
          embeds: [{
            color: 0x0099ff,
            title: '🔧 実行中のプロセス',
            description: '以下のプロセスが実行中です：',
            fields,
            timestamp: true
          }]
        });
        break;
      }
      
      case 'shell-kill': {
        const processId = ctx.getInteger('id', true)!;
        
        try {
          const result = await handlers.onShellKill(ctx, processId);
          
          if (!result.success) {
            await ctx.reply({
              content: `❌ プロセスID ${processId} が見つかりません。`,
              ephemeral: true
            });
            return;
          }
          
          await ctx.reply({
            embeds: [{
              color: 0x00ff00,
              title: '✅ プロセス停止',
              description: `プロセスID ${processId} を停止しました。`,
              fields: [{ name: 'コマンド', value: `\`${result.process!.command}\``, inline: false }],
              timestamp: true
            }]
          });
        } catch (error: any) {
          await ctx.reply({
            content: `プロセス停止エラー: ${error.message}`,
            ephemeral: true
          });
        }
        break;
      }
      
      case 'status': {
        await ctx.deferReply();
        
        try {
          const status = await handlers.onStatus(ctx);
          
          await ctx.editReply({
            embeds: [{
              color: 0x0099ff,
              title: '📊 ステータス',
              fields: [
                { name: 'Claude Code', value: status.claudeStatus, inline: true },
                { name: 'カテゴリー', value: actualCategoryName, inline: true },
                { name: 'リポジトリ', value: repoName, inline: true },
                { name: '現在のブランチ', value: status.gitBranch.trim() || branchName, inline: true },
                { name: 'マシン', value: Deno.hostname(), inline: true },
                { name: '実行中のプロセス', value: status.runningProcessCount.toString(), inline: true },
                { name: '作業ディレクトリ', value: `\`${workDir}\``, inline: false },
                { name: 'Git Status', value: `\`\`\`\n${status.gitStatus.substring(0, 1000)}\n\`\`\``, inline: false },
                ...(status.gitRemote ? [{ name: 'Remote', value: `\`\`\`\n${status.gitRemote.substring(0, 1000)}\n\`\`\``, inline: false }] : [])
              ],
              timestamp: true
            }]
          });
        } catch (error: any) {
          await ctx.editReply({
            content: `ステータス取得エラー: ${error.message}`
          });
        }
        break;
      }
      
      case 'pwd': {
        await ctx.reply({
          embeds: [{
            color: 0x0099ff,
            title: '📁 作業ディレクトリ',
            description: `\`${workDir}\``,
            fields: [
              { name: 'カテゴリー', value: actualCategoryName, inline: true },
              { name: 'リポジトリ', value: repoName, inline: true },
              { name: 'ブランチ', value: branchName, inline: true }
            ],
            timestamp: true
          }]
        });
        break;
      }
      
      case 'settings': {
        const action = ctx.getString('action', true)!;
        const value = ctx.getString('value');
        
        const result = handlers.onSettings(ctx, action, value || undefined);
        
        if (!result.success) {
          await ctx.reply({
            content: result.message || '設定変更に失敗しました',
            ephemeral: true
          });
          return;
        }
        
        switch (action) {
          case 'mention-on': {
            botSettings.mentionEnabled = true;
            botSettings.mentionUserId = value;
            await ctx.reply({
              embeds: [{
                color: 0x00ff00,
                title: '✅ 設定変更',
                description: `Claude Code完了時に <@${value}> にメンションします`,
                timestamp: true
              }]
            });
            break;
          }
          
          case 'mention-off': {
            botSettings.mentionEnabled = false;
            await ctx.reply({
              embeds: [{
                color: 0x00ff00,
                title: '✅ 設定変更',
                description: 'Claude Code完了時のメンション機能をオフにしました',
                timestamp: true
              }]
            });
            break;
          }
          
          case 'show': {
            const fields: { name: string; value: string; inline: boolean }[] = [
              { name: 'メンション機能', value: result.mentionEnabled ? 'オン' : 'オフ', inline: true }
            ];
            
            if (result.mentionEnabled && result.mentionUserId) {
              fields.push({
                name: 'メンション対象',
                value: `<@${result.mentionUserId}>`,
                inline: true
              });
            }
            
            await ctx.reply({
              embeds: [{
                color: 0x0099ff,
                title: '⚙️ 現在の設定',
                fields,
                timestamp: true
              }]
            });
            break;
          }
        }
        break;
      }
      
      case 'shutdown': {
        await ctx.reply({
          content: '⚠️ 本当にボットをシャットダウンしますか？',
          components: [{
            type: 'actionRow',
            components: [
              { type: 'button', customId: 'confirm_shutdown', label: '確認', style: 'danger' },
              { type: 'button', customId: 'cancel_shutdown', label: 'キャンセル', style: 'secondary' }
            ]
          }],
          ephemeral: true
        });
        break;
      }
    }
  }
  
  // Button handler
  async function handleButton(interaction: ButtonInteraction) {
    if (!myChannel || interaction.channelId !== myChannel.id) {
      return;
    }
    
    const ctx = createInteractionContext(interaction);
    
    if (interaction.customId === 'confirm_shutdown') {
      await ctx.update({
        content: 'ボットをシャットダウンしています...',
        components: []
      });
      
      try {
        await handlers.onShutdown(ctx);
        
        if (myChannel) {
          await myChannel.send(convertMessageContent({
            embeds: [{
              color: 0xff0000,
              title: '🛑 シャットダウン',
              description: 'Claude Codeボットを停止しました',
              fields: [
                { name: 'カテゴリー', value: actualCategoryName, inline: true },
                { name: 'リポジトリ', value: repoName, inline: true },
                { name: 'ブランチ', value: branchName, inline: true }
              ],
              timestamp: true
            }]
          }));
        }
        
        setTimeout(() => {
          client.destroy();
          Deno.exit(0);
        }, 1000);
      } catch (error: any) {
        await ctx.followUp({
          content: `シャットダウン中にエラーが発生しました: ${error.message}`,
          ephemeral: true
        });
      }
    } else if (interaction.customId === 'cancel_shutdown') {
      await ctx.update({
        content: 'シャットダウンをキャンセルしました。',
        components: []
      });
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
    async sendClaudeMessages(messages: ClaudeMessage[]) {
      if (!myChannel) return;
      
      for (const msg of messages) {
        switch (msg.type) {
          case 'text': {
            const chunks = splitText(msg.content, 4000);
            for (let i = 0; i < chunks.length; i++) {
              await myChannel.send(convertMessageContent({
                embeds: [{
                  color: 0x00ff00,
                  title: chunks.length > 1 ? `Assistant (${i + 1}/${chunks.length})` : 'Assistant',
                  description: chunks[i],
                  timestamp: true
                }]
              }));
            }
            break;
          }
          
          case 'tool_use': {
            if (msg.metadata?.name === 'TodoWrite') {
              const todos = msg.metadata?.input?.todos || [];
              const statusEmojis: Record<string, string> = {
                pending: '⏳',
                in_progress: '🔄',
                completed: '✅'
              };
              const priorityEmojis: Record<string, string> = {
                high: '🔴',
                medium: '🟡',
                low: '🟢'
              };
              
              let todoList = '';
              if (todos.length === 0) {
                todoList = 'タスクリストが空です';
              } else {
                for (const todo of todos) {
                  const statusEmoji = statusEmojis[todo.status] || '❓';
                  const priorityEmoji = priorityEmojis[todo.priority] || '⚪';
                  todoList += `${statusEmoji} ${priorityEmoji} **${todo.content}**\n`;
                }
              }
              
              await myChannel.send(convertMessageContent({
                embeds: [{
                  color: 0x9932cc,
                  title: '📝 Todo List Updated',
                  description: todoList,
                  fields: [{ name: 'Tool ID', value: `\`${msg.metadata.id}\``, inline: true }],
                  footer: { text: '⏳ Pending | 🔄 In Progress | ✅ Completed | 🔴 High | 🟡 Medium | 🟢 Low' },
                  timestamp: true
                }]
              }));
            } else {
              const inputStr = JSON.stringify(msg.metadata?.input || {}, null, 2);
              // Account for the code block markers when calculating max length
              const maxContentLength = 4096 - "```json\n\n```".length - 50; // 50 chars safety margin
              const truncatedInput = inputStr.length > maxContentLength 
                ? inputStr.substring(0, maxContentLength - 3) + '...' 
                : inputStr;
              
              await myChannel.send(convertMessageContent({
                embeds: [{
                  color: 0x0099ff,
                  title: `🔧 Tool Use: ${msg.metadata?.name || 'Unknown'}`,
                  description: `\`\`\`json\n${truncatedInput}\n\`\`\``,
                  fields: [{ name: 'Tool ID', value: `\`${msg.metadata?.id || 'Unknown'}\``, inline: true }],
                  timestamp: true
                }]
              }));
            }
            break;
          }
          
          case 'tool_result': {
            // Account for code block markers when splitting
            const maxChunkLength = 4096 - "```\n\n```".length - 50; // 50 chars safety margin
            const chunks = splitText(msg.content, maxChunkLength);
            for (let i = 0; i < chunks.length; i++) {
              await myChannel.send(convertMessageContent({
                embeds: [{
                  color: 0x00ffff,
                  title: chunks.length > 1 ? `🔧 Tool Result (${i + 1}/${chunks.length})` : '🔧 Tool Result',
                  description: `\`\`\`\n${chunks[i]}\n\`\`\``,
                  timestamp: true
                }]
              }));
            }
            break;
          }
          
          case 'thinking': {
            const chunks = splitText(msg.content, 4000);
            for (let i = 0; i < chunks.length; i++) {
              await myChannel.send(convertMessageContent({
                embeds: [{
                  color: 0x9b59b6,
                  title: chunks.length > 1 ? `💭 Thinking (${i + 1}/${chunks.length})` : '💭 Thinking',
                  description: chunks[i],
                  timestamp: true
                }]
              }));
            }
            break;
          }
          
          case 'system': {
            const embedData: EmbedData = {
              color: 0xaaaaaa,
              title: `⚙️ System: ${msg.metadata?.subtype || 'info'}`,
              timestamp: true,
              fields: []
            };
            
            if (msg.metadata?.cwd) {
              embedData.fields!.push({ name: 'Working Directory', value: `\`${msg.metadata.cwd}\``, inline: false });
            }
            if (msg.metadata?.session_id) {
              embedData.fields!.push({ name: 'Session ID', value: `\`${msg.metadata.session_id}\``, inline: false });
            }
            if (msg.metadata?.model) {
              embedData.fields!.push({ name: 'Model', value: msg.metadata.model, inline: true });
            }
            if (msg.metadata?.total_cost_usd !== undefined) {
              embedData.fields!.push({ name: 'Cost', value: `$${msg.metadata.total_cost_usd.toFixed(4)}`, inline: true });
            }
            if (msg.metadata?.duration_ms !== undefined) {
              embedData.fields!.push({ name: 'Duration', value: `${(msg.metadata.duration_ms / 1000).toFixed(2)}s`, inline: true });
            }
            
            // Special handling for shutdown
            if (msg.metadata?.subtype === 'shutdown') {
              embedData.color = 0xff0000;
              embedData.title = '🛑 シャットダウン';
              embedData.description = `シグナル ${msg.metadata.signal} によりボットが停止しました`;
              embedData.fields = [
                { name: 'カテゴリー', value: msg.metadata.categoryName, inline: true },
                { name: 'リポジトリ', value: msg.metadata.repoName, inline: true },
                { name: 'ブランチ', value: msg.metadata.branchName, inline: true }
              ];
            }
            
            await myChannel.send(convertMessageContent({ embeds: [embedData] }));
            break;
          }
          
          case 'other': {
            const jsonStr = JSON.stringify(msg.metadata || msg.content, null, 2);
            // Account for code block markers when splitting
            const maxChunkLength = 4096 - "```json\n\n```".length - 50; // 50 chars safety margin
            const chunks = splitText(jsonStr, maxChunkLength);
            for (let i = 0; i < chunks.length; i++) {
              await myChannel.send(convertMessageContent({
                embeds: [{
                  color: 0xffaa00,
                  title: chunks.length > 1 ? `Other Content (${i + 1}/${chunks.length})` : 'Other Content',
                  description: `\`\`\`json\n${chunks[i]}\n\`\`\``,
                  timestamp: true
                }]
              }));
            }
            break;
          }
        }
      }
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

function splitText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.substring(i, i + maxLength));
  }
  return chunks;
}