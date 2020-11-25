// Helper for working with tarball files (.tar, .tgz)
// Docs: https://github.com/npm/node-tar
import tar, { ExtractOptions, FileStat } from "tar";
import path from "path";

export interface ReadFileFromTarOpts {
  tarPath: string;
  filePath: string;
  parseJson?: boolean;
}

export function readFileFromTar<R = Buffer>({ tarPath, filePath, parseJson }: ReadFileFromTarOpts): Promise<R> {
  return new Promise(async (resolve, reject) => {
    const fileChunks: Buffer[] = [];

    await tar.list({
      file: tarPath,
      filter: path => path === filePath,
      onentry(entry: FileStat) {
        entry.on("data", chunk => {
          fileChunks.push(chunk);
        });
        entry.once("error", err => {
          reject(new Error(`reading file has failed ${entry.path}: ${err}`));
        });
        entry.once("end", () => {
          const data = Buffer.concat(fileChunks);
          const result = parseJson ? JSON.parse(data.toString("utf8")) : data;
          resolve(result);
        });
      },
    });

    if (!fileChunks.length) {
      reject(new Error("Not found"));
    }
  });
}

export async function listTarEntries(filePath: string): Promise<string[]> {
  const entries: string[] = [];
  await tar.list({
    file: filePath,
    onentry: (entry: FileStat) => entries.push(entry.path as any as string),
  });
  return entries;
}

export function extractTar(filePath: string, opts: ExtractOptions & { sync?: boolean } = {}) {
  return tar.extract({
    file: filePath,
    cwd: path.dirname(filePath),
    ...opts,
  });
}
