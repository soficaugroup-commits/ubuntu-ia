import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";

export function projectRoot(): string {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, "backend", "ingestion"))) return cwd;
  const parent = path.resolve(cwd, "..");
  if (existsSync(path.join(parent, "backend", "ingestion"))) return parent;
  return cwd;
}

export function documentsStorageDir(): string {
  return path.join(projectRoot(), "data", "documents");
}

function pythonExecutable(): string {
  const root = projectRoot();
  const windows = path.join(root, ".venv", "Scripts", "python.exe");
  const unix = path.join(root, ".venv", "bin", "python");
  if (existsSync(windows)) return windows;
  if (existsSync(unix)) return unix;
  return process.platform === "win32" ? "python" : "python3";
}

export function queueReingest(documentId: string): void {
  const child = spawn(
    pythonExecutable(),
    ["-m", "backend.ingestion.ingest", "--reingest", documentId],
    {
      cwd: projectRoot(),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
}
