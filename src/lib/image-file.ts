// Photo checks and on-device resizing for request images. Nothing is uploaded to a server yet.

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Why a chosen file can't be used, or null if it's fine. */
export function imageFileProblem(file: { type: string; size: number }): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "Please choose a JPG, PNG, WebP or GIF image.";
  }
  if (file.size > MAX_IMAGE_BYTES) return "That image is over 10 MB. Please choose a smaller one.";
  if (file.size === 0) return "That file is empty. Please choose another image.";
  return null;
}

/** Decodes and shrinks the photo (longest side ≤ maxSide) to a JPEG data URL. Throws if it can't be read. */
export async function shrinkImage(file: File, maxSide = 1200): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#FFFFFF"; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}
