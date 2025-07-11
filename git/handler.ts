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
  
  try {
    const gitFile = await Deno.readTextFile(`${workDir}/.git`);
    if (gitFile.includes('gitdir:')) {
      baseWorkDir = workDir.replace(/\/\.git\/worktrees\/[^\/]+$/, '');
    }
  } catch {
    // .gitディレクトリの場合は通常のリポジトリ
  }
  
  // Check if worktree already exists for this branch
  const existingWorktrees = await executeGitCommand(baseWorkDir, "git worktree list");
  if (!existingWorktrees.startsWith('実行エラー:') && !existingWorktrees.startsWith('エラー:')) {
    const worktreeLines = existingWorktrees.split('\n').filter(line => line.trim());
    for (const line of worktreeLines) {
      // Check if this branch is already used by a worktree
      if (line.includes(`[${branch}]`) || line.endsWith(` ${branch}`)) {
        const existingPath = line.split(/\s+/)[0];
        return { 
          result: `既存のworktreeが見つかりました。パス: ${existingPath}`, 
          fullPath: existingPath, 
          baseDir: baseWorkDir,
          isExisting: true
        };
      }
    }
  }
  
  // The actual worktree directory path (not the .git/worktrees path)
  const worktreeDir = `${baseWorkDir}/../${branch}`;
  
  // Check if directory already exists
  try {
    await Deno.stat(worktreeDir);
    return { 
      result: `エラー: ディレクトリ '${worktreeDir}' は既に存在します。`, 
      fullPath: worktreeDir, 
      baseDir: baseWorkDir 
    };
  } catch {
    // Directory doesn't exist, which is good
  }
  
  // Check if branch already exists
  const branchCheckResult = await executeGitCommand(baseWorkDir, `git show-ref --verify --quiet refs/heads/${branch}`);
  const branchExists = !branchCheckResult.startsWith('実行エラー:') && !branchCheckResult.startsWith('エラー:');
  
  let result: string;
  if (branchExists) {
    // Branch exists, use it without creating a new one
    result = await executeGitCommand(baseWorkDir, `git worktree add ${worktreeDir} ${branch}`);
  } else {
    // Branch doesn't exist, create a new one
    result = await executeGitCommand(baseWorkDir, `git worktree add ${worktreeDir} -b ${branch} ${actualRef}`);
  }
  
  return { result, fullPath: worktreeDir, baseDir: baseWorkDir };
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
  
  try {
    const gitFile = await Deno.readTextFile(`${workDir}/.git`);
    if (gitFile.includes('gitdir:')) {
      baseWorkDir = workDir.replace(/\/\.git\/worktrees\/[^\/]+$/, '');
    }
  } catch {
    // .gitディレクトリの場合は通常のリポジトリ
  }
  
  // First, find the actual worktree path by listing existing worktrees
  const worktreeList = await executeGitCommand(baseWorkDir, "git worktree list");
  if (worktreeList.startsWith('実行エラー:') || worktreeList.startsWith('エラー:')) {
    return { result: worktreeList, fullPath: '', baseDir: baseWorkDir };
  }
  
  let worktreePathToRemove = '';
  const worktreeLines = worktreeList.split('\n').filter(line => line.trim());
  for (const line of worktreeLines) {
    // Check if this line contains the branch we want to remove
    if (line.includes(`[${branch}]`) || line.endsWith(` ${branch}`)) {
      worktreePathToRemove = line.split(/\s+/)[0];
      break;
    }
  }
  
  if (!worktreePathToRemove) {
    return { 
      result: `エラー: ブランチ '${branch}' のworktreeが見つかりません。`, 
      fullPath: '', 
      baseDir: baseWorkDir 
    };
  }
  
  // Remove the worktree using the actual path
  const result = await executeGitCommand(baseWorkDir, `git worktree remove ${worktreePathToRemove} --force`);
  
  return { result, fullPath: worktreePathToRemove, baseDir: baseWorkDir };
}

export async function getGitStatus(workDir: string): Promise<GitStatus> {
  const status = await executeGitCommand(workDir, "git status --short");
  const branch = await executeGitCommand(workDir, "git branch --show-current");
  const remote = await executeGitCommand(workDir, "git remote -v");
  
  return { status, branch, remote };
}