import { useRef, useEffect, useCallback } from 'react';

interface ReaderSplitterProps {
  value: number;
  onChange: (value: number) => void;
}

export default function ReaderSplitter({ value, onChange }: ReaderSplitterProps) {
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const container = containerRef.current?.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = (x / rect.width) * 100;

      // 限制在 20% - 80% 范围内
      const clamped = Math.min(Math.max(percentage, 20), 80);
      onChange(clamped);
    },
    [onChange]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className="reader-splitter"
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={20}
      aria-valuemax={80}
    >
      <div className="splitter-handle" />
    </div>
  );
}
