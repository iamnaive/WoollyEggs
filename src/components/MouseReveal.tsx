import { FormEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";

const TOP_IMAGE = "/reveal/top.jpg";
const UNDER_IMAGE = "/reveal/under.jpg";
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

function expSmoothing(speed: number, dt: number): number {
  return 1 - Math.exp(-speed * dt);
}

export default function MouseReveal(): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);

  const [useCssFallback, setUseCssFallback] = useState(false);
  const [topLoaded, setTopLoaded] = useState(true);
  const [underLoaded, setUnderLoaded] = useState(true);

  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const cssTargetRef = useRef<Vec2>({ x: 0.5, y: 0.5 });
  const cssCurrentRef = useRef<Vec2>({ x: 0.5, y: 0.5 });
  const cssRadiusTargetRef = useRef(118);
  const cssRadiusCurrentRef = useRef(118);

  const activePointerIdRef = useRef<number | null>(null);
  const pointerTargetPxRef = useRef<Vec2>({ x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 });
  const prevPointerPxRef = useRef<Vec2>({ x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 });
  const pointerVelocityRef = useRef(0);
  const isTouchInputRef = useRef(false);
  const lastTickRef = useRef(0);

  const handleAddressSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmed = address.trim();
    if (!ADDRESS_REGEX.test(trimmed)) {
      setStatus("error");
      setStatusMessage("Invalid Monad address");
      return;
    }

    try {
      setStatus("loading");
      setStatusMessage("");

      const response = await fetch("/api/monad-address", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ address: trimmed })
      });

      const data = (await response.json()) as {
        ok?: boolean;
        inserted?: boolean;
        error?: string;
      };

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to save address");
      }

      setStatus("saved");
      setStatusMessage(data.inserted ? "Saved" : "Already saved");
    } catch (error) {
      setStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Request failed");
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
    let radiusTarget = 118;
    let radiusCurrent = 118;
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

    const updateVelocity = (clientX: number, clientY: number): void => {
      const now = performance.now();
      const dt = Math.max(0.008, Math.min(0.1, (now - (lastTickRef.current || now)) / 1000));
      const prev = prevPointerPxRef.current;
      const dx = clientX - prev.x;
      const dy = clientY - prev.y;
      const speed = Math.sqrt(dx * dx + dy * dy) / dt;
      pointerVelocityRef.current = pointerVelocityRef.current * 0.84 + speed * 0.16;
      prevPointerPxRef.current = { x: clientX, y: clientY };
      pointerTargetPxRef.current = { x: clientX, y: clientY };
    };

    const setTargetFromClient = (clientX: number, clientY: number): void => {
      const uv = toLocalUv(clientX, clientY);
      pointerTargetUv.x = uv.x;
      pointerTargetUv.y = uv.y;
      cssTargetRef.current = uv;
      updateVelocity(clientX, clientY);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (activePointerIdRef.current !== null && event.pointerId !== activePointerIdRef.current) {
        return;
      }
      setTargetFromClient(event.clientX, event.clientY);
    };

    const onPointerDown = (event: PointerEvent): void => {
      activePointerIdRef.current = event.pointerId;
      isTouchInputRef.current = event.pointerType === "touch";
      if (isTouchInputRef.current) {
        root.classList.add("is-touch");
      } else {
        root.classList.remove("is-touch");
      }

      isPressed = true;
      radiusTarget = 178;
      cssRadiusTargetRef.current = 178;
      setTargetFromClient(event.clientX, event.clientY);
    };

    const onPointerUp = (): void => {
      activePointerIdRef.current = null;
      isPressed = false;
      radiusTarget = 118;
      cssRadiusTargetRef.current = 118;
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });

    let rafId = 0;
    let cssRafId = 0;
    let cleanupWebGL: (() => void) | null = null;
    let cancelled = false;

    const startCssFallbackLoop = (): void => {
      const tick = (): void => {
        const now = performance.now();
        const dt = Math.max(0.001, Math.min(0.05, (now - (lastTickRef.current || now)) / 1000));
        lastTickRef.current = now;

        const pointerSmooth = expSmoothing(reducedMotion ? 30 : 14, dt);
        const radiusSmooth = expSmoothing(reducedMotion ? 26 : 10, dt);
        cssCurrentRef.current.x += (cssTargetRef.current.x - cssCurrentRef.current.x) * pointerSmooth;
        cssCurrentRef.current.y += (cssTargetRef.current.y - cssCurrentRef.current.y) * pointerSmooth;
        cssRadiusCurrentRef.current +=
          (cssRadiusTargetRef.current - cssRadiusCurrentRef.current) * radiusSmooth;

        root.style.setProperty("--mx", `${(cssCurrentRef.current.x * 100).toFixed(3)}%`);
        root.style.setProperty("--my", `${((1 - cssCurrentRef.current.y) * 100).toFixed(3)}%`);
        root.style.setProperty("--reveal-radius", `${cssRadiusCurrentRef.current.toFixed(2)}px`);
        root.style.setProperty("--reveal-soft", `${(reducedMotion ? 32 : isPressed ? 58 : 46).toFixed(2)}px`);

        const topShiftX = (cssCurrentRef.current.x - 0.5) * 10;
        const topShiftY = (cssCurrentRef.current.y - 0.5) * 8;
        root.style.setProperty("--fallback-top-shift-x", `${topShiftX.toFixed(2)}px`);
        root.style.setProperty("--fallback-top-shift-y", `${topShiftY.toFixed(2)}px`);
        root.style.setProperty("--fallback-under-shift-x", `${(-topShiftX * 1.25).toFixed(2)}px`);
        root.style.setProperty("--fallback-under-shift-y", `${(-topShiftY * 1.25).toFixed(2)}px`);

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
          uVelocity: { value: 0.0 },
          uReducedMotion: { value: reducedMotion ? 1.0 : 0.0 },
          uAberrationStrength: { value: reducedMotion ? 0.0 : 2.0 },
          uGlowStrength: { value: reducedMotion ? 0.026 : 0.06 }
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
            uniform float uVelocity;
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

            vec3 tinyBlur(sampler2D tex, vec2 uv, vec2 px) {
              vec3 c0 = texture2D(tex, clampUv(uv + vec2(px.x, 0.0))).rgb;
              vec3 c1 = texture2D(tex, clampUv(uv - vec2(px.x, 0.0))).rgb;
              vec3 c2 = texture2D(tex, clampUv(uv + vec2(0.0, px.y))).rgb;
              vec3 c3 = texture2D(tex, clampUv(uv - vec2(0.0, px.y))).rgb;
              return (c0 + c1 + c2 + c3) * 0.25;
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
              float organic = fbm(vec2(cos(angle), sin(angle)) * 2.4 + uv * 2.7 + vec2(uTime * 0.12, -uTime * 0.09));
              float micro = sin(angle * 4.0 + uTime * 1.2) * 1.15 + sin(angle * 7.0 - uTime * 0.9) * 0.7;
              float ripple = sin(distPx * 0.077 - uTime * 9.5) * clamp(uVelocity * 0.0035, 0.0, 2.4);
              float radiusDistorted = uRadius + (organic - 0.5) * 15.0 * motion + micro * motion + ripple * motion;

              float mask = 1.0 - smoothstep(radiusDistorted - uFeather, radiusDistorted + uFeather, distPx);
              float edgeIn = smoothstep(radiusDistorted - uFeather * 0.95, radiusDistorted, distPx);
              float edgeOut = smoothstep(radiusDistorted, radiusDistorted + uFeather * 0.95, distPx);
              float edgeBand = clamp(edgeIn - edgeOut, 0.0, 1.0);
              float innerBand = smoothstep(radiusDistorted - uFeather * 1.55, radiusDistorted - uFeather * 0.45, distPx) * (1.0 - edgeBand);

              vec2 topUv = clampUv(uv + uParallax * pxToUv);
              vec2 underUv = clampUv(uv - uParallax * pxToUv * 1.24);

              vec2 dir = normalize(fromCursor + vec2(0.0001));
              float refr = innerBand * (0.75 + edgeBand * 0.95) * motion * 3.0;
              vec2 refrOffset = dir * refr * pxToUv;
              vec2 topLensUv = clampUv(topUv + refrOffset * 0.32);
              vec2 underLensUv = clampUv(underUv + refrOffset);

              vec4 topColor = texture2D(uTop, topLensUv);
              vec4 underColor = texture2D(uUnder, underLensUv);
              vec4 composed = mix(topColor, underColor, mask);

              vec3 topEdgeBlur = tinyBlur(uTop, topLensUv, pxToUv * 1.5);
              vec3 underEdgeBlur = tinyBlur(uUnder, underLensUv, pxToUv * 1.5);
              vec3 edgeBlur = mix(topEdgeBlur, underEdgeBlur, mask);
              composed.rgb = mix(composed.rgb, edgeBlur, edgeBand * 0.18);

              float aberr = uAberrationStrength * edgeBand * motion;
              vec3 split;
              split.r = texture2D(uUnder, clampUv(underLensUv + dir * aberr * pxToUv)).r;
              split.g = texture2D(uUnder, underLensUv).g;
              split.b = texture2D(uUnder, clampUv(underLensUv - dir * aberr * pxToUv)).b;
              composed.rgb = mix(composed.rgb, split, edgeBand * 0.34 * motion);

              float velGlow = clamp(uVelocity * 0.0022, 0.0, 1.2);
              float glow = edgeBand * (uGlowStrength + velGlow * 0.035) * (1.0 - uReducedMotion * 0.7);
              composed.rgb += vec3(0.9, 0.95, 1.0) * glow;

              float depthVignette = smoothstep(0.28, 0.95, length(uv - 0.5));
              composed.rgb *= 1.0 - depthVignette * 0.11;

              gl_FragColor = vec4(composed.rgb, 1.0);
            }
          `
        });

        const geometry = new THREE.PlaneGeometry(2, 2);
        scene.add(new THREE.Mesh(geometry, material));

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
          const now = performance.now();
          const dt = Math.max(0.001, Math.min(0.05, (now - (lastTickRef.current || now)) / 1000));
          lastTickRef.current = now;

          const pointerSmooth = expSmoothing(reducedMotion ? 34 : 14.5, dt);
          const radiusSmooth = expSmoothing(reducedMotion ? 28 : 10, dt);

          pointerCurrentUv.x += (pointerTargetUv.x - pointerCurrentUv.x) * pointerSmooth;
          pointerCurrentUv.y += (pointerTargetUv.y - pointerCurrentUv.y) * pointerSmooth;
          radiusCurrent += (radiusTarget - radiusCurrent) * radiusSmooth;

          const parallaxX = (pointerCurrentUv.x - 0.5) * 18;
          const parallaxY = (pointerCurrentUv.y - 0.5) * 14;
          const velocity = Math.min(pointerVelocityRef.current, 1600);

          uniforms.uCursor.value.set(pointerCurrentUv.x, pointerCurrentUv.y);
          uniforms.uRadius.value = radiusCurrent;
          uniforms.uParallax.value.set(parallaxX, parallaxY);
          uniforms.uVelocity.value += (velocity - uniforms.uVelocity.value) * expSmoothing(11, dt);
          uniforms.uTime.value += reducedMotion ? 0 : dt;
          uniforms.uFeather.value = reducedMotion ? 30 : isPressed ? 57 : 46;
          uniforms.uReducedMotion.value = reducedMotion ? 1 : 0;
          uniforms.uAberrationStrength.value = reducedMotion ? 0 : 2.0;
          uniforms.uGlowStrength.value = reducedMotion ? 0.026 : 0.06;

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

      <form className="address-bar" onSubmit={handleAddressSubmit} noValidate>
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
