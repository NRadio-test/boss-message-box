interface CompressMessage {
  id: string;
  file: File;
}

async function encode(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("无法处理这张图片");
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality });
  return { blob, width, height };
}

self.onmessage = async (event: MessageEvent<CompressMessage>) => {
  const { id, file } = event.data;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const result = await encode(bitmap, 2560, 0.84);
    bitmap.close();
    if (result.blob.size <= 0) throw new Error("图片处理失败，请重新选择");
    self.postMessage({ id, ok: true, ...result });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : "图片处理失败，请重新选择",
    });
  }
};
