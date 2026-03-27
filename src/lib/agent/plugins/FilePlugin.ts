/** FilePlugin — Read, write, and list files in the workspace folder. */

import { deleteFile, listFiles, readFile, writeFile } from "@/lib/files/workspace";
import { defineTool, registerTool, type ToolDefinition } from "@/lib/agent/tools";

interface FileListArgs {
  subdir?: string;
}

interface FileReadArgs {
  path: string;
}

interface FileWriteArgs {
  path: string;
  content: string;
}

interface FileDeleteArgs {
  path: string;
}

export const filePlugin = {
  tools: [
    registerTool(defineTool({
      name: "file_list",
      description: "List files in the workspace folder.",
      parameters: {
        type: "object",
        properties: {
          subdir: { type: "string", description: "Subdirectory within workspace (default: root)" },
        },
      },
      execute: async ({ subdir }: FileListArgs) => {
        return { files: listFiles(subdir ?? ".") };
      },
    } satisfies ToolDefinition<FileListArgs, { files: ReturnType<typeof listFiles> }>)),
    registerTool(defineTool({
      name: "file_read",
      description: "Read the contents of a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path within workspace" },
        },
        required: ["path"],
      },
      execute: async ({ path }: FileReadArgs) => {
        return { content: readFile(path) };
      },
    } satisfies ToolDefinition<FileReadArgs, { content: string }>)),
    registerTool(defineTool({
      name: "file_write",
      description: "Write or overwrite a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async ({ path, content }: FileWriteArgs) => {
        writeFile(path, content);
        return { written: true, path };
      },
    } satisfies ToolDefinition<FileWriteArgs, { written: boolean; path: string }>)),
    registerTool(defineTool({
      name: "file_delete",
      description: "Delete a file from the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async ({ path }: FileDeleteArgs) => {
        deleteFile(path);
        return { deleted: true, path };
      },
    } satisfies ToolDefinition<FileDeleteArgs, { deleted: boolean; path: string }>)),
  ],
};
