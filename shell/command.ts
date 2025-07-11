import { SlashCommandBuilder } from "npm:discord.js@14.14.1";
import type { ShellManager } from "./handler.ts";

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
    // deno-lint-ignore no-explicit-any
    async onShell(_ctx: any, command: string, input?: string) {
      const result = await shellManager.execute(command, input);
      return result;
    },
    
    // deno-lint-ignore no-explicit-any
    async onShellInput(_ctx: any, processId: number, text: string) {
      return await shellManager.sendInput(processId, text);
    },
    
    // deno-lint-ignore no-explicit-any
    onShellList(_ctx: any) {
      return shellManager.getRunningProcesses();
    },
    
    // deno-lint-ignore no-explicit-any
    async onShellKill(_ctx: any, processId: number) {
      return await shellManager.killProcess(processId);
    },
    
    killAllProcesses() {
      shellManager.killAllProcesses();
    }
  };
}