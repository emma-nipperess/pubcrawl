import { useRef, useState, type ReactNode } from 'react';
import { Button } from './ui';
import { Icon } from './Icon';

/**
 * Minimal drag-to-reorder list. Pointer drag via the grip handle (touch,
 * mouse, pen) plus always-visible up/down buttons and arrow keys on the handle
 * as accessible alternatives. Calls onMove(from, to) once per drop.
 */
export function SortableList<T>({
  items,
  getKey,
  onMove,
  render,
  label,
  disabled,
}: {
  items: readonly T[];
  getKey: (item: T) => string;
  onMove: (from: number, to: number) => void;
  render: (item: T, index: number, handle: ReactNode) => ReactNode;
  label: (item: T) => string;
  disabled?: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number; dy: number } | null>(null);
  const start = useRef<{ y: number; from: number; heights: number[]; tops: number[] } | null>(null);
  const [announce, setAnnounce] = useState('');

  const onPointerDown = (e: React.PointerEvent, index: number) => {
    if (disabled) return;
    const els = Array.from(listRef.current?.children ?? []) as HTMLElement[];
    start.current = { y: e.clientY, from: index, heights: els.map((el) => el.offsetHeight), tops: els.map((el) => el.offsetTop) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ from: index, over: index, dy: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    const centre = s.tops[s.from] + s.heights[s.from] / 2 + dy;
    let over = s.from;
    for (let i = 0; i < s.tops.length; i++) {
      if (centre > s.tops[i] && centre < s.tops[i] + s.heights[i]) over = i;
    }
    setDrag({ from: s.from, over, dy });
  };
  const onPointerUp = () => {
    const d = drag;
    start.current = null;
    setDrag(null);
    if (d && d.from !== d.over) {
      onMove(d.from, d.over);
      setAnnounce(`Moved to position ${d.over + 1}`);
    }
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    onMove(from, to);
    setAnnounce(`${label(items[from])} moved to position ${to + 1} of ${items.length}`);
  };

  const shift = (i: number): number => {
    if (!drag || !start.current) return 0;
    const h = start.current.heights[drag.from] + 8;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -h;
    if (drag.from > drag.over && i < drag.from && i >= drag.over) return h;
    return 0;
  };

  return (
    <>
      <ol ref={listRef} className="list" style={{ gap: 8 }}>
        {items.map((item, i) => {
          const handle = (
            <div className="row" style={{ gap: 0 }}>
              <button
                type="button"
                className="drag-handle"
                aria-label={`Reorder ${label(item)}. Use arrow keys to move.`}
                disabled={disabled}
                onPointerDown={(e) => onPointerDown(e, i)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    move(i, i - 1);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    move(i, i + 1);
                  }
                }}
              >
                <Icon name="grip" />
              </button>
              <div className="stack-sm" style={{ gap: 2 }}>
                <Button size="sm" variant="ghost" iconOnly icon="arrow-up" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} className="btn--sm" style={{ minHeight: 28, width: 32 }}>
                  Move {label(item)} up
                </Button>
                <Button size="sm" variant="ghost" iconOnly icon="arrow-down" disabled={disabled || i === items.length - 1} onClick={() => move(i, i + 1)} style={{ minHeight: 28, width: 32 }}>
                  Move {label(item)} down
                </Button>
              </div>
            </div>
          );
          return (
            <li
              key={getKey(item)}
              className={['sortable-item', drag?.from === i && 'is-dragging'].filter(Boolean).join(' ')}
              style={{ transform: drag ? `translateY(${shift(i)}px)` : undefined, transition: drag?.from === i ? 'none' : undefined }}
            >
              {render(item, i, handle)}
            </li>
          );
        })}
      </ol>
      <span className="sr-only" aria-live="assertive">
        {announce}
      </span>
    </>
  );
}

export function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
  const a = arr.slice();
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}
