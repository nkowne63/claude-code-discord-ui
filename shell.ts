#!/usr/bin/env -S deno run --allow-all

/**
 * シェル実行機能
 * 
 * Discord Botで使用するシェルコマンド実行とプロセス管理機能を提供します。
 */

export interface ShellProcess {
  command: string;
  startTime: Date;
  child: Deno.ChildProcess;
  stdin: WritableStreamDefaultWriter<Uint8Array>;
}

export interface ShellExecutionResult {
  processId: number;
  onOutput: (callback: (output: string) => void) => void;
  onComplete: (callback: (code: number, output: string) => void) => void;
  onError: (callback: (error: Error) => void) => void;
}

export interface ShellInputResult {
  success: boolean;
  process?: ShellProcess;
}

export interface ShellKillResult {
  success: boolean;
  process?: ShellProcess;
}

export class ShellManager {
  private runningProcesses = new Map<number, ShellProcess>();
  private processIdCounter = 0;
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  /**
   * シェルコマンドを実行し、対話的な入出力をサポート
   */
  async execute(command: string, input?: string): Promise<ShellExecutionResult> {
    const processId = ++this.processIdCounter;
    let output = '';
    const outputCallbacks: ((data: string) => void)[] = [];
    const completeCallbacks: ((code: number, output: string) => void)[] = [];
    const errorCallbacks: ((error: Error) => void)[] = [];

    // Denoコマンドを使用してシェルコマンドを実行（対話的モードに対応）
    const proc = new Deno.Command("bash", {
      args: ["-c", command],
      cwd: this.workDir,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const child = proc.spawn();
    const stdin = child.stdin.getWriter();

    // プロセスを登録
    this.runningProcesses.set(processId, {
      command,
      startTime: new Date(),
      child,
      stdin,
    });

    // 初期入力があれば送信
    if (input) {
      await stdin.write(new TextEncoder().encode(input + '\n'));
    }

    // 出力を読み取る
    const decoder = new TextDecoder();

    // stdout読み取り
    (async () => {
      const reader = child.stdout.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          output += text;
          outputCallbacks.forEach(cb => cb(text));
        }
      } catch (error) {
        console.error('stdout read error:', error);
      }
    })();

    // stderr読み取り
    (async () => {
      const reader = child.stderr.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          output += text;
          outputCallbacks.forEach(cb => cb(text));
        }
      } catch (error) {
        console.error('stderr read error:', error);
      }
    })();

    // プロセス終了を待つ
    child.status.then((status) => {
      this.runningProcesses.delete(processId);
      completeCallbacks.forEach(cb => cb(status.code, output));
    }).catch((error) => {
      this.runningProcesses.delete(processId);
      errorCallbacks.forEach(cb => cb(error));
    });

    return {
      processId,
      onOutput: (callback: (output: string) => void) => {
        outputCallbacks.push(callback);
      },
      onComplete: (callback: (code: number, output: string) => void) => {
        completeCallbacks.push(callback);
      },
      onError: (callback: (error: Error) => void) => {
        errorCallbacks.push(callback);
      },
    };
  }

  /**
   * 実行中のプロセスに入力を送信
   */
  async sendInput(processId: number, text: string): Promise<ShellInputResult> {
    const process = this.runningProcesses.get(processId);
    if (!process || !process.stdin) {
      return { success: false };
    }

    try {
      await process.stdin.write(new TextEncoder().encode(text + '\n'));
      return { success: true, process };
    } catch (error) {
      console.error(`Failed to send input to process ${processId}:`, error);
      return { success: false };
    }
  }

  /**
   * 実行中のプロセスリストを取得
   */
  getRunningProcesses(): Map<number, ShellProcess> {
    return this.runningProcesses;
  }

  /**
   * プロセスを強制終了
   */
  async killProcess(processId: number): Promise<ShellKillResult> {
    const process = this.runningProcesses.get(processId);
    if (!process) {
      return { success: false };
    }

    try {
      // プロセスを強制終了
      process.child.kill("SIGTERM");

      // プロセスの終了を待つ（タイムアウト付き）
      const timeout = setTimeout(() => {
        process.child.kill("SIGKILL");
      }, 5000);

      await process.child.status;
      clearTimeout(timeout);

      this.runningProcesses.delete(processId);
      return { success: true, process };
    } catch (error) {
      console.error(`Failed to kill process ${processId}:`, error);
      return { success: false };
    }
  }

  /**
   * すべてのプロセスを停止
   */
  async killAllProcesses(): Promise<void> {
    for (const [id, process] of this.runningProcesses) {
      try {
        process.child.kill("SIGTERM");
      } catch (error) {
        console.error(`Failed to kill process ${id}:`, error);
      }
    }
  }
}