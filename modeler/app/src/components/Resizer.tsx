import { type KeyboardEvent, type PointerEvent, useRef } from 'react';

interface Props {
  /** `vertical`: a bar between left and right panels (drag horizontally). `horizontal`: between top and bottom. */
  orientation: 'vertical' | 'horizontal';
  /** Current size of the panel that the bar resizes. */
  size: number;
  /** Which way a positive pointer movement changes the size: `+1` when the panel grows to the right / downwards. */
  direction: 1 | -1;
  label: string;
  onResize(size: number, final: boolean): void;
  testId?: string;
}

const STEP = 16;

/** A draggable (and keyboard-operable) separator between two panels. */
export function Resizer({ orientation, size, direction, label, onResize, testId }: Props) {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const vertical = orientation === 'vertical';

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start: vertical ? event.clientX : event.clientY, size };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const delta = (vertical ? event.clientX : event.clientY) - drag.current.start;
    onResize(drag.current.size + direction * delta, false);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    const delta = (vertical ? event.clientX : event.clientY) - drag.current.start;
    onResize(drag.current.size + direction * delta, true);
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const grow = vertical ? 'ArrowRight' : 'ArrowDown';
    const shrink = vertical ? 'ArrowLeft' : 'ArrowUp';
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    onResize(size + direction * (event.key === grow ? STEP : -STEP), true);
  };

  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={size}
      tabIndex={0}
      className={`resizer ${vertical ? 'resizer-v' : 'resizer-h'}`}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
}
