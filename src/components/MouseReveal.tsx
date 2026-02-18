import { CSSProperties, FormEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";

const TOP_IMAGE = "/reveal/top.avif";
const UNDER_IMAGE = "/reveal/under.avif";
const CURSOR_CLOSED = "/cursor/egg_closed.png";
const CURSOR_OPEN = "/cursor/egg_open_wl.png";
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

type Vec2 = { x: number; y: number };
type CaptureStatus = "idle" | "loading" | "saved" | "error";

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

function makeCursorSvgData(open: boolean): string {
  const wl = open
    ? "<text x='56' y='74' text-anchor='middle' font-family='Inter,Arial' font-size='26' fill='%23ffffff' font-weight='700'>WL</text>"
    : "";
  const shellGap = open
    ? "<ellipse cx='56' cy='64' rx='42' ry='20' fill='%237188bf' opacity='0.55'/>"
    : "<ellipse cx='56' cy='68' rx='40' ry='26' fill='%23849ad0'/>";
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='112' height='112' viewBox='0 0 112 112'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='%23a8b9e6'/>
          <stop offset='1' stop-color='%23647eba'/>
        </linearGradient>
      </defs>
      <ellipse cx='56' cy='58' rx='40' ry='46' fill='url(%23g)'/>
      <ellipse cx='46' cy='38' rx='12' ry='8' fill='%23ffffff' opacity='0.55'/>
      ${shellGap}
      ${wl}
    </svg>
  `;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function loadCursorAsset(path: string, fallback: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(path);
    image.onerror = () => resolve(fallback);
    image.src = path;
  });
}

export default function MouseReveal(): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const [useCssFallback, setUseCssFallback] = useState(false);
  const [topLoaded, setTopLoaded] = useState(true);
  const [underLoaded, setUnderLoaded] = useState(true);
  const [entered, setEntered] = useState(false);

  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const [cursorOpen, setCursorOpen] = useState(false);
  const [cursorBump, setCursorBump] = useState(false);
  const [cursorSuppressed, setCursorSuppressed] = useState(false);
  const cursorSuppressedRef = useRef(false);
  const [cursorClosedSrc, setCursorClosedSrc] = useState("");
  const [cursorOpenSrc, setCursorOpenSrc] = useState("");

  useEffect(() => {
    let live = true;
    void Promise.all([
      loadCursorAsset(CURSOR_CLOSED, makeCursorSvgData(false)),
      loadCursorAsset(CURSOR_OPEN, makeCursorSvgData(true))
    ]).then(([closed, open]) => {
      if (!live) {
        return;
      }
      setCursorClosedSrc(closed);
      setCursorOpenSrc(open);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  const handleAddressSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmed = address.trim();
    if (!ADDRESS_REGEX.test(trimmed)) {
      setStatus("error");
      setStatusMessage("Error");
      return;
    }

    try {
      setStatus("loading");
      setStatusMessage("");

      const response = await fetch("/api/monad-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: trimmed })
      });
      const data = (await response.json()) as { ok?: boolean; inserted?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Request failed");
      }

      setStatus("saved");
      setStatusMessage(data.inserted ? "Saved" : "Already saved");
    } catch {
      setStatus("error");
      setStatusMessage("Error");
    }
  };

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

    const pointerTargetUv: Vec2 = { x: 0.5, y: 0.5 };
    const pointerCurrentUv: Vec2 = { x: 0.5, y: 0.5 };
    const pointerVelocityUv: Vec2 = { x: 0, y: 0 };
    const pointerPixelCurrent: Vec2 = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
    const pointerPixelTarget: Vec2 = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };

    const cursorVelocityPx: Vec2 = { x: 0, y: 0 };
    let radiusBase = 118;
    let radiusCurrent = 118;
    let radiusVelocity = 0;
    let pulse = 0;
    let pulseVelocity = 0;
    let pressed = false;
    let onTouch = false;
    let activePointerId: number | null = null;

    const toLocalUv = (clientX: number, clientY: number): Vec2 => {
      const rect = root.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      return {
        x: Math.min(1, Math.max(0, x)),
        y: 1 - Math.min(1, Math.max(0, y))
      };
    };

    const trackPointer = (clientX: number, clientY: number): void => {
      const uv = toLocalUv(clientX, clientY);
      pointerTargetUv.x = uv.x;
      pointerTargetUv.y = uv.y;
      pointerPixelTarget.x = clientX;
      pointerPixelTarget.y = clientY;
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (activePointerId !== null && event.pointerId !== activePointerId) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const nextSuppressed = Boolean(target?.closest(".under-layer-mask"));
      if (nextSuppressed !== cursorSuppressedRef.current) {
        cursorSuppressedRef.current = nextSuppressed;
        setCursorSuppressed(nextSuppressed);
      }
      trackPointer(event.clientX, event.clientY);
    };

    const onPointerDown = (event: PointerEvent): void => {
      activePointerId = event.pointerId;
      onTouch = event.pointerType === "touch";
      if (onTouch) {
        root.classList.add("is-touch");
      } else {
        root.classList.remove("is-touch");
      }

      trackPointer(event.clientX, event.clientY);
      pressed = true;
      radiusBase = 130;
      pulseVelocity += 880;

      const target = event.target as HTMLElement | null;
      if (!onTouch && !target?.closest(".under-layer-mask")) {
        setCursorOpen((value) => !value);
        if (!reducedMotion) {
          setCursorBump(false);
          window.requestAnimationFrame(() => setCursorBump(true));
          window.setTimeout(() => setCursorBump(false), 260);
        }
      }
    };

    const onPointerUp = (): void => {
      activePointerId = null;
      pressed = false;
      radiusBase = 118;
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });

    let rafId = 0;
    let cssRafId = 0;
    let cleanupWebGL: (() => void) | null = null;
    let cancelled = false;
    let previous = performance.now();

    const startCssFallbackLoop = (): void => {
      const tick = (): void => {
        const now = performance.now();
        const dt = Math.max(0.001, Math.min(0.05, (now - previous) / 1000));
        previous = now;

        const stiffness = reducedMotion ? 180 : 130;
        const damping = reducedMotion ? 24 : 18;
        pointerVelocityUv.x += (pointerTargetUv.x - pointerCurrentUv.x) * stiffness * dt;
        pointerVelocityUv.y += (pointerTargetUv.y - pointerCurrentUv.y) * stiffness * dt;
        pointerVelocityUv.x *= Math.exp(-damping * dt);
        pointerVelocityUv.y *= Math.exp(-damping * dt);
        pointerCurrentUv.x += pointerVelocityUv.x * dt;
        pointerCurrentUv.y += pointerVelocityUv.y * dt;

        const radiusStiffness = reducedMotion ? 180 : 110;
        const radiusDamping = reducedMotion ? 26 : 16;
        pulseVelocity += (-pulse * 90 - pulseVelocity * 18) * dt;
        pulse += pulseVelocity * dt;
        const pulseAdd = reducedMotion ? 0 : Math.max(0, pulse);
        const targetRadius = radiusBase + pulseAdd;
        radiusVelocity += (targetRadius - radiusCurrent) * radiusStiffness * dt;
        radiusVelocity *= Math.exp(-radiusDamping * dt);
        radiusCurrent += radiusVelocity * dt;

        cursorVelocityPx.x += (pointerPixelTarget.x - pointerPixelCurrent.x) * 140 * dt;
        cursorVelocityPx.y += (pointerPixelTarget.y - pointerPixelCurrent.y) * 140 * dt;
        cursorVelocityPx.x *= Math.exp(-19 * dt);
        cursorVelocityPx.y *= Math.exp(-19 * dt);
        pointerPixelCurrent.x += cursorVelocityPx.x * dt;
        pointerPixelCurrent.y += cursorVelocityPx.y * dt;

        root.style.setProperty("--mx", `${(pointerCurrentUv.x * 100).toFixed(3)}%`);
        root.style.setProperty("--my", `${((1 - pointerCurrentUv.y) * 100).toFixed(3)}%`);
        root.style.setProperty("--cursor-x", `${pointerPixelCurrent.x.toFixed(2)}px`);
        root.style.setProperty("--cursor-y", `${pointerPixelCurrent.y.toFixed(2)}px`);
        root.style.setProperty("--reveal-radius", `${radiusCurrent.toFixed(2)}px`);
        root.style.setProperty("--reveal-soft", `${(reducedMotion ? 34 : pressed ? 56 : 46).toFixed(2)}px`);
        root.style.setProperty("--fallback-top-shift-x", `${((pointerCurrentUv.x - 0.5) * 8).toFixed(2)}px`);
        root.style.setProperty("--fallback-top-shift-y", `${((pointerCurrentUv.y - 0.5) * 6).toFixed(2)}px`);
        root.style.setProperty(
          "--fallback-under-shift-x",
          `${((-pointerCurrentUv.x + 0.5) * 10).toFixed(2)}px`
        );
        root.style.setProperty(
          "--fallback-under-shift-y",
          `${((-pointerCurrentUv.y + 0.5) * 8).toFixed(2)}px`
        );
        root.style.setProperty("--rim-intensity", "0");

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
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        host.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const topPlaceholder = createPlaceholderTexture(["#f4f7ff", "#dde6ff", "#bdcdf6"]);
        const underPlaceholder = createPlaceholderTexture(["#fff4df", "#ffd0b0", "#dfafd9"]);
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
          uRadius: { value: 118.0 },
          uFeather: { value: reducedMotion ? 30.0 : 46.0 },
          uTime: { value: 0.0 },
          uReducedMotion: { value: reducedMotion ? 1.0 : 0.0 }
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

            float fbm(vec2 p) {
              float value = 0.0;
              float amplitude = 0.5;
              mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
              for (int i = 0; i < 5; i++) {
                value += amplitude * noise(p);
                p = m * p * 0.62 + vec2(17.0, 11.0);
                amplitude *= 0.52;
              }
              return value;
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
              float angle = atan(fromCursor.y, fromCursor.x);

              float motion = 1.0 - uReducedMotion;
              float organic = fbm(vec2(cos(angle), sin(angle)) * 2.35 + uv * 2.65 + vec2(uTime * 0.12, -uTime * 0.09));
              float micro = sin(angle * 4.0 + uTime * 1.2) * 1.05 + sin(angle * 6.8 - uTime * 0.92) * 0.68;
              float radiusDistorted = uRadius + (organic - 0.5) * 14.0 * motion + micro * motion;

              float mask = 1.0 - smoothstep(radiusDistorted - uFeather, radiusDistorted + uFeather, distPx);

              vec2 topUv = clampUv(uv + uParallax * pxToUv);
              vec2 underUv = clampUv(uv - uParallax * pxToUv * 1.24);
              vec4 topColor = texture2D(uTop, topUv);
              vec4 underColor = texture2D(uUnder, underUv);
              vec4 composed = mix(topColor, underColor, mask);
              gl_FragColor = vec4(composed.rgb, 1.0);
            }
          `
        });

        const geometry = new THREE.PlaneGeometry(2, 2);
        scene.add(new THREE.Mesh(geometry, material));

        const onResize = (): void => {
          const width = window.innerWidth;
          const height = window.innerHeight;
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          renderer.setPixelRatio(dpr);
          renderer.setSize(width, height, false);
          uniforms.uResolution.value.set(width, height);
        };
        onResize();
        window.addEventListener("resize", onResize, { passive: true });

        const animate = (): void => {
          const now = performance.now();
          const dt = Math.max(0.001, Math.min(0.05, (now - previous) / 1000));
          previous = now;

          const stiffness = reducedMotion ? 180 : 130;
          const damping = reducedMotion ? 24 : 18;
          pointerVelocityUv.x += (pointerTargetUv.x - pointerCurrentUv.x) * stiffness * dt;
          pointerVelocityUv.y += (pointerTargetUv.y - pointerCurrentUv.y) * stiffness * dt;
          pointerVelocityUv.x *= Math.exp(-damping * dt);
          pointerVelocityUv.y *= Math.exp(-damping * dt);
          pointerCurrentUv.x += pointerVelocityUv.x * dt;
          pointerCurrentUv.y += pointerVelocityUv.y * dt;

          pulseVelocity += (-pulse * 90 - pulseVelocity * 18) * dt;
          pulse += pulseVelocity * dt;
          const pulseAdd = reducedMotion ? 0 : Math.max(0, pulse);
          const targetRadius = radiusBase + pulseAdd;
          radiusVelocity += (targetRadius - radiusCurrent) * (reducedMotion ? 180 : 110) * dt;
          radiusVelocity *= Math.exp(-(reducedMotion ? 26 : 16) * dt);
          radiusCurrent += radiusVelocity * dt;

          cursorVelocityPx.x += (pointerPixelTarget.x - pointerPixelCurrent.x) * 140 * dt;
          cursorVelocityPx.y += (pointerPixelTarget.y - pointerPixelCurrent.y) * 140 * dt;
          cursorVelocityPx.x *= Math.exp(-19 * dt);
          cursorVelocityPx.y *= Math.exp(-19 * dt);
          pointerPixelCurrent.x += cursorVelocityPx.x * dt;
          pointerPixelCurrent.y += cursorVelocityPx.y * dt;

          uniforms.uCursor.value.set(pointerCurrentUv.x, pointerCurrentUv.y);
          uniforms.uRadius.value = radiusCurrent;
          uniforms.uParallax.value.set((pointerCurrentUv.x - 0.5) * 17, (pointerCurrentUv.y - 0.5) * 13);
          uniforms.uTime.value += reducedMotion ? 0 : dt;
          uniforms.uFeather.value = reducedMotion ? 32 : pressed ? 56 : 46;
          uniforms.uReducedMotion.value = reducedMotion ? 1 : 0;

          root.style.setProperty("--mx", `${(pointerCurrentUv.x * 100).toFixed(3)}%`);
          root.style.setProperty("--my", `${((1 - pointerCurrentUv.y) * 100).toFixed(3)}%`);
          root.style.setProperty("--cursor-x", `${pointerPixelCurrent.x.toFixed(2)}px`);
          root.style.setProperty("--cursor-y", `${pointerPixelCurrent.y.toFixed(2)}px`);
          root.style.setProperty("--reveal-radius", `${radiusCurrent.toFixed(2)}px`);
          root.style.setProperty("--reveal-soft", `${(reducedMotion ? 34 : pressed ? 56 : 46).toFixed(2)}px`);
          root.style.setProperty("--fallback-top-shift-x", `${((pointerCurrentUv.x - 0.5) * 8).toFixed(2)}px`);
          root.style.setProperty("--fallback-top-shift-y", `${((pointerCurrentUv.y - 0.5) * 6).toFixed(2)}px`);
          root.style.setProperty(
            "--fallback-under-shift-x",
            `${((-pointerCurrentUv.x + 0.5) * 10).toFixed(2)}px`
          );
          root.style.setProperty(
            "--fallback-under-shift-y",
            `${((-pointerCurrentUv.y + 0.5) * 8).toFixed(2)}px`
          );
          root.style.setProperty("--rim-intensity", "0");
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
      window.cancelAnimationFrame(cssRafId);
      if (cleanupWebGL) {
        cleanupWebGL();
      }
    };
  }, []);

  const topBackground = topLoaded
    ? `url("${TOP_IMAGE}")`
    : "linear-gradient(135deg, #f2f6ff 0%, #dee8ff 48%, #c4d1f5 100%)";
  const underBackground = underLoaded
    ? `url("${UNDER_IMAGE}")`
    : "linear-gradient(135deg, #fff3df 0%, #ffd1b2 50%, #dfb4dd 100%)";

  const cursorImage = cursorOpen ? cursorOpenSrc || makeCursorSvgData(true) : cursorClosedSrc || makeCursorSvgData(false);

  return (
    <section
      ref={rootRef}
      className={`reveal-root${useCssFallback ? " is-css-fallback" : ""}${entered ? " is-entered" : ""}${
        cursorSuppressed ? " is-cursor-suppressed" : ""
      }`}
      style={
        {
          "--top-bg": topBackground,
          "--under-bg": underBackground
        } as CSSProperties
      }
    >
      <div ref={canvasHostRef} className="canvas-host" />

      {useCssFallback ? (
        <div className="css-fallback-layer" aria-hidden>
          <div className="css-fallback-under" />
          <div className="css-fallback-top" />
          <div className="css-fallback-rim" />
        </div>
      ) : null}

      <div className="vignette-overlay" aria-hidden />
      <div className="grain-overlay" aria-hidden />

      <div className="under-layer-mask">
        <form className="address-bar" onSubmit={handleAddressSubmit} noValidate>
          <div className="address-meta">
            <span className="address-label">Monad address</span>
            <span className="address-helper">Paste and press enter</span>
          </div>
          <label htmlFor="monad-address" className="sr-only">
            Monad EVM address
          </label>
          <input
            id="monad-address"
            className="address-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x... Monad address"
            value={address}
            onFocus={() => {
              cursorSuppressedRef.current = true;
              setCursorSuppressed(true);
            }}
            onBlur={() => {
              cursorSuppressedRef.current = false;
              setCursorSuppressed(false);
            }}
            onChange={(event) => {
              setAddress(event.target.value);
              if (status !== "idle") {
                setStatus("idle");
                setStatusMessage("");
              }
            }}
            aria-invalid={status === "error"}
          />
          <button
            type="submit"
            className="address-submit"
            aria-label="Submit Monad address"
            disabled={status === "loading"}
          >
            {status === "loading" ? <span className="spinner" aria-hidden /> : <span aria-hidden>↗</span>}
          </button>
          <div className={`address-status is-${status}`} aria-live="polite">
            {statusMessage}
          </div>
        </form>
      </div>

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

      <div className={`custom-cursor${cursorBump ? " is-bump" : ""}`} style={{ backgroundImage: `url("${cursorImage}")` }} />
    </section>
  );
}
