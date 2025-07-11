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
        await ctx.deferReply();
        const command = ctx.getString('command', true)!;
        try {
          const result = await gitHandlers.onGit(ctx, command);
          
          // Check if the result contains an error
          const isError = result.startsWith('実行エラー:') || result.startsWith('エラー:') || result.includes('fatal:') || result.includes('error:');
          
          await ctx.editReply({
            embeds: [{
              color: isError ? 0xff0000 : 0x00ff00,
              title: isError ? 'Git Commandエラー' : 'Git Command実行結果',
              description: `\`git ${command}\``,
              fields: [{ name: isError ? 'エラー詳細' : '出力', value: `\`\`\`\n${result.substring(0, 4000)}\n\`\`\``, inline: false }],
              timestamp: true
            }]
          });
        } catch (error) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: 'Git Commandエラー',
              description: `\`git ${command}\``,
              fields: [{ name: 'エラー', value: `\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``, inline: false }],
              timestamp: true
            }]
          });
        }
      }
    }],
    ['worktree', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const branch = ctx.getString('branch', true)!;
        const ref = ctx.getString('ref');
        try {
          const result = await gitHandlers.onWorktree(ctx, branch, ref || undefined);
          
          // Check if the result contains an error
          const isError = result.result.startsWith('実行エラー:') || result.result.startsWith('エラー:') || result.result.includes('fatal:');
          
          if (!isError || result.isExisting === true) {
            // Worktree created successfully, start bot process
            await ctx.editReply({
              embeds: [{
                color: 0xffff00,
                title: result.isExisting === true ? 'Worktree検出 - Bot起動中...' : 'Worktree作成成功 - Bot起動中...',
                fields: [
                  { name: 'ブランチ', value: branch, inline: true },
                  { name: 'パス', value: result.fullPath, inline: false },
                  { name: '結果', value: `\`\`\`\n${result.result}\n\`\`\``, inline: false },
                  { name: 'ステータス', value: 'Botプロセスを起動しています...', inline: false }
                ],
                timestamp: true
              }]
            });
            
            // Start bot process for the worktree
            try {
              await gitHandlers.onWorktreeBot(ctx, result.fullPath, branch);
              
              // Update with success
              await ctx.editReply({
                embeds: [{
                  color: 0x00ff00,
                  title: result.isExisting === true ? 'Worktree Bot起動完了' : 'Worktree作成完了',
                  fields: [
                    { name: 'ブランチ', value: branch, inline: true },
                    { name: 'パス', value: result.fullPath, inline: false },
                    { name: '結果', value: `\`\`\`\n${result.result}\n\`\`\``, inline: false },
                    { name: 'Botステータス', value: result.isExisting === true ? '✅ 既存のWorktreeでBotプロセスが起動しました' : '✅ 新しいBotプロセスが起動しました', inline: false }
                  ],
                  timestamp: true
                }]
              });
            } catch (botError) {
              // Bot start failed, but worktree was created
              await ctx.editReply({
                embeds: [{
                  color: 0xff9900,
                  title: result.isExisting === true ? 'Worktree検出 - Bot起動失敗' : 'Worktree作成成功 - Bot起動失敗',
                  fields: [
                    { name: 'ブランチ', value: branch, inline: true },
                    { name: 'パス', value: result.fullPath, inline: false },
                    { name: '結果', value: `\`\`\`\n${result.result}\n\`\`\``, inline: false },
                    { name: 'Botエラー', value: `\`\`\`\n${botError instanceof Error ? botError.message : String(botError)}\n\`\`\``, inline: false }
                  ],
                  timestamp: true
                }]
              });
            }
          } else {
            // Worktree creation failed
            await ctx.editReply({
              embeds: [{
                color: 0xff0000,
                title: 'Worktree作成エラー',
                fields: [
                  { name: 'ブランチ', value: branch, inline: true },
                  { name: 'パス', value: result.fullPath, inline: false },
                  { name: 'エラー詳細', value: `\`\`\`\n${result.result}\n\`\`\``, inline: false }
                ],
                timestamp: true
              }]
            });
          }
        } catch (error) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: 'Worktree作成エラー',
              fields: [
                { name: 'ブランチ', value: branch, inline: true },
                { name: 'エラー', value: `\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``, inline: false }
              ],
              timestamp: true
            }]
          });
        }
      }
    }],
    ['worktree-list', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        try {
          const result = await gitHandlers.onWorktreeList(ctx);
          await ctx.editReply({
            embeds: [{
              color: 0x00ffff,
              title: 'Git Worktrees',
              fields: [{ name: '一覧', value: `\`\`\`\n${result.result}\n\`\`\``, inline: false }],
              timestamp: true
            }]
          });
        } catch (error) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: 'Worktree一覧取得エラー',
              fields: [{ name: 'エラー', value: `\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``, inline: false }],
              timestamp: true
            }]
          });
        }
      }
    }],
    ['worktree-remove', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const branch = ctx.getString('branch', true)!;
        try {
          await gitHandlers.onWorktreeRemove(ctx, branch);
          await ctx.editReply({
            embeds: [{
              color: 0x00ff00,
              title: 'Worktree削除成功',
              fields: [{ name: 'ブランチ', value: branch, inline: true }],
              timestamp: true
            }]
          });
        } catch (error) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: 'Worktree削除エラー',
              fields: [
                { name: 'ブランチ', value: branch, inline: true },
                { name: 'エラー', value: `\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``, inline: false }
              ],
              timestamp: true
            }]
          });
        }
      }
    }],
    ['shell', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const command = ctx.getString('command', true)!;
        const input = ctx.getString('input');
        try {
          const executionResult = await shellHandlers.onShell(ctx, command, input || undefined);
          
          let isCompleted = false;
          
          // Handle completion asynchronously
          executionResult.onComplete(async (exitCode, output) => {
            if (isCompleted) return;
            isCompleted = true;
            
            const truncatedOutput = output.substring(0, 4000);
            await ctx.editReply({
              embeds: [{
                color: exitCode === 0 ? 0x00ff00 : 0xff0000,
                title: exitCode === 0 ? 'Shell Command完了' : 'Shell Commandエラー',
                description: `\`${command}\``,
                fields: [
                  { name: 'プロセスID', value: executionResult.processId.toString(), inline: true },
                  { name: '終了コード', value: exitCode.toString(), inline: true },
                  { name: '出力', value: `\`\`\`\n${truncatedOutput || '(出力なし)'}\n\`\`\``, inline: false }
                ],
                timestamp: true
              }]
            });
          });
          
          executionResult.onError(async (error) => {
            if (isCompleted) return;
            isCompleted = true;
            
            await ctx.editReply({
              embeds: [{
                color: 0xff0000,
                title: 'Shell Commandエラー',
                description: `\`${command}\``,
                fields: [
                  { name: 'プロセスID', value: executionResult.processId.toString(), inline: true },
                  { name: 'エラー', value: `\`\`\`\n${error.message}\n\`\`\``, inline: false }
                ],
                timestamp: true
              }]
            });
          });
          
          // Show initial running status and wait a bit to see if it completes quickly
          await ctx.editReply({
            embeds: [{
              color: 0xffff00,
              title: 'Shell Command実行開始',
              description: `\`${command}\``,
              fields: [
                { name: 'プロセスID', value: executionResult.processId.toString(), inline: true },
                { name: 'ステータス', value: '実行中...', inline: true }
              ],
              timestamp: true
            }]
          });
          
          // Wait a short time for quick commands
          setTimeout(async () => {
            if (!isCompleted) {
              // Still running after timeout, show long-running status
              try {
                await ctx.editReply({
                  embeds: [{
                    color: 0x0099ff,
                    title: 'Shell Command実行中',
                    description: `\`${command}\``,
                    fields: [
                      { name: 'プロセスID', value: executionResult.processId.toString(), inline: true },
                      { name: 'ステータス', value: '長時間実行中... (完了時に更新されます)', inline: false }
                    ],
                    timestamp: true
                  }]
                });
              } catch {
                // Ignore errors if interaction is no longer valid
              }
            }
          }, 2000);
        } catch (error) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: 'Shell Commandエラー',
              description: `\`${command}\``,
              fields: [{ name: 'エラー', value: `\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``, inline: false }],
              timestamp: true
            }]
          });
        }
      }
    }],
    ['shell-input', {
      execute: async (ctx: InteractionContext) => {
        await ctx.deferReply();
        const processId = ctx.getInteger('id', true)!;
        const input = ctx.getString('text', true)!;
        try {
          const result = await shellHandlers.onShellInput(ctx, processId, input);
          
          if (result.success) {
            await ctx.editReply({
              embeds: [{
                color: 0x00ff00,
                title: '入力送信成功',
                fields: [
                  { name: 'プロセスID', value: processId.toString(), inline: true },
                  { name: '送信データ', value: `\`${input}\``, inline: false },
                  { name: '結果', value: '✅ 入力を送信しました。新しい出力があれば下記に表示されます。', inline: false }
                ],
                timestamp: true
              }]
            });
            
            // Wait a moment for output to be generated, then show new output
            // Use longer timeout for Python3 due to buffering behavior
            const waitTime = input.toLowerCase().includes('python') ? 2000 : 1000;
            setTimeout(async () => {
              const newOutput = shellHandlers.getNewOutput(processId);
              if (newOutput.trim()) {
                const truncatedOutput = newOutput.substring(0, 4000);
                try {
                  await ctx.followUp({
                    embeds: [{
                      color: 0x0099ff,
                      title: '新しい出力',
                      fields: [
                        { name: 'プロセスID', value: processId.toString(), inline: true },
                        { name: '入力', value: `\`${input}\``, inline: true },
                        { name: '出力', value: `\`\`\`\n${truncatedOutput}\n\`\`\``, inline: false }
                      ],
                      timestamp: true
                    }]
                  });
                } catch (error) {
                  console.error('Failed to send followUp output:', error);
                }
              } else {
                // If no output yet, check again after additional time for Python
                setTimeout(async () => {
                  const lateOutput = shellHandlers.getNewOutput(processId);
                  if (lateOutput.trim()) {
                    const truncatedOutput = lateOutput.substring(0, 4000);
                    try {
                      await ctx.followUp({
                        embeds: [{
                          color: 0x0099ff,
                          title: '新しい出力 (遅延)',
                          fields: [
                            { name: 'プロセスID', value: processId.toString(), inline: true },
                            { name: '入力', value: `\`${input}\``, inline: true },
                            { name: '出力', value: `\`\`\`\n${truncatedOutput}\n\`\`\``, inline: false }
                          ],
                          timestamp: true
                        }]
                      });
                    } catch (error) {
                      console.error('Failed to send delayed followUp output:', error);
                    }
                  }
                }, 2000);
              }
            }, waitTime);
          } else {
            await ctx.editReply({
              embeds: [{
                color: 0xff0000,
                title: '入力送信失敗',
                fields: [
                  { name: 'プロセスID', value: processId.toString(), inline: true },
                  { name: '送信データ', value: `\`${input}\``, inline: false },
                  { name: '結果', value: '❌ プロセスが見つかりませんでした。プロセスが終了している可能性があります。', inline: false }
                ],
                timestamp: true
              }]
            });
          }
        } catch (error) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: '入力送信エラー',
              fields: [
                { name: 'プロセスID', value: processId.toString(), inline: true },
                { name: 'エラー', value: `\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``, inline: false }
              ],
              timestamp: true
            }]
          });
        }
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
        await ctx.deferReply();
        const processId = ctx.getInteger('id', true)!;
        try {
          const result = await shellHandlers.onShellKill(ctx, processId);
          await ctx.editReply({
            embeds: [{
              color: result.success ? 0x00ff00 : 0xff0000,
              title: result.success ? 'プロセス停止成功' : 'プロセス停止失敗',
              fields: [
                { name: 'プロセスID', value: processId.toString(), inline: true },
                { name: '結果', value: result.success ? 'プロセスを停止しました' : 'プロセスが見つかりませんでした', inline: false }
              ],
              timestamp: true
            }]
          });
        } catch (error) {
          await ctx.editReply({
            embeds: [{
              color: 0xff0000,
              title: 'プロセス停止エラー',
              fields: [
                { name: 'プロセスID', value: processId.toString(), inline: true },
                { name: 'エラー', value: `\`\`\`\n${error instanceof Error ? error.message : String(error)}\n\`\`\``, inline: false }
              ],
              timestamp: true
            }]
          });
        }
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