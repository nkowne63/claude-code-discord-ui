#!/usr/bin/env -S deno run --allow-all

import { 
  createDiscordBot, 
  type BotConfig,
  type InteractionContext,
  type CommandHandlers,
  type ButtonHandlers,
  type BotDependencies
} from "./discord/index.ts";

import { ShellManager } from "./shell/index.ts";
import { getGitInfo } from "./git/index.ts";

import { createClaudeHandlers, claudeCommands, cleanSessionId, createClaudeSender, type DiscordSender } from "./claude/index.ts";
import { createGitHandlers, gitCommands } from "./git/index.ts";
import { createShellHandlers, shellCommands } from "./shell/index.ts";
import { createUtilsHandlers, utilsCommands } from "./util/index.ts";
import { ClaudeMessage } from "./claude/types.ts";



// コマンドライン引数をパース
function parseArgs(args: string[]): { category?: string; userId?: string } {
  const result: { category?: string; userId?: string } = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--category' && i + 1 < args.length) {
      result.category = args[i + 1];
      i++; // 次の引数をスキップ
    } else if (arg === '--user-id' && i + 1 < args.length) {
      result.userId = args[i + 1];
      i++; // 次の引数をスキップ
    } else if (arg.startsWith('--category=')) {
      result.category = arg.split('=')[1];
    } else if (arg.startsWith('--user-id=')) {
      result.userId = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      // 位置引数の場合（後方互換性のため）
      if (!result.category) {
        result.category = arg;
      } else if (!result.userId) {
        result.userId = arg;
      }
    }
  }
  
  return result;
}

// Re-export for backward compatibility
export { getGitInfo, executeGitCommand } from "./git/index.ts";
export { sendToClaudeCode } from "./claude/index.ts";

// Claude Code Discord Botを作成
export async function createClaudeCodeBot(config: BotConfig) {
  const { discordToken, applicationId, workDir, repoName, branchName, categoryName, defaultMentionUserId } = config;
  
  // カテゴリー名を決定（指定されていなければリポジトリ名を使用）
  const actualCategoryName = categoryName || repoName;
  
  // Claude Codeセッション管理
  let claudeController: AbortController | null = null;
  // deno-lint-ignore no-unused-vars
  let claudeSessionId: string | undefined;
  
  // シェルマネージャーを作成
  const shellManager = new ShellManager(workDir);
  
  // ボット設定を管理（デフォルト値を設定）
  const botSettings = {
    mentionEnabled: !!defaultMentionUserId,  // ユーザーIDが指定されていればオン
    mentionUserId: defaultMentionUserId || null,
  };
  
  // Create Discord bot first
  // deno-lint-ignore no-explicit-any prefer-const
  let bot: any;
  
  // We'll create the Claude sender after bot initialization
  let claudeSender: ((messages: ClaudeMessage[]) => Promise<void>) | null = null;
  
  // Create handlers with dependencies (sendClaudeMessages will be updated after bot creation)
  const claudeHandlers = createClaudeHandlers({
    workDir,
    claudeController,
    setClaudeController: (controller) => { claudeController = controller; },
    setClaudeSessionId: (sessionId) => { claudeSessionId = sessionId; },
    sendClaudeMessages: async (messages) => {
      if (claudeSender) {
        await claudeSender(messages);
      }
    }
  });
  
  const gitHandlers = createGitHandlers({
    workDir,
    actualCategoryName,
    discordToken,
    applicationId,
    botSettings
  });
  
  const shellHandlers = createShellHandlers({
    shellManager
  });
  
  const utilsHandlers = createUtilsHandlers({
    workDir,
    repoName,
    branchName,
    actualCategoryName,
    botSettings,
    updateBotSettings: (settings) => {
      botSettings.mentionEnabled = settings.mentionEnabled;
      botSettings.mentionUserId = settings.mentionUserId;
      if (bot) {
        bot.updateBotSettings(settings);
      }
    }
  });
  
  // Command handlers implementation
  const handlers: CommandHandlers = new Map([
    ['claude', {
      execute: async (ctx: InteractionContext) => {
        const prompt = ctx.getString('prompt', true)!;
        const sessionId = ctx.getString('session_id');
        await claudeHandlers.onClaude(ctx, prompt, sessionId || undefined);
      }
    }],
    ['continue', {
      execute: async (ctx: InteractionContext) => {
        const prompt = ctx.getString('prompt');
        await claudeHandlers.onContinue(ctx, prompt || undefined);
      }
    }],
    ['claude-cancel', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const cancelled = claudeHandlers.onClaudeCancel(ctx);
        await ctx.editReply({
          embeds: [{
            color: cancelled ? 0xff0000 : 0x808080,
            title: cancelled ? 'キャンセル成功' : 'キャンセル失敗',
            description: cancelled ? 'Claude Codeセッションをキャンセルしました。' : '実行中のClaude Codeセッションはありません。',
            timestamp: true
          }]
        });
      }
    }],
    ['git', {
      execute: async (ctx: InteractionContext) => {
        const command = ctx.getString('command', true)!;
        await gitHandlers.onGit(ctx, command);
      }
    }],
    ['worktree', {
      execute: async (ctx: InteractionContext) => {
        const branch = ctx.getString('branch', true)!;
        const ref = ctx.getString('ref');
        await gitHandlers.onWorktree(ctx, branch, ref || undefined);
      }
    }],
    ['worktree-list', {
      execute: async (ctx: InteractionContext) => {
        await gitHandlers.onWorktreeList(ctx);
      }
    }],
    ['worktree-remove', {
      execute: async (ctx: InteractionContext) => {
        const branch = ctx.getString('branch', true)!;
        await gitHandlers.onWorktreeRemove(ctx, branch);
      }
    }],
    ['shell', {
      execute: async (ctx: InteractionContext) => {
        const command = ctx.getString('command', true)!;
        await shellHandlers.onShell(ctx, command);
      }
    }],
    ['shell-input', {
      execute: async (ctx: InteractionContext) => {
        const processId = ctx.getInteger('process_id', true)!;
        const input = ctx.getString('input', true)!;
        await shellHandlers.onShellInput(ctx, processId, input);
      }
    }],
    ['shell-list', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const processes = shellHandlers.onShellList(ctx);
        const fields = Array.from(processes.entries()).map(([id, proc]) => ({
          name: `ID: ${id}`,
          value: `\`${proc.command}\`\n開始: ${proc.startTime.toLocaleTimeString()}`,
          inline: false
        }));
        
        await ctx.editReply({
          embeds: [{
            color: 0x00ffff,
            title: '実行中のシェルプロセス',
            description: processes.size === 0 ? '実行中のプロセスはありません。' : undefined,
            fields: fields.slice(0, 25), // Discord limit
            timestamp: true
          }]
        });
      }
    }],
    ['shell-kill', {
      execute: async (ctx: InteractionContext) => {
        const processId = ctx.getInteger('process_id', true)!;
        await shellHandlers.onShellKill(ctx, processId);
      }
    }],
    ['status', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const sessionStatus = claudeController ? "実行中" : "待機中";
        const gitStatusInfo = await gitHandlers.getStatus();
        const runningCount = shellHandlers.onShellList(ctx).size;
        
        await ctx.editReply({
          embeds: [{
            color: 0x00ffff,
            title: 'ステータス',
            fields: [
              { name: 'Claude Code', value: sessionStatus, inline: true },
              { name: 'Git Branch', value: gitStatusInfo.branch, inline: true },
              { name: 'シェルプロセス', value: `${runningCount}個実行中`, inline: true },
              { name: 'メンション', value: botSettings.mentionEnabled ? `有効 (<@${botSettings.mentionUserId}>)` : '無効', inline: true }
            ],
            timestamp: true
          }]
        });
      }
    }],
    ['settings', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const action = ctx.getString('action', true)!;
        const value = ctx.getString('value');
        const result = utilsHandlers.onSettings(ctx, action, value || undefined);
        
        if (!result.success) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: '設定エラー',
              description: result.message,
              timestamp: true
            }]
          });
        } else {
          await ctx.editReply({
            embeds: [{
              color: 0x00ff00,
              title: '設定',
              fields: [
                { name: 'メンション', value: result.mentionEnabled ? `有効 (<@${result.mentionUserId}>)` : '無効', inline: true }
              ],
              timestamp: true
            }]
          });
        }
      }
    }],
    ['pwd', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const result = utilsHandlers.getPwd();
        await ctx.editReply({
          embeds: [{
            color: 0x0099ff,
            title: '作業ディレクトリ',
            fields: [
              { name: 'パス', value: `\`${result.workDir}\``, inline: false },
              { name: 'カテゴリ', value: result.categoryName, inline: true },
              { name: 'リポジトリ', value: result.repoName, inline: true },
              { name: 'ブランチ', value: result.branchName, inline: true }
            ],
            timestamp: true
          }]
        });
      }
    }],
    ['shutdown', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        await ctx.editReply({
          embeds: [{
            color: 0xff0000,
            title: 'シャットダウン',
            description: 'ボットを停止しています...',
            timestamp: true
          }]
        });
        
        // すべてのプロセスを停止
        shellHandlers.killAllProcesses();
        
        // Claude Codeセッションをキャンセル
        if (claudeController) {
          claudeController.abort();
        }
        
        // 少し待ってから終了
        setTimeout(() => {
          Deno.exit(0);
        }, 1000);
      }
    }]
  ]);
  
  // Create dependencies object
  const dependencies: BotDependencies = {
    commands: [
      ...claudeCommands,
      ...gitCommands,
      ...shellCommands,
      ...utilsCommands,
    ],
    cleanSessionId
  };

  // Create Discord bot
  // Button handlers
  const buttonHandlers: ButtonHandlers = new Map();
  
  bot = await createDiscordBot(config, handlers, buttonHandlers, dependencies);
  
  // Create Discord sender for Claude messages
  const discordSender: DiscordSender = {
    async sendMessage(content) {
      const channel = bot.getChannel();
      if (channel) {
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("npm:discord.js@14.14.1");
        
        // Convert MessageContent to Discord format
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
            // deno-lint-ignore no-explicit-any
            const actionRow = new ActionRowBuilder<any>();
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
        
        await channel.send(payload);
      }
    }
  };
  
  // Create Claude sender function
  claudeSender = createClaudeSender(discordSender);
  
  // Signal handlers
  const handleSignal = async (signal: string) => {
    console.log(`\n${signal}シグナルを受信しました。ボットを停止します...`);
    
    try {
      // すべてのプロセスを停止
      shellHandlers.killAllProcesses();
      
      // Claude Codeセッションをキャンセル
      if (claudeController) {
        claudeController.abort();
      }
      
      // Send shutdown message
      if (claudeSender) {
        await claudeSender([{
          type: 'system',
          content: '',
          metadata: {
            subtype: 'shutdown',
            signal,
            categoryName: actualCategoryName,
            repoName,
            branchName
          }
        }]);
      }
      
      setTimeout(() => {
        bot.client.destroy();
        Deno.exit(0);
      }, 1000);
    } catch (error) {
      console.error('シャットダウン中にエラーが発生しました:', error);
      Deno.exit(1);
    }
  };
  
  Deno.addSignalListener("SIGINT", () => handleSignal("SIGINT"));
  Deno.addSignalListener("SIGTERM", () => handleSignal("SIGTERM"));
  
  return bot;
}

// メイン実行
if (import.meta.main) {
  try {
    // 環境変数とコマンドライン引数を取得
    const discordToken = Deno.env.get("DISCORD_TOKEN");
    const applicationId = Deno.env.get("APPLICATION_ID");
    const envCategoryName = Deno.env.get("CATEGORY_NAME");
    const envMentionUserId = Deno.env.get("DEFAULT_MENTION_USER_ID");
    
    if (!discordToken || !applicationId) {
      console.error("エラー: DISCORD_TOKEN と APPLICATION_ID 環境変数が必要です");
      Deno.exit(1);
    }
    
    // コマンドライン引数をパース
    const args = parseArgs(Deno.args);
    const categoryName = args.category || envCategoryName;
    const defaultMentionUserId = args.userId || envMentionUserId;
    
    // Git情報を取得
    const gitInfo = await getGitInfo();
    
    // ボットを作成・起動
    await createClaudeCodeBot({
      discordToken,
      applicationId,
      workDir: Deno.cwd(),
      repoName: gitInfo.repo,
      branchName: gitInfo.branch,
      categoryName,
      defaultMentionUserId,
    });
    
    console.log("ボットが起動しました。Ctrl+Cで停止します。");
  } catch (error) {
    console.error("ボットの起動に失敗しました:", error);
    Deno.exit(1);
  }
}