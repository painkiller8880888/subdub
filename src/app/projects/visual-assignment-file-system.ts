import { constants, createReadStream } from "node:fs";
import {
  copyFile,
  link as linkNode,
  mkdir as mkdirNode,
  lstat,
  realpath as realpathNode,
  unlink as unlinkNode
} from "node:fs/promises";
import { createHash } from "node:crypto";

export interface VisualAssignmentFileSystem {
  mkdir(directoryPath: string): Promise<void>;
  copyFile(sourcePath: string, destinationPath: string): Promise<void>;
  hashFile(filePath: string): Promise<string>;
  /** Install a complete temporary file without replacing an existing path. */
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  pathExists(filePath: string): Promise<boolean>;
  unlink(filePath: string): Promise<void>;
  realpath(filePath: string): Promise<string>;
}

export class NodeVisualAssignmentFileSystem
  implements VisualAssignmentFileSystem
{
  async mkdir(directoryPath: string): Promise<void> {
    await mkdirNode(directoryPath, { recursive: true });
  }

  async copyFile(sourcePath: string, destinationPath: string): Promise<void> {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  }

  async hashFile(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    try {
      for await (const chunk of stream) {
        hash.update(chunk as Buffer);
      }
      return hash.digest("hex");
    } finally {
      stream.destroy();
    }
  }

  async rename(sourcePath: string, destinationPath: string): Promise<void> {
    await linkNode(sourcePath, destinationPath);
    try {
      await unlinkNode(sourcePath);
    } catch (error) {
      try {
        await unlinkNode(destinationPath);
      } catch {
        // The service will report the original placement failure and perform
        // its normal cleanup handling if the destination cannot be removed.
      }
      throw error;
    }
  }

  async pathExists(filePath: string): Promise<boolean> {
    try {
      await lstat(filePath);
      return true;
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }
      throw error;
    }
  }

  async unlink(filePath: string): Promise<void> {
    await unlinkNode(filePath);
  }

  async realpath(filePath: string): Promise<string> {
    return realpathNode(filePath);
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
