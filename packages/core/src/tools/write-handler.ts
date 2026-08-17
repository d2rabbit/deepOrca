import * as fs from "fs";
import { z } from "zod";
import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import {
  buildDiffPreview,
  ensureParentDirectory,
  hasFileChangedSinceState,
  normalizeContent,
  readTextFileWithMetadata,
  writeTextFile,
} from "../common/file-utils";
import { executeValidatedTool } from "../common/validate";
import { gateWrite } from "../common/path-boundary";
import { getFileState, isAbsoluteFilePath, isFullFileView, normalizeFilePath, recordFileState } from "../common/state";

const writeSchema = z.strictObject({
  file_path: z.string().min(1, "file_path is required."),
  content: z.string({
    error:
      "content must be a string. If you are writing JSON, serialize the full document to text before calling write.",
  }),
});

type WriteRepairMetadata = {
  input_repaired: boolean;
  repair_kind: "json-stringify-content";
} | null;

export async function handleWriteTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  let repairMetadata: WriteRepairMetadata = null;

  return executeValidatedTool(
    "write",
    writeSchema,
    args,
    context,
    async (input) => {
      const filePath = normalizeFilePath(input.file_path);
      if (!isAbsoluteFilePath(filePath)) {
        return {
          ok: false,
          name: "write",
          error: "file_path must be an absolute path.",
        };
      }

      // Execution-time write boundary (P0, specs/sandbox/design.md §4.1):
      // enforce the granted path capability before any fs effect — past this
      // point ensureParentDirectory would create the escaping parent chain.
      const gate = gateWrite(context.pathGrant, filePath, context.projectRoot);
      context.onPathGateVerdict?.({ tool: "write", verdict: gate, filePath });
      if (!gate.ok) {
        return {
          ok: false,
          name: "write",
          error: gate.reason,
          errorType: "PERMISSION_DENIED",
          retryable: false,
        };
      }

      const existingFile = fs.existsSync(filePath);
      if (existingFile) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(filePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            name: "write",
            error: `Failed to stat file: ${message}`,
          };
        }

        if (stat.isDirectory()) {
          return {
            ok: false,
            name: "write",
            error: "file_path points to a directory.",
          };
        }

        if (stat.size > 0) {
          const fileState = getFileState(context.sessionId, filePath);
          if (!fileState || !isFullFileView(fileState)) {
            return {
              ok: false,
              name: "write",
              error: "Must read the full existing file before writing.",
            };
          }

          if (hasFileChangedSinceState(filePath, fileState)) {
            return {
              ok: false,
              name: "write",
              error: "File has been modified since read. Read it again before writing.",
            };
          }
        }
      }

      const normalizedContent = normalizeContent(input.content);

      try {
        ensureParentDirectory(filePath, { pathGrant: context.pathGrant });

        const existingMetadata = existingFile ? readTextFileWithMetadata(filePath) : null;
        const encoding = existingMetadata?.encoding ?? "utf8";
        const lineEndings = existingMetadata?.lineEndings ?? (input.content.includes("\r\n") ? "CRLF" : "LF");
        const diffPreview = buildDiffPreview(filePath, existingMetadata?.content ?? null, normalizedContent);
        context.onBeforeFileMutation?.(filePath);
        const bytes = writeTextFile(filePath, normalizedContent, encoding, lineEndings, {
          pathGrant: context.pathGrant,
        });
        context.onAfterFileMutation?.(filePath, "write");
        const freshMetadata = readTextFileWithMetadata(filePath);

        recordFileState(
          context.sessionId,
          {
            filePath,
            content: freshMetadata.content,
            timestamp: freshMetadata.timestamp,
            encoding: freshMetadata.encoding,
            lineEndings: freshMetadata.lineEndings,
          },
          { incrementVersion: true }
        );

        return {
          ok: true,
          name: "write",
          output: existingMetadata ? "Updated file." : "Created file.",
          metadata: {
            type: existingMetadata ? "update" : "create",
            file_path: filePath,
            bytes,
            encoding: freshMetadata.encoding,
            line_endings: freshMetadata.lineEndings,
            cache_refreshed: true,
            diff_preview: diffPreview,
            ...repairMetadata,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          name: "write",
          error: message,
        };
      }
    },
    {
      preprocess: (rawInput) => {
        const filePath = typeof rawInput.file_path === "string" ? normalizeFilePath(rawInput.file_path) : "";
        const content = rawInput.content;
        if (
          filePath.toLowerCase().endsWith(".json") &&
          content !== null &&
          typeof content === "object" &&
          !Buffer.isBuffer(content)
        ) {
          repairMetadata = {
            input_repaired: true,
            repair_kind: "json-stringify-content",
          };

          return {
            ok: true,
            input: {
              ...rawInput,
              file_path: filePath,
              content: JSON.stringify(content, null, 2),
            },
          };
        }

        repairMetadata = null;
        return {
          ok: true,
          input: typeof rawInput.file_path === "string" ? { ...rawInput, file_path: filePath } : rawInput,
        };
      },
    }
  );
}
