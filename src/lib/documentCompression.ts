// Client-side compression helpers for deal document uploads.
// Goal: reduce Supabase Storage usage without changing user-perceived behaviour.

export interface PreparedUpload {
  blob: Blob;
  storedMime: string;
  storedExt: string; // appended to storage path (e.g. ".gz")
  isCompressed: boolean;
  originalMime: string;
  originalName: string;
  originalSize: number;
  storedSize: number;
}

const SKIP_SMALL_BYTES = 100 * 1024; // <100KB: don't bother
const IMAGE_MAX_EDGE = 2000;
const IMAGE_QUALITY = 0.8;

async function gzipBlob(blob: Blob): Promise<Blob> {
  // CompressionStream is supported in all evergreen browsers.
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).blob();
}

export async function gunzipToBlob(input: Blob, mime: string): Promise<Blob> {
  const stream = input.stream().pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Blob([buf], { type: mime });
}

async function recodeImage(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > IMAGE_MAX_EDGE ? IMAGE_MAX_EDGE / longest : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(w, h);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = (canvas as any).getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // PNGs with potential alpha: stay PNG; JPEGs: re-encode as JPEG.
    const isPng = file.type === "image/png";
    const outType = isPng ? "image/png" : "image/jpeg";

    if (canvas instanceof OffscreenCanvas) {
      return await canvas.convertToBlob({ type: outType, quality: IMAGE_QUALITY });
    }
    return await new Promise<Blob | null>((resolve) =>
      (canvas as HTMLCanvasElement).toBlob(
        (b) => resolve(b),
        outType,
        IMAGE_QUALITY,
      ),
    );
  } catch (e) {
    console.warn("Image re-encode failed; falling back to original", e);
    return null;
  }
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const originalMime = file.type || "application/octet-stream";
  const baseResult: PreparedUpload = {
    blob: file,
    storedMime: originalMime,
    storedExt: "",
    isCompressed: false,
    originalMime,
    originalName: file.name,
    originalSize: file.size,
    storedSize: file.size,
  };

  if (file.size < SKIP_SMALL_BYTES) return baseResult;

  // Images: re-encode (lossy for JPEG, downscale for PNG).
  if (originalMime === "image/jpeg" || originalMime === "image/png") {
    const recoded = await recodeImage(file);
    if (recoded && recoded.size < file.size) {
      return {
        ...baseResult,
        blob: recoded,
        storedMime: recoded.type || originalMime,
        storedSize: recoded.size,
        // Image is still the original mime to the viewer; not gzip-wrapped.
        isCompressed: false,
      };
    }
    return baseResult;
  }

  // PDFs / DOCX: gzip-wrap. Saves 10-40% typically.
  if (
    originalMime === "application/pdf" ||
    originalMime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    originalMime === "application/msword"
  ) {
    try {
      const gz = await gzipBlob(file);
      if (gz.size < file.size * 0.95) {
        return {
          ...baseResult,
          blob: gz,
          storedMime: "application/gzip",
          storedExt: ".gz",
          storedSize: gz.size,
          isCompressed: true,
        };
      }
    } catch (e) {
      console.warn("gzip failed; uploading original", e);
    }
  }

  return baseResult;
}
