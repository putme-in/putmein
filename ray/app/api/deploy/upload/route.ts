import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import fs from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import AdmZip from "adm-zip";

import { getMaxUploadSizeBytes, getMaxUploadRequestBytes } from "@/lib/upload-config";
import { getDeploymentsDir } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Validates that a project name contains no path traversal sequences or directory separators.
 */
function isValidProjectName(name: string): boolean {
  if (!name || typeof name !== "string") return false;
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return false;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return false;
  }
  return /^[a-zA-Z0-9._-]+$/.test(trimmed);
}

/**
 * Validates that an uploaded relative file path is safe and does not escape the destination directory.
 */
function isSafeRelativePath(relPath: string): boolean {
  if (!relPath || typeof relPath !== "string") return false;
  if (relPath.includes("\0")) return false;

  const normalized = relPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || path.isAbsolute(normalized)) {
    return false;
  }

  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === ".." || seg === ".") {
      return false;
    }
  }

  return true;
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("ray_token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await verifyToken(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const maxSizeBytes = getMaxUploadSizeBytes();
  const maxMb = Math.round(maxSizeBytes / (1024 * 1024));

  // Early Content-Length check to reject oversized uploads before parsing body
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!isNaN(contentLength) && contentLength > getMaxUploadRequestBytes()) {
      return NextResponse.json(
        { error: `Payload Too Large: Upload of ${(contentLength / (1024 * 1024)).toFixed(1)}MB exceeds maximum allowed limit of ${maxMb}MB.` },
        { status: 413 }
      );
    }
  }

  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Upload was interrupted or the multipart body was incomplete. Retry the upload; check proxy upload limits if this repeats." },
        { status: 400 }
      );
    }
    const files = formData.getAll("files") as File[];
    const zipFile = formData.get("zip") as File | null;
    let customName = formData.get("name") as string | null;
    let filePaths: string[] | undefined;
    const filePathsField = formData.get("filePaths");
    if (filePathsField !== null) {
      try {
        const parsed: unknown = JSON.parse(String(filePathsField));
        if (!Array.isArray(parsed) || parsed.length !== files.length ||
            !parsed.every(value => typeof value === "string" && isSafeRelativePath(value))) throw new Error();
        filePaths = parsed;
      } catch {
        return NextResponse.json({ error: "Invalid folder file paths." }, { status: 400 });
      }
    }

    if (!files?.length && !zipFile) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    if (zipFile && typeof zipFile.size === "number" && zipFile.size > maxSizeBytes) {
      return NextResponse.json(
        { error: `Payload Too Large: Zip file size (${(zipFile.size / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of ${maxMb}MB.` },
        { status: 413 }
      );
    }

    if (files?.length) {
      const totalFilesSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
      if (totalFilesSize > maxSizeBytes) {
        return NextResponse.json(
          { error: `Payload Too Large: Total upload size (${(totalFilesSize / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of ${maxMb}MB.` },
          { status: 413 }
        );
      }
    }

    if (customName) {
      customName = customName.trim();
      if (!isValidProjectName(customName)) {
        return NextResponse.json(
          { error: "Invalid project name. Path traversal characters and separators ('..', '/', '\\') are not allowed." },
          { status: 400 }
        );
      }
    }

    const baseDeployDir = await getDeploymentsDir();
    const resolvedBaseDeployDir = path.resolve(baseDeployDir);

    let projectName = customName || "app";

    // If zip file uploaded
    if (zipFile) {
      const rawBase = path.basename(zipFile.name).replace(/\.(zip|tar\.gz|tar)$/i, "").trim();
      const sanitizedZipName = rawBase.replace(/[^a-zA-Z0-9._-]/g, "_") || `app-${Date.now()}`;
      projectName = customName || (isValidProjectName(sanitizedZipName) ? sanitizedZipName : `app-${Date.now()}`);

      const resolvedTargetDir = path.resolve(resolvedBaseDeployDir, `.upload-${randomUUID()}`, projectName);
      if (
        resolvedTargetDir === resolvedBaseDeployDir ||
        !resolvedTargetDir.startsWith(resolvedBaseDeployDir + path.sep)
      ) {
        return NextResponse.json(
          { error: "Security error: Project path escapes deployment directory" },
          { status: 400 }
        );
      }

      const tempZipName = `.tmp-upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.zip`;
      const tempZipPath = path.resolve(resolvedBaseDeployDir, tempZipName);

      try {
        // Stream zip directly to disk without buffering entire file in memory
        const zipWriteStream = fs.createWriteStream(tempZipPath);
        await pipeline(Readable.fromWeb(zipFile.stream() as any), zipWriteStream);

        let zip: AdmZip;
        try {
          zip = new AdmZip(tempZipPath);
        } catch (err: unknown) {
          return NextResponse.json(
            { error: (err as Error).message || "Invalid zip archive" },
            { status: 400 }
          );
        }

        const entries = zip.getEntries();
        if (!entries.length) {
          return NextResponse.json(
            { error: "Zip archive is empty" },
            { status: 400 }
          );
        }

        // Reject oversized expanded archives before extracting any content.
        let expandedBytes = 0;
        // Pass 1: Strict validation of EVERY entry before modifying disk
        for (const entry of entries) {
          expandedBytes += entry.header.size;
          if (expandedBytes > maxSizeBytes) {
            return NextResponse.json({ error: `Expanded archive exceeds the ${maxMb} MB limit.` }, { status: 413 });
          }
          const rawEntryName = entry.entryName;
          const normalized = rawEntryName.replace(/\\/g, "/");
          const trimmedEntry = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
          if (!trimmedEntry) continue;

          if (!isSafeRelativePath(trimmedEntry)) {
            return NextResponse.json(
              { error: `Security error: Malicious zip entry '${rawEntryName}' contains path traversal sequences.` },
              { status: 400 }
            );
          }

          const resolvedEntryPath = path.resolve(resolvedTargetDir, trimmedEntry);
          if (
            resolvedEntryPath === resolvedTargetDir ||
            !resolvedEntryPath.startsWith(resolvedTargetDir + path.sep)
          ) {
            return NextResponse.json(
              { error: `Security error: Zip entry '${rawEntryName}' escapes target directory.` },
              { status: 400 }
            );
          }
        }

        // Every upload gets a fresh source tree; never remove a live project directory.
        fs.mkdirSync(resolvedTargetDir, { recursive: true });

        // Pass 2: Extract verified entries
        for (const entry of entries) {
          const normalized = entry.entryName.replace(/\\/g, "/");
          const trimmedEntry = normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
          if (!trimmedEntry) continue;

          const resolvedEntryPath = path.resolve(resolvedTargetDir, trimmedEntry);
          const isDir = entry.isDirectory || normalized.endsWith("/");

          if (isDir) {
            if (!fs.existsSync(resolvedEntryPath)) {
              fs.mkdirSync(resolvedEntryPath, { recursive: true });
            }
          } else {
            const parentDir = path.dirname(resolvedEntryPath);
            if (!fs.existsSync(parentDir)) {
              fs.mkdirSync(parentDir, { recursive: true });
            }
            fs.writeFileSync(resolvedEntryPath, entry.getData());
          }
        }

        // If zipped inside a single subfolder, adjust targetDir
        const innerItems = fs.readdirSync(resolvedTargetDir).filter((i) => !i.startsWith("."));
        let finalDir = resolvedTargetDir;
        if (innerItems.length === 1) {
          const candidatePath = path.resolve(resolvedTargetDir, innerItems[0]);
          if (
            candidatePath.startsWith(resolvedTargetDir + path.sep) &&
            fs.existsSync(candidatePath) &&
            fs.statSync(candidatePath).isDirectory()
          ) {
            finalDir = candidatePath;
          }
        }

        return NextResponse.json({
          success: true,
          name: projectName,
          projectPath: finalDir,
        });
      } finally {
        if (fs.existsSync(tempZipPath)) {
          try {
            fs.unlinkSync(tempZipPath);
          } catch { /* ignore cleanup error */ }
        }
      }
    }

    // If multi-file directory upload
    const firstRel = (files[0] as unknown as { webkitRelativePath?: string }).webkitRelativePath;
    if (firstRel && !customName) {
      const rawFirst = firstRel.replace(/\\/g, "/").split("/")[0]?.trim();
      if (rawFirst && isValidProjectName(rawFirst)) {
        projectName = rawFirst;
      } else {
        projectName = "app";
      }
    }

    const resolvedTargetDir = path.resolve(resolvedBaseDeployDir, `.upload-${randomUUID()}`, projectName);
    if (
      resolvedTargetDir === resolvedBaseDeployDir ||
      !resolvedTargetDir.startsWith(resolvedBaseDeployDir + path.sep)
    ) {
      return NextResponse.json(
        { error: "Security error: Project path escapes deployment directory" },
        { status: 400 }
      );
    }

    if (!fs.existsSync(resolvedTargetDir)) {
      fs.mkdirSync(resolvedTargetDir, { recursive: true });
    }

    for (const [fileIndex, file] of files.entries()) {
      const relPath = filePaths?.[fileIndex] || (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const normalizedRel = (relPath || "").replace(/\\/g, "/");
      // strip top directory if present
      const cleanRel = normalizedRel.includes("/") ? normalizedRel.split("/").slice(1).join("/") : normalizedRel;
      if (!cleanRel) continue;

      if (!isSafeRelativePath(cleanRel)) {
        return NextResponse.json(
          { error: `Security error: Invalid relative file path '${cleanRel}'. Path traversal sequences are forbidden.` },
          { status: 400 }
        );
      }

      const resolvedFilePath = path.resolve(resolvedTargetDir, cleanRel);
      if (
        resolvedFilePath === resolvedTargetDir ||
        !resolvedFilePath.startsWith(resolvedTargetDir + path.sep)
      ) {
        return NextResponse.json(
          { error: `Security error: File path '${cleanRel}' escapes deployment directory.` },
          { status: 400 }
        );
      }

      const parentDir = path.dirname(resolvedFilePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Stream file directly to disk without buffering in memory
      const fileWriteStream = fs.createWriteStream(resolvedFilePath);
      await pipeline(Readable.fromWeb(file.stream() as any), fileWriteStream);
    }

    return NextResponse.json({
      success: true,
      name: projectName,
      projectPath: resolvedTargetDir,
      fileCount: files.length,
    });
  } catch (err: unknown) {
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Failed to process project files" },
      { status: 500 }
    );
  }
}
