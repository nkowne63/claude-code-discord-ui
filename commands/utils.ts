import type { InteractionContext } from "../discord.ts";
import { SlashCommandBuilder } from "npm:discord.js@14.14.1";

// Discord command definitions
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

export interface UtilsHandlerDeps {
  workDir: string;
  repoName: string;
  branchName: string;
  actualCategoryName: string;
  botSettings: {
    mentionEnabled: boolean;
    mentionUserId: string | null;
  };
  updateBotSettings: (settings: { mentionEnabled: boolean; mentionUserId: string | null }) => void;
}

export function createUtilsHandlers(deps: UtilsHandlerDeps) {
  const { workDir, repoName, branchName, actualCategoryName, botSettings, updateBotSettings } = deps;
  
  return {
    onSettings(_ctx: InteractionContext, action: string, value?: string) {
      switch (action) {
        case 'mention-on': {
          if (!value) {
            return {
              success: false,
              message: '❌ ユーザーIDを指定してください。例: `/settings mention-on 123456789012345678`'
            };
          }
          
          // ユーザーIDの形式をチェック（数字のみ、18-19桁）
          if (!/^\d{17,19}$/.test(value)) {
            return {
              success: false,
              message: '❌ 無効なユーザーIDです。DiscordのユーザーIDは17-19桁の数字です。'
            };
          }
          
          botSettings.mentionEnabled = true;
          botSettings.mentionUserId = value;
          updateBotSettings(botSettings);
          
          return {
            success: true,
            mentionEnabled: true,
            mentionUserId: value
          };
        }
        
        case 'mention-off': {
          botSettings.mentionEnabled = false;
          updateBotSettings(botSettings);
          
          return {
            success: true,
            mentionEnabled: false,
            mentionUserId: botSettings.mentionUserId
          };
        }
        
        case 'show': {
          return {
            success: true,
            mentionEnabled: botSettings.mentionEnabled,
            mentionUserId: botSettings.mentionUserId
          };
        }
        
        default: {
          return {
            success: false,
            message: '❌ 無効なアクションです。'
          };
        }
      }
    },
    
    getPwd() {
      return {
        workDir,
        categoryName: actualCategoryName,
        repoName,
        branchName
      };
    }
  };
}