export interface ShellProcess {
  command: string;
  startTime: Date;
  child: Deno.ChildProcess;
  stdin?: WritableStreamDefaultWriter;
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