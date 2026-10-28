import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { acceptAttr, checkFile, formatBytes, LIMITS, type Accept } from '@/lib/media/validate';
import { processImage, processVideo } from '@/lib/media/process';

export interface PickedFile {
  key: string;
  name: string;
  kind: 'image' | 'video';
  mime: string;
  blob: Blob;
  thumb?: Blob;
  previewUrl: string;
  width?: number;
  height?: number;
  durationMs?: number;
  size: number;
  status: 'ready' | 'uploading' | 'uploaded' | 'error';
  progress: number;
  path?: string;
  thumbPath?: string;
  error?: string;
}

/**
 * Camera / library picker with real validation (magic-byte sniffing + size
 * limits), client-side downscaling and previews. Two inputs: one opens the
 * camera directly (`capture`), the other the photo library / files.
 */
export function MediaPicker({
  accept,
  files,
  onChange,
  onError,
  disabled,
  max = 1,
}: {
  accept: Accept;
  files: PickedFile[];
  onChange: (fn: (f: PickedFile[]) => PickedFile[]) => void;
  onError: (msg: string) => void;
  disabled?: boolean;
  max?: number;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  // free object URLs on unmount
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.previewUrl)), []);

  const add = async (list: FileList | null) => {
    if (!list) return;
    const room = Math.min(max, LIMITS.maxFiles) - files.length;
    for (const file of Array.from(list).slice(0, Math.max(0, room))) {
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const check = checkFile(head, file.size, accept);
      if (!check.ok) {
        onError(check.error!);
        continue;
      }
      const processed = check.kind === 'image' ? await processImage(file, check.mime!) : await processVideo(file, check.mime!);
      const previewUrl = URL.createObjectURL(check.kind === 'image' && processed.thumb ? processed.thumb : processed.blob);
      onChange((prev) => [
        ...prev,
        {
          key: crypto.randomUUID(),
          name: file.name,
          kind: check.kind!,
          mime: processed.mime,
          blob: processed.blob,
          thumb: processed.thumb,
          previewUrl,
          width: processed.width,
          height: processed.height,
          durationMs: processed.durationMs,
          size: processed.blob.size,
          status: 'ready',
          progress: 0,
        },
      ]);
    }
    if (camRef.current) camRef.current.value = '';
    if (libRef.current) libRef.current.value = '';
  };

  const full = files.length >= Math.min(max, LIMITS.maxFiles);
  const what = accept === 'photo' ? 'photo' : accept === 'video' ? 'video' : 'photo or video';

  return (
    <div className="stack-sm">
      {files.length > 0 && (
        <ul className="media-grid" style={{ listStyle: 'none', margin: 0, padding: 0, gridTemplateColumns: files.length === 1 ? '1fr' : undefined }}>
          {files.map((f) => (
            <li key={f.key} className="media-tile" style={{ aspectRatio: files.length === 1 ? '4 / 3' : '1' }}>
              {f.kind === 'image' ? (
                <img src={f.previewUrl} alt={`Selected photo ${f.name}`} />
              ) : (
                <video src={f.previewUrl} controls playsInline muted preload="metadata" aria-label={`Selected video ${f.name}`} />
              )}
              <span className="media-tile__badge badge">
                {f.status === 'uploading' ? `${Math.round(f.progress * 100)}%` : f.status === 'uploaded' ? 'Uploaded' : f.status === 'error' ? 'Failed' : formatBytes(f.size)}
              </span>
              {f.status === 'uploading' && (
                <div className="progress" style={{ position: 'absolute', left: 6, right: 6, top: 6 }} role="progressbar" aria-valuenow={Math.round(f.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                  <span style={{ width: `${f.progress * 100}%` }} />
                </div>
              )}
              {f.status !== 'uploading' && !disabled && (
                <Button
                  size="sm"
                  iconOnly
                  icon="x"
                  style={{ position: 'absolute', right: 6, top: 6 }}
                  onClick={() => {
                    URL.revokeObjectURL(f.previewUrl);
                    onChange((prev) => prev.filter((x) => x.key !== f.key));
                  }}
                >
                  Remove {f.name}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="dropzone">
          <Icon name={accept === 'video' ? 'video' : 'camera'} size={32} />
          <div className="grid-2" style={{ width: '100%' }}>
            <Button variant="secondary" icon={accept === 'video' ? 'video' : 'camera'} disabled={disabled} onClick={() => camRef.current?.click()}>
              {accept === 'video' ? 'Record' : 'Camera'}
            </Button>
            <Button icon="image" disabled={disabled} onClick={() => libRef.current?.click()}>
              Library
            </Button>
          </div>
          <span className="xsmall muted">
            Add a {what}. Photos up to {formatBytes(LIMITS.imageBytes)}, videos up to {formatBytes(LIMITS.videoBytes)}.
          </span>
          <input
            ref={camRef}
            type="file"
            accept={acceptAttr(accept === 'either' ? 'photo' : accept)}
            capture="environment"
            hidden
            onChange={(e) => add(e.target.files)}
            aria-label={`Use camera to take a ${what}`}
          />
          <input ref={libRef} type="file" accept={acceptAttr(accept)} multiple={max > 1} hidden onChange={(e) => add(e.target.files)} aria-label={`Choose a ${what}`} />
        </div>
      )}
    </div>
  );
}
