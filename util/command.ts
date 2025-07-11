import { SlashCommandBuilder } from "npm:discord.js@14.14.1";

export const utilsCommands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('現在のステータスを表示'),
  
  new SlashCommandBuilder()
    .setName('pwd')
    .setDescription('現在の作業ディレクトリを表示'),
  
  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('ボットの設定を管理')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('実行するアクション')
        .setRequired(true)
        .addChoices(
          { name: 'mention-on', value: 'mention-on' },
          { name: 'mention-off', value: 'mention-off' },
          { name: 'show', value: 'show' }
        ))
    .addStringOption(option =>
      option.setName('value')
        .setDescription('設定値（mention-onの場合はユーザーID）')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('shutdown')
    .setDescription('ボットをシャットダウン'),
];

export { createUtilsHandlers, type UtilsHandlerDeps } from "./handler.ts";