const MAX_BYTES = 1_048_576;

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function compressPatientDocument(file: File) {
  if (file.type === "application/pdf") {
    if (file.size > MAX_BYTES) throw new Error("PDF files must be 1 MB or smaller.");
    return file;
  }
  if (file.size <= MAX_BYTES) return file;
  if (!file.type.startsWith("image/")) throw new Error("Unsupported report file type.");

  const image = await createImageBitmap(file);
  let width = image.width;
  let height = image.height;
  const longest = Math.max(width, height);
  if (longest > 2200) {
    const scale = 2200 / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  let quality = 0.9;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser cannot prepare the image.");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasBlob(canvas, quality);
    if (blob && blob.size <= MAX_BYTES) {
      image.close();
      const base = file.name.replace(/\.[^.]+$/, "");
      return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
    }
    quality = Math.max(0.62, quality - 0.06);
    width = Math.round(width * 0.86);
    height = Math.round(height * 0.86);
    if (width < 1000 || height < 700) break;
  }
  image.close();
  throw new Error("The image cannot be reduced to 1 MB without risking readability.");
}
