import type { InteractionContext } from "../discord.ts";
import { ShellManager } from "../shell.ts";
import { SlashCommandBuilder } from "npm:discord.js@14.14.1";

// Discord command definitions
export const shellCommands = [
  new SlashCommandBuilder()
    .setName('shell')
    .setDescription('シェルコマンドを実行（対話的コマンド対応）')
    .addStringOption(option =>
      option.setName('command')
        .setDescription('実行するコマンド')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('input')
        .setDescription('初期標準入力（オプション）')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('shell-input')
    .setDescription('実行中のシェルプロセスに標準入力を送信')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('プロセスID')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('text')
        .setDescription('送信するテキスト')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('shell-list')
    .setDescription('実行中のシェルコマンドをリスト表示'),
  
  new SlashCommandBuilder()
    .setName('shell-kill')
    .setDescription('実行中のシェルコマンドを停止')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('停止するプロセスのID')
        .setRequired(true)),
];

export interface ShellHandlerDeps {
  shellManager: ShellManager;
}

export function createShellHandlers(deps: ShellHandlerDeps) {
  const { shellManager } = deps;
  
  return {
    async onShell(ctx: InteractionContext, command: string, input?: string) {
      const result = await shellManager.execute(command, input);
      
      // 初期メッセージ
      await ctx.editReply({
        embeds: [{
          color: 0xffff00,
          title: `🔧 実行中: ${command}`,
          description: '```\n出力を待っています...\n```',
          footer: { text: `プロセスID: ${result.processId} | 対話的コマンドの場合は /shell-input ${result.processId} で入力可能` },
          timestamp: true
        }]
      });
      
      return result;
    },
    
    async onShellInput(_ctx: InteractionContext, processId: number, text: string) {
      return await shellManager.sendInput(processId, text);
    },
    
    onShellList(_ctx: InteractionContext) {
      return shellManager.getRunningProcesses();
    },
    
    async onShellKill(_ctx: InteractionContext, processId: number) {
      return await shellManager.killProcess(processId);
    },
    
    async killAllProcesses() {
      await shellManager.killAllProcesses();
    }
  };
}