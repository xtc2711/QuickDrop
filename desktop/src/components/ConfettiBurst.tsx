import { useEffect, useRef, useCallback } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  decay: number;
  shape: "circle" | "rect" | "star";
}

interface ConfettiBurstProps {
  /** 触发次数，每次变化且 > 0 时触发一次爆发 */
  trigger: number;
  /** 爆发中心 X（默认视口中央） */
  centerX?: number;
  /** 爆发中心 Y（默认视口中央） */
  centerY?: number;
  /** 动画完成回调 */
  onComplete?: () => void;
}

const COLORS = [
  "#FF6B6B", // 红
  "#4ECDC4", // 青
  "#FFE66D", // 黄
  "#A78BFA", // 紫
  "#34D399", // 绿
  "#F472B6", // 粉
  "#60A5FA", // 蓝
  "#FB923C", // 橙
];

const PARTICLE_COUNT = 60;
const GRAVITY = 280; // px/s²
const AIR_RESISTANCE = 0.98;
const DURATION_MS = 2500;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function createParticle(x: number, y: number): Particle {
  const angle = randomBetween(0, Math.PI * 2);
  // 初速度：爆发式向外，带一些随机性
  const speed = randomBetween(200, 600);
  const shapes: Particle["shape"][] = ["circle", "rect", "star"];
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - randomBetween(100, 300), // 初始向上的偏移
    size: randomBetween(4, 10),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: randomBetween(0, Math.PI * 2),
    rotationSpeed: randomBetween(-8, 8),
    opacity: 1,
    decay: randomBetween(0.6, 1.2), // 淡出速度
    shape: shapes[Math.floor(Math.random() * shapes.length)],
  };
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const spikes = 5;
  const outerRadius = size;
  const innerRadius = size * 0.4;
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(x, y - outerRadius);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(
      x + Math.cos(rot) * outerRadius,
      y + Math.sin(rot) * outerRadius,
    );
    rot += step;
    ctx.lineTo(
      x + Math.cos(rot) * innerRadius,
      y + Math.sin(rot) * innerRadius,
    );
    rot += step;
  }
  ctx.lineTo(x, y - outerRadius);
  ctx.closePath();
  ctx.fill();
}

export default function ConfettiBurst({
  trigger,
  centerX,
  centerY,
  onComplete,
}: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const prevTriggerRef = useRef<number>(0);

  const animate = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (startTimeRef.current === 0) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const particles = particlesRef.current;

      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 更新和绘制粒子
      let hasVisibleParticles = false;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];

        // 物理更新（使用固定 dt 避免抖动）
        const frameDt = 0.016; // ~60fps
        p.vy += GRAVITY * frameDt;
        p.vx *= AIR_RESISTANCE;
        p.vy *= AIR_RESISTANCE;
        p.x += p.vx * frameDt;
        p.y += p.vy * frameDt;
        p.rotation += p.rotationSpeed * frameDt;
        p.opacity -= p.decay * frameDt;

        if (p.opacity <= 0) {
          particles.splice(i, 1);
          continue;
        }

        hasVisibleParticles = true;

        // 绘制
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;

        switch (p.shape) {
          case "rect":
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
            break;
          case "star":
            drawStar(ctx, 0, 0, p.size);
            break;
          case "circle":
          default:
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
            break;
        }

        ctx.restore();
      }

      // 结束判断
      if (elapsed >= DURATION_MS || !hasVisibleParticles) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particlesRef.current = [];
        startTimeRef.current = 0;
        onComplete?.();
        return;
      }

      rafRef.current = requestAnimationFrame(animate);
    },
    [onComplete],
  );

  useEffect(() => {
    // trigger 变化且大于 0 时触发新爆发
    if (trigger > 0 && trigger !== prevTriggerRef.current) {
      prevTriggerRef.current = trigger;

      // 取消之前可能还在运行的动画
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      // 同步 canvas 尺寸
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      // 确定爆发中心
      const cx = centerX ?? window.innerWidth / 2;
      const cy = centerY ?? window.innerHeight / 2;

      // 创建粒子
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () =>
        createParticle(cx, cy),
      );
      startTimeRef.current = 0;

      rafRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [trigger, centerX, centerY, animate]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    />
  );
}
