/** Shared by Next's proxy and the upload handler; values are byte counts. */
export function getMaxUploadSizeBytes(): number {
  const configured = Number(process.env.MAX_UPLOAD_SIZE_MB);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : 500;
  const bytes = Math.floor(megabytes * 1024 * 1024);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 500 * 1024 * 1024;
}

// Multipart filenames, boundaries and field headers are additional to file data.
export function getMaxUploadRequestBytes(): number {
  return getMaxUploadSizeBytes() + 8 * 1024 * 1024;
}

export const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
