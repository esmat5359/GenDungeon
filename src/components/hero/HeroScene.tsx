import { useEffect, useRef } from "react";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  Shape,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { MARK_POLYGONS } from "../../assets/genlayerMark";

interface Props {
  onFail?: () => void;
  onReady?: () => void;
}

const HALF = 1.55; // half-size of the mark in scene units
const DEPTH = 0.3;
const PARTICLES = 240;

function buildMark(): { group: Group; dispose: () => void } {
  const group = new Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const body = new MeshStandardMaterial({
    color: 0x5fc7b0,
    metalness: 0.55,
    roughness: 0.34,
    emissive: 0x0f4d42,
    emissiveIntensity: 0.7,
  });
  const edge = new LineBasicMaterial({ color: 0x8fe0cd, transparent: true, opacity: 0.55 });
  disposables.push(body, edge);

  for (const polygon of MARK_POLYGONS) {
    const shape = new Shape();
    polygon.forEach(([x, y], index) => {
      const px = ((x - 50) / 50) * HALF;
      const py = (-(y - 50) / 50) * HALF;
      if (index === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    });
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, {
      depth: DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.025,
      bevelSegments: 2,
    });
    geometry.translate(0, 0, -DEPTH / 2);
    const edges = new EdgesGeometry(geometry, 28);
    disposables.push(geometry, edges);
    group.add(new Mesh(geometry, body));
    group.add(new LineSegments(edges, edge));
  }
  return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
}

function buildArch(): { line: Line; dispose: () => void } {
  const points: number[] = [];
  const radius = 2.35;
  const base = -2.55;
  points.push(-radius, base, 0);
  points.push(-radius, 0, 0);
  for (let i = 0; i <= 48; i++) {
    const a = Math.PI - (i / 48) * Math.PI;
    points.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
  }
  points.push(radius, base, 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  const material = new LineBasicMaterial({ color: 0xf08a3c, transparent: true, opacity: 0.55 });
  const line = new Line(geometry, material);
  line.position.z = -0.9;
  return {
    line,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export default function HeroScene({ onFail, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      onFail?.();
      return;
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(pixelRatio);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(38, 1, 0.1, 40);
    camera.position.set(0, 0.1, 7.6);

    scene.add(new AmbientLight(0x6f8f88, 0.7));
    const key = new DirectionalLight(0xffb070, 2.6);
    key.position.set(3.5, 3, 4);
    scene.add(key);
    const rim = new DirectionalLight(0x5fc7b0, 2.2);
    rim.position.set(-4, 1.5, -2);
    scene.add(rim);
    const torch = new PointLight(0xf08a3c, 14, 9, 2);
    torch.position.set(0, -1.6, 2.2);
    scene.add(torch);

    const mark = buildMark();
    const arch = buildArch();
    const rig = new Group();
    rig.add(mark.group);
    scene.add(rig);
    scene.add(arch.line);

    const ringGeometry = new RingGeometry(2.62, 2.64, 160);
    const ringMaterial = new MeshBasicMaterial({ color: 0x5fc7b0, transparent: true, opacity: 0.22 });
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.position.z = -1.2;
    scene.add(ring);

    // Embers drifting upward
    const positions = new Float32Array(PARTICLES * 3);
    const speeds = new Float32Array(PARTICLES);
    const drift = new Float32Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i++) {
      positions[i * 3] = MathUtils.randFloatSpread(6.4);
      positions[i * 3 + 1] = MathUtils.randFloatSpread(5.6);
      positions[i * 3 + 2] = MathUtils.randFloatSpread(3.2);
      speeds[i] = MathUtils.randFloat(0.12, 0.42);
      drift[i] = MathUtils.randFloat(0, Math.PI * 2);
    }
    const emberGeometry = new BufferGeometry();
    emberGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const emberMaterial = new PointsMaterial({
      color: 0xffa24d,
      size: 0.045,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const embers = new Points(emberGeometry, emberMaterial);
    scene.add(embers);

    const size = () => {
      const { clientWidth: w, clientHeight: h } = container;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Keep the whole doorway in view on tall, narrow screens.
      camera.position.z = camera.aspect < 0.9 ? 7.6 / Math.max(0.62, camera.aspect) : 7.6;
      camera.updateProjectionMatrix();
    };
    size();
    const resizeObserver = new ResizeObserver(size);
    resizeObserver.observe(container);

    const pointer = { x: 0, y: 0 };
    const onMove = (event: PointerEvent) => {
      const box = container.getBoundingClientRect();
      pointer.x = MathUtils.clamp(((event.clientX - box.left) / box.width) * 2 - 1, -1, 1);
      pointer.y = MathUtils.clamp(((event.clientY - box.top) / box.height) * 2 - 1, -1, 1);
    };
    const onLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    container.addEventListener("pointerleave", onLeave);

    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observer.observe(container);

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let slow = 0;
    let degraded = false;
    let lost = false;
    let ready = false;

    const onContextLost = (event: Event) => {
      event.preventDefault();
      lost = true;
      onFail?.();
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (lost || !visible || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Adaptive quality: after a short warm-up, step down once if frames are slow.
      frames++;
      if (!degraded && frames > 20 && frames <= 110) {
        if (dt > 0.034) slow++;
        if (frames === 110 && slow > 45) {
          degraded = true;
          pixelRatio = 1;
          renderer.setPixelRatio(1);
          size();
          emberGeometry.setDrawRange(0, Math.floor(PARTICLES / 3));
        }
      }

      const t = now / 1000;
      rig.rotation.y = MathUtils.damp(rig.rotation.y, pointer.x * 0.55 + Math.sin(t * 0.45) * 0.22, 3.2, dt);
      rig.rotation.x = MathUtils.damp(rig.rotation.x, pointer.y * 0.28 + Math.sin(t * 0.33) * 0.05, 3.2, dt);
      rig.position.y = Math.sin(t * 0.9) * 0.07;
      arch.line.rotation.y = rig.rotation.y * 0.35;
      ring.rotation.z = t * 0.06;
      torch.intensity = 13 + Math.sin(t * 9) * 1.2 + Math.sin(t * 5.3) * 1.6;

      const p = emberGeometry.attributes.position as Float32BufferAttribute;
      const limit = degraded ? PARTICLES / 3 : PARTICLES;
      for (let i = 0; i < limit; i++) {
        let y = p.getY(i) + speeds[i] * dt;
        if (y > 2.9) y = -2.9;
        p.setY(i, y);
        p.setX(i, p.getX(i) + Math.sin(t * 0.8 + drift[i]) * 0.0018);
      }
      p.needsUpdate = true;

      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        onReady?.();
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      mark.dispose();
      arch.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      emberGeometry.dispose();
      emberMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onFail, onReady]);

  return <div ref={host} className="absolute inset-0" data-testid="hero-canvas" />;
}
