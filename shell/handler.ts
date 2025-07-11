import type { ShellProcess, ShellExecutionResult, ShellInputResult, ShellKillResult } from "./types.ts";

export class ShellManager {
  private runningProcesses = new Map<number, ShellProcess>();
  private processIdCounter = 0;
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  async execute(command: string, input?: string): Promise<ShellExecutionResult> {
    const processId = ++this.processIdCounter;
    let output = '';
    const outputCallbacks: ((data: string) => void)[] = [];
    const completeCallbacks: ((code: number, output: string) => void)[] = [];
    const errorCallbacks: ((error: Error) => void)[] = [];

    const proc = new Deno.Command("bash", {
      args: ["-c", command],
      cwd: this.workDir,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });

    const child = proc.spawn();
    const stdin = child.stdin.getWriter();

    this.runningProcesses.set(processId, {
      command,
      startTime: new Date(),
      child,
      stdin,
    });

    if (input) {
      await stdin.write(new TextEncoder().encode(input + '\n'));
    }

    const decoder = new TextDecoder();

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

  getRunningProcesses(): Map<number, ShellProcess> {
    return this.runningProcesses;
  }

  async killProcess(processId: number): Promise<ShellKillResult> {
    const process = this.runningProcesses.get(processId);
    if (!process) {
      return { success: false };
    }

    try {
      process.child.kill("SIGTERM");

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

  killAllProcesses(): void {
    for (const [id, process] of this.runningProcesses) {
      try {
        process.child.kill("SIGTERM");
      } catch (error) {
        console.error(`Failed to kill process ${id}:`, error);
      }
    }
  }
}