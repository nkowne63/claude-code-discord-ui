import { SlashCommandBuilder } from "npm:discord.js@14.14.1";

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
    // deno-lint-ignore no-explicit-any
    async onGit(_ctx: any, command: string): Promise<string> {
      const { executeGitCommand } = await import("./handler.ts");
      return await executeGitCommand(workDir, `git ${command}`);
    },
    
    // deno-lint-ignore no-explicit-any
    async onWorktree(_ctx: any, branch: string, ref?: string) {
      const { createWorktree } = await import("./handler.ts");
      return await createWorktree(workDir, branch, ref);
    },
    
    // deno-lint-ignore no-explicit-any
    async onWorktreeList(_ctx: any) {
      const { listWorktrees } = await import("./handler.ts");
      return await listWorktrees(workDir);
    },
    
    // deno-lint-ignore no-explicit-any
    async onWorktreeRemove(_ctx: any, branch: string) {
      const { removeWorktree } = await import("./handler.ts");
      return await removeWorktree(workDir, branch);
    },
    
    // deno-lint-ignore no-explicit-any
    async onWorktreeBot(_ctx: any, fullPath: string, _branch: string) {
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
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log(`Worktreeボットプロセスを起動しました: ${fullPath}`);
    },
    
    async getStatus() {
      const { getGitStatus } = await import("./handler.ts");
      const gitStatusInfo = await getGitStatus(workDir);
      return gitStatusInfo;
    }
  };
}