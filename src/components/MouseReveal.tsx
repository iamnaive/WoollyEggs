import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

const TOP_IMAGE = "/reveal/top.jpg";
const UNDER_IMAGE = "/reveal/under.jpg";

type Vec2 = { x: number; y: number };

function createPlaceholderTexture(colors: [string, string, string]): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    return texture;
  }

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(0.5, colors[1]);
  gradient.addColorStop(1, colors[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function loadTextureWithPlaceholder(
  loader: THREE.TextureLoader,
  path: string,
  placeholder: THREE.Texture
): Promise<{ texture: THREE.Texture; loaded: boolean }> {
  return new Promise((resolve) => {
    loader.load(
      path,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        resolve({ texture, loaded: true });
      },
      undefined,
      () => resolve({ texture: placeholder, loaded: false })
    );
  });
}

export default function MouseReveal(): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const [useCssFallback, setUseCssFallback] = useState(false);
  const [topLoaded, setTopLoaded] = useState(true);
  const [underLoaded, setUnderLoaded] = useState(true);

  const cssTargetRef = useRef<Vec2>({ x: 0.5, y: 0.5 });
  const cssCurrentRef = useRef<Vec2>({ x: 0.5, y: 0.5 });
  const cssRadiusTargetRef = useRef(120);
  const cssRadiusCurrentRef = useRef(120);
  const cssPressedRef = useRef(false);

  useEffect(() => {
    const host = canvasHostRef.current;
    const root = rootRef.current;
    if (!host || !root) {
      return;
    }

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    const onReducedMotionChange = (event: MediaQueryListEvent): void => {
      reducedMotion = event.matches;
    };
    reducedMotionQuery.addEventListener("change", onReducedMotionChange);

    const pointerTarget: Vec2 = { x: 0.5, y: 0.5 };
    const pointerCurrent: Vec2 = { x: 0.5, y: 0.5 };
    let radiusTarget = 120;
    let radiusCurrent = 120;
    let isPressed = false;

    const toLocalUv = (clientX: number, clientY: number): Vec2 => {
      const rect = root.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      return {
        x: Math.min(1, Math.max(0, x)),
        y: 1 - Math.min(1, Math.max(0, y))
      };
    };

    const onPointerMove = (event: PointerEvent): void => {
      const uv = toLocalUv(event.clientX, event.clientY);
      pointerTarget.x = uv.x;
      pointerTarget.y = uv.y;
      cssTargetRef.current = uv;
    };

    const onPointerDown = (): void => {
      isPressed = true;
      cssPressedRef.current = true;
      radiusTarget = 180;
      cssRadiusTargetRef.current = 180;
    };

    const onPointerUp = (): void => {
      isPressed = false;
      cssPressedRef.current = false;
      radiusTarget = 120;
      cssRadiusTargetRef.current = 120;
    };

    const onTouchStart = (event: TouchEvent): void => {
      if (!event.touches[0]) {
        return;
      }
      const touch = event.touches[0];
      const uv = toLocalUv(touch.clientX, touch.clientY);
      pointerTarget.x = uv.x;
      pointerTarget.y = uv.y;
      cssTargetRef.current = uv;
      onPointerDown();
    };

    const onTouchMove = (event: TouchEvent): void => {
      if (!event.touches[0]) {
        return;
      }
      const touch = event.touches[0];
      const uv = toLocalUv(touch.clientX, touch.clientY);
      pointerTarget.x = uv.x;
      pointerTarget.y = uv.y;
      cssTargetRef.current = uv;
    };

    const onTouchEnd = (): void => {
      onPointerUp();
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    let rafId = 0;
    let cssRafId = 0;
    let cleanupWebGL: (() => void) | null = null;
    let cancelled = false;

    const startCssFallbackLoop = (): void => {
      const tick = (): void => {
        const smooth = reducedMotion ? 0.32 : 0.16;
        cssCurrentRef.current.x += (cssTargetRef.current.x - cssCurrentRef.current.x) * smooth;
        cssCurrentRef.current.y += (cssTargetRef.current.y - cssCurrentRef.current.y) * smooth;

        const radiusSmooth = reducedMotion ? 0.2 : 0.11;
        cssRadiusCurrentRef.current +=
          (cssRadiusTargetRef.current - cssRadiusCurrentRef.current) * radiusSmooth;

        root.style.setProperty("--mx", `${(cssCurrentRef.current.x * 100).toFixed(3)}%`);
        root.style.setProperty("--my", `${((1 - cssCurrentRef.current.y) * 100).toFixed(3)}%`);
        root.style.setProperty("--reveal-radius", `${cssRadiusCurrentRef.current.toFixed(2)}px`);
        root.style.setProperty(
          "--reveal-soft",
          `${(reducedMotion ? 40 : isPressed ? 64 : 56).toFixed(2)}px`
        );

        cssRafId = window.requestAnimationFrame(tick);
      };
      tick();
    };

    const initWebGL = async (): Promise<void> => {
      try {
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance"
        });
        renderer.setClearColor(0xffffff, 1);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const topPlaceholder = createPlaceholderTexture(["#f5f7ff", "#dde6ff", "#bccdf6"]);
        const underPlaceholder = createPlaceholderTexture(["#fff3dd", "#ffcbb0", "#e6a7d1"]);
        const loader = new THREE.TextureLoader();

        const [topResult, underResult] = await Promise.all([
          loadTextureWithPlaceholder(loader, TOP_IMAGE, topPlaceholder),
          loadTextureWithPlaceholder(loader, UNDER_IMAGE, underPlaceholder)
        ]);

        if (cancelled) {
          topResult.texture.dispose();
          underResult.texture.dispose();
          if (topResult.texture !== topPlaceholder) {
            topPlaceholder.dispose();
          }
          if (underResult.texture !== underPlaceholder) {
            underPlaceholder.dispose();
          }
          renderer.dispose();
          return;
        }

        setTopLoaded(topResult.loaded);
        setUnderLoaded(underResult.loaded);

        const uniforms = {
          uTop: { value: topResult.texture },
          uUnder: { value: underResult.texture },
          uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
          uCursor: { value: new THREE.Vector2(0.5, 0.5) },
          uParallax: { value: new THREE.Vector2(0, 0) },
          uRadius: { value: 120 },
          uFeather: { value: reducedMotion ? 42 : 56 },
          uTime: { value: 0 },
          uReducedMotion: { value: reducedMotion ? 1 : 0 },
          uAberrationStrength: { value: reducedMotion ? 0 : 3.0 },
          uGlowStrength: { value: reducedMotion ? 0.035 : 0.07 }
        };

        const material = new THREE.ShaderMaterial({
          uniforms,
          vertexShader: `
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            varying vec2 vUv;
            uniform sampler2D uTop;
            uniform sampler2D uUnder;
            uniform vec2 uResolution;
            uniform vec2 uCursor;
            uniform vec2 uParallax;
            uniform float uRadius;
            uniform float uFeather;
            uniform float uTime;
            uniform float uReducedMotion;
            uniform float uAberrationStrength;
            uniform float uGlowStrength;

            float hash(vec2 p) {
              return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }

            float noise(vec2 p) {
              vec2 i = floor(p);
              vec2 f = fract(p);
              float a = hash(i);
              float b = hash(i + vec2(1.0, 0.0));
              float c = hash(i + vec2(0.0, 1.0));
              float d = hash(i + vec2(1.0, 1.0));
              vec2 u = f * f * (3.0 - 2.0 * f);
              return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }

            vec2 clampUv(vec2 uv) {
              return clamp(uv, vec2(0.0), vec2(1.0));
            }

            void main() {
              vec2 uv = vUv;
              vec2 pxToUv = 1.0 / uResolution;
              vec2 cursorPx = uCursor * uResolution;
              vec2 fragPx = uv * uResolution;
              vec2 fromCursor = fragPx - cursorPx;
              float distPx = length(fromCursor);

              float n = noise(uv * 8.0 + vec2(uTime * 0.35, -uTime * 0.25));
              float noiseAmp = mix(0.0, 9.0, 1.0 - uReducedMotion);
              float distortedRadius = uRadius + (n - 0.5) * noiseAmp;
              float mask = 1.0 - smoothstep(
                distortedRadius - uFeather,
                distortedRadius + uFeather,
                distPx
              );

              float edgeInner = smoothstep(distortedRadius - uFeather * 1.2, distortedRadius, distPx);
              float edgeOuter = smoothstep(distortedRadius, distortedRadius + uFeather * 1.2, distPx);
              float edgeBand = clamp(edgeInner - edgeOuter, 0.0, 1.0);

              vec2 topUv = clampUv(uv + uParallax * pxToUv);
              vec2 underUv = clampUv(uv - uParallax * pxToUv * 1.2);
              vec4 topColor = texture2D(uTop, topUv);
              vec4 underColor = texture2D(uUnder, underUv);
              vec4 mixed = mix(topColor, underColor, mask);

              vec2 direction = normalize(fromCursor + vec2(0.0001));
              float aberr = uAberrationStrength * edgeBand * (1.0 - uReducedMotion);
              vec3 split;
              split.r = texture2D(uUnder, clampUv(underUv + direction * aberr * pxToUv)).r;
              split.g = texture2D(uUnder, underUv).g;
              split.b = texture2D(uUnder, clampUv(underUv - direction * aberr * pxToUv)).b;
              mixed.rgb = mix(mixed.rgb, split, edgeBand * 0.35 * (1.0 - uReducedMotion));

              float glow = edgeBand * uGlowStrength;
              mixed.rgb += vec3(0.84, 0.92, 1.0) * glow;

              float vignette = smoothstep(0.22, 0.92, length(uv - 0.5));
              mixed.rgb *= 1.0 - vignette * 0.15;

              gl_FragColor = mixed;
            }
          `
        });

        const geometry = new THREE.PlaneGeometry(2, 2);
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        const onResize = (): void => {
          const width = window.innerWidth;
          const height = window.innerHeight;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
          renderer.setSize(width, height, false);
          uniforms.uResolution.value.set(width, height);
        };
        onResize();
        window.addEventListener("resize", onResize, { passive: true });

        const animate = (): void => {
          const pointerSmooth = reducedMotion ? 0.28 : 0.14;
          const radiusSmooth = reducedMotion ? 0.22 : 0.1;

          pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * pointerSmooth;
          pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * pointerSmooth;
          radiusCurrent += (radiusTarget - radiusCurrent) * radiusSmooth;

          const pxShiftX = (pointerCurrent.x - 0.5) * 18;
          const pxShiftY = (pointerCurrent.y - 0.5) * 14;

          uniforms.uCursor.value.set(pointerCurrent.x, pointerCurrent.y);
          uniforms.uRadius.value = radiusCurrent;
          uniforms.uParallax.value.set(pxShiftX, pxShiftY);
          uniforms.uTime.value += reducedMotion ? 0 : 0.012;
          uniforms.uFeather.value = reducedMotion ? 40 : isPressed ? 62 : 55;
          uniforms.uReducedMotion.value = reducedMotion ? 1 : 0;
          uniforms.uAberrationStrength.value = reducedMotion ? 0 : 3.0;
          uniforms.uGlowStrength.value = reducedMotion ? 0.035 : 0.07;

          renderer.render(scene, camera);
          rafId = window.requestAnimationFrame(animate);
        };
        animate();

        cleanupWebGL = () => {
          window.removeEventListener("resize", onResize);
          window.cancelAnimationFrame(rafId);
          geometry.dispose();
          material.dispose();
          topResult.texture.dispose();
          underResult.texture.dispose();
          if (topResult.texture !== topPlaceholder) {
            topPlaceholder.dispose();
          }
          if (underResult.texture !== underPlaceholder) {
            underPlaceholder.dispose();
          }
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch {
        setUseCssFallback(true);
        startCssFallbackLoop();
      }
    };

    void initWebGL();

    return () => {
      cancelled = true;
      reducedMotionQuery.removeEventListener("change", onReducedMotionChange);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.cancelAnimationFrame(cssRafId);
      if (cleanupWebGL) {
        cleanupWebGL();
      }
    };
  }, []);

  const topBackground = topLoaded
    ? `url("${TOP_IMAGE}")`
    : "linear-gradient(135deg, #eaf0ff 0%, #d8e2ff 45%, #bdcef9 100%)";
  const underBackground = underLoaded
    ? `url("${UNDER_IMAGE}")`
    : "linear-gradient(135deg, #fff3dd 0%, #ffc8ab 48%, #d8a8d8 100%)";

  return (
    <section
      ref={rootRef}
      className={`reveal-root${useCssFallback ? " is-css-fallback" : ""}`}
      style={
        {
          "--top-bg": topBackground,
          "--under-bg": underBackground
        } as React.CSSProperties
      }
    >
      <div ref={canvasHostRef} className="canvas-host" />

      {useCssFallback ? (
        <div className="css-fallback-layer" aria-hidden>
          <div className="css-fallback-under" />
          <div className="css-fallback-top" />
        </div>
      ) : null}

      <div className="vignette-overlay" aria-hidden />
      <div className="grain-overlay" aria-hidden />
      <div className="hint-icon" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" role="img" aria-label="cursor hint icon">
          <path
            d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </section>
  );
}
