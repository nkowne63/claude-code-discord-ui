#!/usr/bin/env -S deno run --allow-all

import { 
  createDiscordBot, 
  type BotConfig,
  type InteractionContext,
  type CommandHandlers
} from "./discord.ts";

import { ShellManager } from "./shell.ts";
import { 
  getGitInfo, 
  executeGitCommand,
  getGitStatus 
} from "./git.ts";

import { createClaudeHandlers } from "./commands/claude.ts";
import { createGitHandlers } from "./commands/git.ts";
import { createShellHandlers } from "./commands/shell.ts";
import { createUtilsHandlers } from "./commands/utils.ts";



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
export { getGitInfo, executeGitCommand } from "./git.ts";
export { sendToClaudeCode } from "./claude/client.ts";

// Claude Code Discord Botを作成
export async function createClaudeCodeBot(config: BotConfig) {
  const { discordToken, applicationId, workDir, repoName, branchName, categoryName, defaultMentionUserId } = config;
  
  // カテゴリー名を決定（指定されていなければリポジトリ名を使用）
  const actualCategoryName = categoryName || repoName;
  
  // Claude Codeセッション管理
  let claudeController: AbortController | null = null;
  let claudeSessionId: string | undefined;
  
  // シェルマネージャーを作成
  const shellManager = new ShellManager(workDir);
  
  // ボット設定を管理（デフォルト値を設定）
  const botSettings = {
    mentionEnabled: !!defaultMentionUserId,  // ユーザーIDが指定されていればオン
    mentionUserId: defaultMentionUserId || null,
  };
  
  // Create Discord bot first to get sendClaudeMessages function
  let bot: any;
  
  // Create handlers with dependencies
  const claudeHandlers = createClaudeHandlers({
    workDir,
    claudeController,
    setClaudeController: (controller) => { claudeController = controller; },
    setClaudeSessionId: (sessionId) => { claudeSessionId = sessionId; },
    sendClaudeMessages: async (messages) => {
      if (bot) {
        await bot.sendClaudeMessages(messages);
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
  const handlers: CommandHandlers = {
    onClaude: claudeHandlers.onClaude,
    onContinue: claudeHandlers.onContinue,
    onClaudeCancel: claudeHandlers.onClaudeCancel,
    onGit: gitHandlers.onGit,
    onWorktree: gitHandlers.onWorktree,
    onWorktreeList: gitHandlers.onWorktreeList,
    onWorktreeRemove: gitHandlers.onWorktreeRemove,
    onWorktreeBot: gitHandlers.onWorktreeBot,
    onShell: shellHandlers.onShell,
    onShellInput: shellHandlers.onShellInput,
    onShellList: shellHandlers.onShellList,
    onShellKill: shellHandlers.onShellKill,
    
    async onStatus(ctx: InteractionContext) {
      const sessionStatus = claudeController ? "実行中" : "待機中";
      const gitStatusInfo = await gitHandlers.getStatus();
      const runningCount = shellHandlers.onShellList(ctx).size;
      
      return {
        claudeStatus: sessionStatus,
        gitStatus: gitStatusInfo.status,
        gitBranch: gitStatusInfo.branch,
        gitRemote: gitStatusInfo.remote,
        runningProcessCount: runningCount,
      };
    },
    
    onSettings: utilsHandlers.onSettings,
    
    async onShutdown(ctx: InteractionContext) {
      // すべてのプロセスを停止
      await shellHandlers.killAllProcesses();
      
      // Claude Codeセッションをキャンセル
      if (claudeController) {
        claudeController.abort();
      }
    }
  };
  
  // Create Discord bot
  bot = await createDiscordBot(config, handlers);
  
  // Signal handlers
  const handleSignal = async (signal: string) => {
    console.log(`\n${signal}シグナルを受信しました。ボットを停止します...`);
    
    try {
      await handlers.onShutdown({} as InteractionContext); // Signal handlerなのでctxは不要
      
      // Send shutdown message
      await bot.sendClaudeMessages([{
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