#!/usr/bin/env -S deno run --allow-all

/**
 * Git関連機能
 * 
 * Gitリポジトリ情報の取得、コマンド実行、worktree管理などの機能を提供します。
 */

import { promisify } from "node:util";
import { exec as execCallback } from "node:child_process";
import { basename } from "node:path";

const exec = promisify(execCallback);

export interface GitInfo {
  repo: string;
  branch: string;
}

export interface WorktreeResult {
  result: string;
  fullPath: string;
  baseDir: string;
}

export interface WorktreeListResult {
  result: string;
  baseDir: string;
}

/**
 * Git情報を取得
 */
export async function getGitInfo(workDir: string = Deno.cwd()): Promise<GitInfo> {
  try {
    // 現在のブランチ名を取得
    const { stdout: branch } = await exec("git branch --show-current", { cwd: workDir });
    const branchName = branch.trim() || "main";
    
    // リポジトリ名を取得（現在のディレクトリ名またはリモートURLから）
    let repoName = basename(workDir);
    
    try {
      const { stdout: remoteUrl } = await exec("git config --get remote.origin.url", { cwd: workDir });
      if (remoteUrl) {
        // URLからリポジトリ名を抽出
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

/**
 * Gitコマンドを実行
 */
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
  } catch (error: any) {
    return `実行エラー: ${error.message}\n${error.stderr || ''}`;
  }
}

/**
 * Git worktreeを作成
 */
export async function createWorktree(workDir: string, branch: string, ref?: string): Promise<WorktreeResult> {
  const actualRef = ref || branch;
  let baseWorkDir = workDir;
  let worktreePath = `.git/worktrees/${branch}`;
  
  // .gitファイルが存在する場合はworktree内
  try {
    const gitFile = await Deno.readTextFile(`${workDir}/.git`);
    if (gitFile.includes('gitdir:')) {
      // worktree内から実行している場合、親ディレクトリを使用
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

/**
 * Git worktreeリストを取得
 */
export async function listWorktrees(workDir: string): Promise<WorktreeListResult> {
  let baseWorkDir = workDir;
  
  // .gitファイルが存在する場合はworktree内
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

/**
 * Git worktreeを削除
 */
export async function removeWorktree(workDir: string, branch: string): Promise<WorktreeResult> {
  let baseWorkDir = workDir;
  let worktreePath = `.git/worktrees/${branch}`;
  
  // .gitファイルが存在する場合はworktree内
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

/**
 * Gitステータスを取得
 */
export async function getGitStatus(workDir: string): Promise<{
  status: string;
  branch: string;
  remote: string;
}> {
  const status = await executeGitCommand(workDir, "git status --short");
  const branch = await executeGitCommand(workDir, "git branch --show-current");
  const remote = await executeGitCommand(workDir, "git remote -v");
  
  return { status, branch, remote };
}