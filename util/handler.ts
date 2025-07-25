import type { SettingsResult, PwdResult } from "./types.ts";

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
    // deno-lint-ignore no-explicit-any
    onSettings(_ctx: any, action: string, value?: string): SettingsResult {
      switch (action) {
        case 'mention-on': {
          if (!value) {
            return {
              success: false,
              message: '❌ ユーザーIDを指定してください。例: `/settings mention-on 123456789012345678`'
            };
          }
          
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
    
    getPwd(): PwdResult {
      return {
        workDir,
        categoryName: actualCategoryName,
        repoName,
        branchName
      };
    }
  };
}