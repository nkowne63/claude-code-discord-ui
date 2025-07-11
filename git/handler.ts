import { promisify } from "node:util";
import { exec as execCallback } from "node:child_process";
import { basename } from "node:path";
import process from "node:process";
import type { GitInfo, WorktreeResult, WorktreeListResult, GitStatus } from "./types.ts";

const exec = promisify(execCallback);

export async function getGitInfo(workDir: string = Deno.cwd()): Promise<GitInfo> {
  try {
    const { stdout: branch } = await exec("git branch --show-current", { cwd: workDir });
    const branchName = branch.trim() || "main";
    
    let repoName = basename(workDir);
    
    try {
      const { stdout: remoteUrl } = await exec("git config --get remote.origin.url", { cwd: workDir });
      if (remoteUrl) {
        const match = remoteUrl.match(/\/([^\/]+?)(\.git)?$/);
        if (match) {
          repoName = match[1];
        }
      }
    } catch {
      // リモートURLが取得できない場合はディレクトリ名を使用
    }
    
    return { repo: repoName, branch: branchName };
  } catch (error) {
    console.error("Git情報の取得に失敗しました:", error);
    throw new Error("このディレクトリはGitリポジトリではありません");
  }
}

export async function executeGitCommand(workDir: string, command: string): Promise<string> {
  try {
    const { stdout, stderr } = await exec(command, { 
      cwd: workDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    
    if (stderr && !stdout) {
      return `エラー:\n${stderr}`;
    }
    
    return stdout || stderr || "コマンドが正常に実行されました。";
  // deno-lint-ignore no-explicit-any
  } catch (error: any) {
    return `実行エラー: ${error.message}\n${error.stderr || ''}`;
  }
}

export async function createWorktree(workDir: string, branch: string, ref?: string): Promise<WorktreeResult> {
  const actualRef = ref || branch;
  let baseWorkDir = workDir;
  let worktreePath = `.git/worktrees/${branch}`;
  
  try {
    const gitFile = await Deno.readTextFile(`${workDir}/.git`);
    if (gitFile.includes('gitdir:')) {
      baseWorkDir = workDir.replace(/\/\.git\/worktrees\/[^\/]+$/, '');
      worktreePath = `.git/worktrees/${branch}`;
    }
  } catch {
    // .gitディレクトリの場合は通常のリポジトリ
  }
  
  const fullWorktreePath = `${baseWorkDir}/${worktreePath}`;
  const result = await executeGitCommand(baseWorkDir, `git worktree add ${worktreePath} -b ${branch} ${actualRef}`);
  
  return { result, fullPath: fullWorktreePath, baseDir: baseWorkDir };
}

export async function listWorktrees(workDir: string): Promise<WorktreeListResult> {
  let baseWorkDir = workDir;
  
  try {
    const gitFile = await Deno.readTextFile(`${workDir}/.git`);
    if (gitFile.includes('gitdir:')) {
      baseWorkDir = workDir.replace(/\/\.git\/worktrees\/[^\/]+$/, '');
    }
  } catch {
    // .gitディレクトリの場合は通常のリポジトリ
  }
  
  const result = await executeGitCommand(baseWorkDir, "git worktree list");
  return { result, baseDir: baseWorkDir };
}

export async function removeWorktree(workDir: string, branch: string): Promise<WorktreeResult> {
  let baseWorkDir = workDir;
  let worktreePath = `.git/worktrees/${branch}`;
  
  try {
    const gitFile = await Deno.readTextFile(`${workDir}/.git`);
    if (gitFile.includes('gitdir:')) {
      baseWorkDir = workDir.replace(/\/\.git\/worktrees\/[^\/]+$/, '');
      worktreePath = `.git/worktrees/${branch}`;
    }
  } catch {
    // .gitディレクトリの場合は通常のリポジトリ
  }
  
  const fullWorktreePath = `${baseWorkDir}/${worktreePath}`;
  const result = await executeGitCommand(baseWorkDir, `git worktree remove ${worktreePath}`);
  
  return { result, fullPath: fullWorktreePath, baseDir: baseWorkDir };
}

export async function getGitStatus(workDir: string): Promise<GitStatus> {
  const status = await executeGitCommand(workDir, "git status --short");
  const branch = await executeGitCommand(workDir, "git branch --show-current");
  const remote = await executeGitCommand(workDir, "git remote -v");
  
  return { status, branch, remote };
}