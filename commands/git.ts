import type { InteractionContext } from "../discord.ts";
import { executeGitCommand, createWorktree, listWorktrees, removeWorktree, getGitStatus } from "../git.ts";
import { SlashCommandBuilder } from "npm:discord.js@14.14.1";

// Discord command definitions
export const gitCommands = [
  new SlashCommandBuilder()
    .setName('git')
    .setDescription('Gitコマンドを実行')
    .addStringOption(option =>
      option.setName('command')
        .setDescription('実行するGitコマンド')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('worktree')
    .setDescription('Git worktreeを作成')
    .addStringOption(option =>
      option.setName('branch')
        .setDescription('ブランチ名')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('ref')
        .setDescription('参照（デフォルト: ブランチ名）')
        .setRequired(false)),
  
  new SlashCommandBuilder()
    .setName('worktree-list')
    .setDescription('Git worktreeの一覧を表示'),
  
  new SlashCommandBuilder()
    .setName('worktree-remove')
    .setDescription('Git worktreeを削除')
    .addStringOption(option =>
      option.setName('branch')
        .setDescription('削除するworktreeのブランチ名')
        .setRequired(true)),
];

export interface GitHandlerDeps {
  workDir: string;
  actualCategoryName: string;
  discordToken: string;
  applicationId: string;
  botSettings: {
    mentionEnabled: boolean;
    mentionUserId: string | null;
  };
}

export function createGitHandlers(deps: GitHandlerDeps) {
  const { workDir, actualCategoryName, discordToken, applicationId, botSettings } = deps;
  
  return {
    async onGit(_ctx: InteractionContext, command: string): Promise<string> {
      return await executeGitCommand(workDir, `git ${command}`);
    },
    
    async onWorktree(_ctx: InteractionContext, branch: string, ref?: string) {
      return await createWorktree(workDir, branch, ref);
    },
    
    async onWorktreeList(_ctx: InteractionContext) {
      return await listWorktrees(workDir);
    },
    
    async onWorktreeRemove(_ctx: InteractionContext, branch: string) {
      return await removeWorktree(workDir, branch);
    },
    
    async onWorktreeBot(_ctx: InteractionContext, fullPath: string, _branch: string) {
      // 新しいボットプロセスを起動
      const args = ["--category", actualCategoryName];
      if (botSettings.mentionUserId) {
        args.push("--user-id", botSettings.mentionUserId);
      }
      
      const botProcess = new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", Deno.mainModule, ...args],
        cwd: fullPath,
        env: {
          ...Deno.env.toObject(),
          DISCORD_TOKEN: discordToken,
          APPLICATION_ID: applicationId,
        },
        stdout: "inherit",
        stderr: "inherit",
      });
      
      botProcess.spawn();
      
      // プロセスの開始を確認（少し待機）
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`Worktreeボットプロセスを起動しました: ${fullPath}`);
    },
    
    async getStatus() {
      const gitStatusInfo = await getGitStatus(workDir);
      return gitStatusInfo;
    }
  };
}