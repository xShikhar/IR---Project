import React, { useEffect, useRef } from 'react';

// Draw the filaments once at the display resolution. Motion is composited in CSS.
export default function OrbitArtwork() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    function draw() {
      const size = Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
      if (!size) return;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(size / 600, size / 600);
      ctx.translate(300, 300);
      ctx.rotate(-0.42);
      ctx.globalCompositeOperation = 'screen';
      for (let strand = 0; strand < 104; strand++) {
        const depth = strand / 103;
        const color = ctx.createLinearGradient(-220, -120, 230, 140);
        color.addColorStop(0, '#e9a8d9');
        color.addColorStop(0.42, '#b493fa');
        color.addColorStop(0.7, '#7953b7');
        color.addColorStop(1, '#ffcbad');
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.38 + depth * 0.3;
        ctx.lineWidth = 0.72;
        ctx.beginPath();
        for (let step = 0; step <= 360; step++) {
          const angle = step * Math.PI / 180;
          const twist = angle * 3 - depth * 2.9;
          const radius = 116 + 65 * depth + 40 * Math.cos(twist);
          const x = (radius + 22 * Math.sin(twist)) * Math.cos(angle) * 1.15;
          const y = radius * Math.sin(angle) * 0.92 + 38 * Math.sin(twist);
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  return <canvas className="orbit-artwork" aria-hidden="true" ref={ref} />;
}
