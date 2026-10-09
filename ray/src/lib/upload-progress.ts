/** Browser upload bytes are measurable; extraction and analysis are server work. */
export function uploadWithProgress(body: FormData, onProgress: (loaded: number, total: number | null) => void, onTransferred: () => void, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) { reject(new DOMException("Upload cancelled", "AbortError")); return; }
    xhr.open("POST", "/api/deploy/upload");
    xhr.timeout = 300000;
    xhr.upload.onprogress = event => onProgress(event.loaded, event.lengthComputable ? event.total : null);
    xhr.upload.onload = () => onTransferred();
    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status > 599) { reject(new Error("Upload ended without a valid server response.")); return; }
      resolve(new Response(xhr.status === 204 || xhr.status === 205 || xhr.status === 304 ? null : xhr.responseText, { status: xhr.status, headers: { "Content-Type": xhr.getResponseHeader("Content-Type") || "application/json" } }));
    };
    xhr.onerror = () => { cleanup(); reject(new Error("Upload connection lost. Check your connection and try again.")); };
    xhr.ontimeout = () => { cleanup(); reject(new Error("Upload timed out while waiting for the server. Try again or check the server upload limits.")); };
    xhr.onabort = () => { cleanup(); reject(new DOMException("Upload cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(body);
  });
}
