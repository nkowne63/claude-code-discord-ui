import type { ClaudeResponse, ClaudeMessage } from "./types.ts";
import { sendToClaudeCode } from "./client.ts";
import { convertToClaudeMessages } from "./message-converter.ts";
import { SlashCommandBuilder } from "npm:discord.js@14.14.1";

// Discord command definitions
export const claudeCommands = [
  new SlashCommandBuilder()
    .setName('claude')
    .setDescription('Claude Codeにメッセージを送信')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Claude Codeへのプロンプト')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('session_id')
        .setDescription('継続するセッションID（オプション）')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('continue')
    .setDescription('直前のClaude Codeセッションを継続')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('Claude Codeへのプロンプト（オプション）')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('claude-cancel')
    .setDescription('現在実行中のClaude Codeコマンドをキャンセル'),
];

export interface ClaudeHandlerDeps {
  workDir: string;
  claudeController: AbortController | null;
  setClaudeController: (controller: AbortController | null) => void;
  setClaudeSessionId: (sessionId: string | undefined) => void;
  sendClaudeMessages: (messages: ClaudeMessage[]) => Promise<void>;
}

export function createClaudeHandlers(deps: ClaudeHandlerDeps) {
  const { workDir, sendClaudeMessages } = deps;
  
  return {
    // deno-lint-ignore no-explicit-any
    async onClaude(ctx: any, prompt: string, sessionId?: string): Promise<ClaudeResponse> {
      // 既存のセッションがあればキャンセル
      if (deps.claudeController) {
        deps.claudeController.abort();
      }
      
      const controller = new AbortController();
      deps.setClaudeController(controller);
      
      // インタラクションを延期（最初に実行）
      await ctx.deferReply();
      
      // 初期メッセージを送信
      await ctx.editReply({
        embeds: [{
          color: 0xffff00,
          title: 'Claude Code 実行中...',
          description: '応答を待っています...',
          fields: [{ name: 'プロンプト', value: `\`${prompt.substring(0, 1020)}\``, inline: false }],
          timestamp: true
        }]
      });
      
      const result = await sendToClaudeCode(
        workDir,
        prompt,
        controller,
        sessionId,
        undefined, // onChunkコールバックは使用しない
        (jsonData) => {
          // JSONストリームデータを処理してDiscordに送信
          const claudeMessages = convertToClaudeMessages(jsonData);
          if (claudeMessages.length > 0) {
            sendClaudeMessages(claudeMessages).catch(() => {});
          }
        },
        false // continueMode = false
      );
      
      deps.setClaudeSessionId(result.sessionId);
      deps.setClaudeController(null);
      
      return result;
    },
    
    // deno-lint-ignore no-explicit-any
    async onContinue(ctx: any, prompt?: string): Promise<ClaudeResponse> {
      // 既存のセッションがあればキャンセル
      if (deps.claudeController) {
        deps.claudeController.abort();
      }
      
      const controller = new AbortController();
      deps.setClaudeController(controller);
      
      const actualPrompt = prompt || "続きをお願いします。";
      
      // インタラクションを延期
      await ctx.deferReply();
      
      // 初期メッセージを送信
      const embedData: { color: number; title: string; description: string; timestamp: boolean; fields?: Array<{ name: string; value: string; inline: boolean }> } = {
        color: 0xffff00,
        title: 'Claude Code 会話継続中...',
        description: '最新の会話を読み込んで応答を待っています...',
        timestamp: true
      };
      
      if (prompt) {
        embedData.fields = [{ name: 'プロンプト', value: `\`${prompt.substring(0, 1020)}\``, inline: false }];
      }
      
      await ctx.editReply({ embeds: [embedData] });
      
      const result = await sendToClaudeCode(
        workDir,
        actualPrompt,
        controller,
        undefined, // sessionIdは使用しない
        undefined, // onChunkコールバックは使用しない
        (jsonData) => {
          // JSONストリームデータを処理してDiscordに送信
          const claudeMessages = convertToClaudeMessages(jsonData);
          if (claudeMessages.length > 0) {
            sendClaudeMessages(claudeMessages).catch(() => {});
          }
        },
        true // continueMode = true
      );
      
      deps.setClaudeSessionId(result.sessionId);
      deps.setClaudeController(null);
      
      return result;
    },
    
    // deno-lint-ignore no-explicit-any
    onClaudeCancel(_ctx: any): boolean {
      if (!deps.claudeController) {
        return false;
      }
      
      console.log("Cancelling Claude Code session...");
      deps.claudeController.abort();
      deps.setClaudeController(null);
      deps.setClaudeSessionId(undefined);
      
      return true;
    }
  };
}