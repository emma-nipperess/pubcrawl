import { LIMITS } from './validate';

export interface Processed {
  blob: Blob;
  mime: string;
  width?: number;
  height?: number;
  durationMs?: number;
  thumb?: Blob;
}

async function loadImage(file: Blob): Promise<HTMLImageElement | ImageBitmap> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      /* fall through (e.g. HEIC on non-Safari) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(src: CanvasImageSource, w: number, h: number, maxEdge: number, mime: string, quality: number): Promise<{ blob: Blob | null; width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve({ blob: null, width, height });
  ctx.drawImage(src, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve({ blob, width, height }), mime, quality));
}

/**
 * Downscale large photos to save mobile data (and strip EXIF location as a
 * side effect of re-encoding), plus make a small thumbnail. If the browser
 * cannot decode the image (e.g. HEIC outside Safari) the original is uploaded
 * untouched and no thumbnail is made — everything still works.
 */
export async function processImage(file: File, mime: string): Promise<Processed> {
  try {
    const img = await loadImage(file);
    const w = 'naturalWidth' in img ? img.naturalWidth : img.width;
    const h = 'naturalHeight' in img ? img.naturalHeight : img.height;
    const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg';
    const main = await drawScaled(img, w, h, LIMITS.imageMaxEdge, outMime, 0.86);
    const thumb = await drawScaled(img, w, h, LIMITS.thumbEdge, 'image/jpeg', 0.72);
    if ('close' in img) img.close();
    const useMain = main.blob && main.blob.size < file.size;
    return {
      blob: useMain ? main.blob! : file,
      mime: useMain ? outMime : mime,
      width: useMain ? main.width : w,
      height: useMain ? main.height : h,
      thumb: thumb.blob ?? undefined,
    };
  } catch {
    return { blob: file, mime };
  }
}

/** Grab a poster frame + dimensions from a video, best effort. */
export async function processVideo(file: File, mime: string): Promise<Processed> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 6000);
      video.onloadeddata = () => {
        clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(t);
        reject(new Error('decode'));
      };
    });
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined;
    try {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      await new Promise((r) => {
        video.onseeked = r;
        setTimeout(r, 1500);
      });
    } catch {
      /* ignore */
    }
    const poster = await drawScaled(video, video.videoWidth || 480, video.videoHeight || 480, LIMITS.thumbEdge, 'image/jpeg', 0.72);
    return { blob: file, mime, width: video.videoWidth || undefined, height: video.videoHeight || undefined, durationMs, thumb: poster.blob ?? undefined };
  } catch {
    return { blob: file, mime };
  } finally {
    URL.revokeObjectURL(url);
  }
}
