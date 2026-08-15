import React, { useRef, useEffect, useState, useCallback } from 'react';
import { TacticalAnnotation, TacticalTool, Point } from '../types';

interface TacticalCanvasProps {
  currentTime: number;
  duration: number;
  annotations: TacticalAnnotation[];
  onAddAnnotation: (annotation: TacticalAnnotation) => void;
  selectedTool: TacticalTool;
  selectedColor: string;
  strokeWidth: number;
  isDrawingEnabled: boolean;
}

export const TacticalCanvas: React.FC<TacticalCanvasProps> = React.memo(({
  currentTime,
  annotations,
  onAddAnnotation,
  selectedTool,
  selectedColor,
  strokeWidth,
  isDrawingEnabled,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [textInputPos, setTextInputPos] = useState<Point | null>(null);
  const [textInputValue, setTextInputValue] = useState('');

  // Get normalized coordinates [0..1]
  const getNormalizedPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  // Render routine - all annotations carry over continuously during video playback
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // 1. Render all annotations (persistent tactical canvas layer)
    annotations.forEach(ann => {
      ctx.save();
      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = ann.strokeWidth * (width / 1200);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = ann.color;
      ctx.shadowBlur = 4;

      if (ann.tool === 'brush') {
        if (ann.points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(ann.points[0].x * width, ann.points[0].y * height);
          for (let i = 1; i < ann.points.length; i++) {
            ctx.lineTo(ann.points[i].x * width, ann.points[i].y * height);
          }
          ctx.stroke();
        }
      } else if (ann.tool === 'arrow') {
        if (ann.points.length >= 2) {
          const p1 = ann.points[0];
          const p2 = ann.points[ann.points.length - 1];
          const startX = p1.x * width;
          const startY = p1.y * height;
          const endX = p2.x * width;
          const endY = p2.y * height;

          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          // Arrowhead
          const headLength = 18 * (width / 1200);
          const angle = Math.atan2(endY - startY, endX - startX);
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - headLength * Math.cos(angle - Math.PI / 6),
            endY - headLength * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            endX - headLength * Math.cos(angle + Math.PI / 6),
            endY - headLength * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fill();
        }
      } else if (ann.tool === 'halo') {
        if (ann.points.length >= 2) {
          const p1 = ann.points[0];
          const p2 = ann.points[ann.points.length - 1];
          const centerX = p1.x * width;
          const centerY = p1.y * height;
          const dx = (p2.x - p1.x) * width;
          const dy = (p2.y - p1.y) * height;
          const radius = Math.sqrt(dx * dx + dy * dy);

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `${ann.color}26`;
          ctx.fill();
        }
      } else if (ann.tool === 'rect') {
        if (ann.points.length >= 2) {
          const p1 = ann.points[0];
          const p2 = ann.points[ann.points.length - 1];
          const minX = Math.min(p1.x, p2.x) * width;
          const minY = Math.min(p1.y, p2.y) * height;
          const w = Math.abs(p2.x - p1.x) * width;
          const h = Math.abs(p2.y - p1.y) * height;

          ctx.strokeRect(minX, minY, w, h);
          ctx.fillStyle = `${ann.color}1A`;
          ctx.fillRect(minX, minY, w, h);
        }
      } else if (ann.tool === 'text' && ann.text) {
        const x = ann.points[0].x * width;
        const y = ann.points[0].y * height;
        const fontSize = 16 * (width / 1200);
        ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 3;
        ctx.fillText(ann.text, x, y);
      }

      ctx.restore();
    });

    // 2. Render live in-progress drawing preview
    if (isMouseDown && currentPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = selectedColor;
      ctx.fillStyle = selectedColor;
      ctx.lineWidth = strokeWidth * (width / 1200);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = selectedColor;
      ctx.shadowBlur = 6;

      if (selectedTool === 'brush') {
        if (currentPoints.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(currentPoints[0].x * width, currentPoints[0].y * height);
          for (let i = 1; i < currentPoints.length; i++) {
            ctx.lineTo(currentPoints[i].x * width, currentPoints[i].y * height);
          }
          ctx.stroke();
        }
      } else if (selectedTool === 'arrow') {
        if (currentPoints.length >= 2) {
          const p1 = currentPoints[0];
          const p2 = currentPoints[currentPoints.length - 1];
          const startX = p1.x * width;
          const startY = p1.y * height;
          const endX = p2.x * width;
          const endY = p2.y * height;

          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          const headLength = 18 * (width / 1200);
          const angle = Math.atan2(endY - startY, endX - startX);
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(
            endX - headLength * Math.cos(angle - Math.PI / 6),
            endY - headLength * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            endX - headLength * Math.cos(angle + Math.PI / 6),
            endY - headLength * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fill();
        }
      } else if (selectedTool === 'halo') {
        if (currentPoints.length >= 2) {
          const p1 = currentPoints[0];
          const p2 = currentPoints[currentPoints.length - 1];
          const centerX = p1.x * width;
          const centerY = p1.y * height;
          const dx = (p2.x - p1.x) * width;
          const dy = (p2.y - p1.y) * height;
          const radius = Math.sqrt(dx * dx + dy * dy);

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = `${selectedColor}26`;
          ctx.fill();
        }
      } else if (selectedTool === 'rect') {
        if (currentPoints.length >= 2) {
          const p1 = currentPoints[0];
          const p2 = currentPoints[currentPoints.length - 1];
          const minX = Math.min(p1.x, p2.x) * width;
          const minY = Math.min(p1.y, p2.y) * height;
          const w = Math.abs(p2.x - p1.x) * width;
          const h = Math.abs(p2.y - p1.y) * height;

          ctx.strokeRect(minX, minY, w, h);
          ctx.fillStyle = `${selectedColor}1A`;
          ctx.fillRect(minX, minY, w, h);
        }
      }
      ctx.restore();
    }
  }, [
    annotations,
    isMouseDown,
    currentPoints,
    selectedColor,
    selectedTool,
    strokeWidth,
  ]);

  const renderCanvasRef = useRef(renderCanvas);
  useEffect(() => {
    renderCanvasRef.current = renderCanvas;
  }, [renderCanvas]);

  // RequestAnimationFrame batching for high FPS rendering
  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      renderCanvas();
    });
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [renderCanvas]);

  // Resize only when the element's physical size actually changes. Recreating
  // the backing texture on every pointer update can invalidate the video/canvas
  // compositor and briefly expose a stale or green video frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const pixelRatio = window.devicePixelRatio || 1;
          const targetWidth = Math.max(1, Math.round(width * pixelRatio));
          const targetHeight = Math.max(1, Math.round(height * pixelRatio));
          if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            renderCanvasRef.current();
          }
        }
      }
    });

    resizeObserver.observe(canvas.parentElement || canvas);
    return () => resizeObserver.disconnect();
  }, []);

  // Mouse handlers for drawing
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingEnabled || e.button !== 0) return;
    const pt = getNormalizedPoint(e);

    if (selectedTool === 'text') {
      setTextInputPos(pt);
      setTextInputValue('');
      return;
    }

    setIsMouseDown(true);
    setCurrentPoints([pt]);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isMouseDown) return;
    const pt = getNormalizedPoint(e);

    if (selectedTool === 'brush') {
      setCurrentPoints(prev => [...prev, pt]);
    } else {
      setCurrentPoints(prev => [prev[0], pt]);
    }
  };

  const handleMouseUp = () => {
    if (!isMouseDown) return;
    setIsMouseDown(false);

    if (currentPoints.length >= 2) {
      const newAnnotation: TacticalAnnotation = {
        id: `ann_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        tool: selectedTool,
        color: selectedColor,
        strokeWidth: strokeWidth,
        points: currentPoints,
        timestamp: currentTime,
        duration: 0,
      };
      onAddAnnotation(newAnnotation);
    }
    setCurrentPoints([]);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInputPos && textInputValue.trim()) {
      const newAnnotation: TacticalAnnotation = {
        id: `ann_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        tool: 'text',
        color: selectedColor,
        strokeWidth: strokeWidth,
        points: [textInputPos],
        timestamp: currentTime,
        duration: 0,
        text: textInputValue.trim(),
      };
      onAddAnnotation(newAnnotation);
    }
    setTextInputPos(null);
    setTextInputValue('');
  };

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-auto">
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${
          isDrawingEnabled
            ? selectedTool === 'brush'
              ? 'cursor-crosshair'
              : selectedTool === 'arrow'
              ? 'cursor-crosshair'
              : selectedTool === 'text'
              ? 'cursor-text'
              : 'cursor-crosshair'
            : 'cursor-default'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {textInputPos && (
        <form
          onSubmit={handleTextSubmit}
          className="absolute z-30"
          style={{
            left: `${textInputPos.x * 100}%`,
            top: `${textInputPos.y * 100}%`,
          }}
        >
          <input
            autoFocus
            type="text"
            value={textInputValue}
            onChange={e => setTextInputValue(e.target.value)}
            onBlur={handleTextSubmit}
            placeholder="Type tactical note..."
            className="bg-black/90 text-yellow-300 font-mono text-sm px-2.5 py-1 rounded border border-yellow-400/50 shadow-lg outline-none"
          />
        </form>
      )}
    </div>
  );
});
