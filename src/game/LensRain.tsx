import { useEffect, useRef } from 'react';

type Drop = { x: number; y: number; size: number; speed: number; drift: number };

/** A small, independent 2D layer: no extra WebGL pass or multiplayer traffic. */
export default function LensRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let seed = 93481;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const drops: Drop[] = Array.from({ length: 34 }, () => ({
      x: random(), y: random(), size: 3 + random() * 7,
      speed: 26 + random() * 78, drift: (random() - 0.5) * 12,
    }));
    const sprite = document.createElement('canvas');
    sprite.width = 40;
    sprite.height = 48;
    const spriteContext = sprite.getContext('2d')!;
    const shine = spriteContext.createRadialGradient(12, 9, 1, 20, 25, 22);
    shine.addColorStop(0, '#f4fdffbf');
    shine.addColorStop(0.2, '#a7d8ed68');
    shine.addColorStop(0.65, '#5d91b42b');
    shine.addColorStop(0.85, '#e8fbffb0');
    shine.addColorStop(1, '#e8fbff00');
    spriteContext.fillStyle = shine;
    spriteContext.beginPath();
    spriteContext.ellipse(20, 25, 17, 21, 0, 0, Math.PI * 2);
    spriteContext.fill();
    let width = 1, height = 1, frame = 0, previous = 0;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - previous < 30) return;
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      context.clearRect(0, 0, width, height);
      for (const drop of drops) {
        if (!reduce.matches) {
          drop.y += (drop.speed * dt) / height;
          drop.x += (drop.drift * dt) / width;
        }
        const x = drop.x * width, y = drop.y * height;
        context.globalAlpha = 0.48;
        context.drawImage(sprite, x - drop.size, y - drop.size * 1.2, drop.size * 2, drop.size * 2.4);
        if (!reduce.matches && drop.speed > 54) {
          context.strokeStyle = '#d5f2ff5e';
          context.lineWidth = Math.max(0.7, drop.size * 0.12);
          context.beginPath();
          context.moveTo(x, y - drop.size);
          context.lineTo(x - drop.drift * 0.1, y - drop.size - drop.speed * 0.17);
          context.stroke();
        }
        if (drop.y > 1.08) {
          drop.y = -0.08 - random() * 0.2;
          drop.x = random();
        }
      }
      context.globalAlpha = 1;
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  return <canvas ref={canvasRef} className="lens-rain" aria-hidden="true" />;
}
