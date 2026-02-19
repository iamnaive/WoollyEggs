import { CSSProperties, FormEvent, useEffect, useRef, useState } from "react";
import * as THREE from "three";

const TOP_IMAGE = "/reveal/top.avif";
const UNDER_IMAGE = "/reveal/under.avif";
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

type CaptureStatus = "idle" | "loading" | "saved" | "error";

function loadTexture(loader: THREE.TextureLoader, path: string): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      path,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        resolve(texture);
      },
      undefined,
      () => resolve(null)
    );
  });
}

export default function MouseReveal(): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  const [useCssFallback, setUseCssFallback] = useState(false);
  const [topLoaded, setTopLoaded] = useState(true);
  const [underLoaded, setUnderLoaded] = useState(true);
  const [entered, setEntered] = useState(false);

  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const revealPulseRef = useRef<{ running: boolean; startedAtMs: number; x: number; y: number; progress: number }>({
    running: false,
    startedAtMs: 0,
    x: 0.5,
    y: 0.5,
    progress: 0
  });

  const startVerifiedRevealFromButton = (): void => {
    const root = rootRef.current;
    const button = submitButtonRef.current;
    if (!root || !button) return;
    const rootRect = root.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const cx = (buttonRect.left + buttonRect.width * 0.5 - rootRect.left) / rootRect.width;
    const cy = (buttonRect.top + buttonRect.height * 0.5 - rootRect.top) / rootRect.height;
    revealPulseRef.current = {
      running: true,
      startedAtMs: performance.now(),
      x: Math.min(1, Math.max(0, cx)),
      y: Math.min(1, Math.max(0, 1 - cy)),
      progress: 0
    };
  };

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 30);
    return () => window.clearTimeout(t);
  }, []);

  const handleAddressSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmed = address.trim();
    if (!ADDRESS_REGEX.test(trimmed)) {
      setStatus("error");
      setStatusMessage("Invalid address");
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
      const data = (await response.json()) as { ok?: boolean; verified?: boolean; inserted?: boolean; error?: string };

      if (!response.ok || !data.ok) {
        setStatus("error");
        setStatusMessage("error");
        return;
      }

      if (data.verified) {
        setStatus("saved");
        setStatusMessage("Your address is verified");
        startVerifiedRevealFromButton();
        try {
          const key = "we_verified_addresses";
          const existing = JSON.parse(localStorage.getItem(key) || "[]") as string[];
          const normalized = trimmed.toLowerCase();
          if (!existing.includes(normalized)) {
            existing.push(normalized);
            localStorage.setItem(key, JSON.stringify(existing));
          }
        } catch {
          // ignore localStorage issues
        }
      } else {
        setStatus("error");
        setStatusMessage("error");
      }
    } catch {
      setStatus("error");
      setStatusMessage("error");
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

    reducedMotionQuery.addEventListener?.("change", onReducedMotionChange);

    const supportsWebgl = (() => {
      try {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("webgl", { antialias: true }) || canvas.getContext("experimental-webgl");
        return Boolean(context);
      } catch {
        return false;
      }
    })();

    if (!supportsWebgl) {
      setUseCssFallback(true);
      return;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setClearColor(0xffffff, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // IMPORTANT: disable filmic tone mapping to avoid contrast/effect changes on images
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;

    const initialTallMobile = window.innerWidth <= 520 && window.innerHeight > window.innerWidth;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, initialTallMobile ? 1.5 : 2));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const loader = new THREE.TextureLoader();
    let destroyed = false;
    let topTexture: THREE.Texture | null = null;
    let underTexture: THREE.Texture | null = null;
    let material: THREE.ShaderMaterial | null = null;
    let geometry: THREE.PlaneGeometry | null = null;

    Promise.all([loadTexture(loader, TOP_IMAGE), loadTexture(loader, UNDER_IMAGE)]).then(([top, under]) => {
      if (destroyed) {
        top?.dispose();
        under?.dispose();
        return;
      }

      topTexture = top;
      underTexture = under;
      setTopLoaded(Boolean(top));
      setUnderLoaded(Boolean(under));

      // Use only reveal/top.avif and reveal/under.avif; if any is missing, use CSS fallback with same files.
      if (!top || !under) {
        setUseCssFallback(true);
        return;
      }

      const uniforms = {
        uTop: { value: top },
        uUnder: { value: under },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uCursor: { value: new THREE.Vector2(0.5, 0.5) },
        uParallax: { value: new THREE.Vector2(0.0, 0.0) },
        uRadius: { value: 0.18 },
        uFeather: { value: 0.08 },
        uRevealCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uRevealProgress: { value: 0.0 },
        uRevealActive: { value: 0.0 },
        uTime: { value: 0.0 },
        uReducedMotion: { value: reducedMotion ? 1.0 : 0.0 }
      };

      material = new THREE.ShaderMaterial({
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
            uniform vec2 uRevealCenter;
            uniform float uRevealProgress;
            uniform float uRevealActive;
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
              return clamp(uv, vec2(0.001), vec2(0.999));
            }

            void main() {
              vec2 uv = vUv;

              vec2 cursor = uCursor;
              float aspect = uResolution.x / max(uResolution.y, 1.0);

              vec2 centered = (uv - cursor);
              centered.x *= aspect;
              float dist = length(centered);

              float feather = max(uFeather, 0.0001);
              float mask = smoothstep(uRadius, uRadius + feather, dist);

              float time = uTime * (1.0 - uReducedMotion);
              float wobble = fbm(uv * 3.0 + vec2(time * 0.15, time * 0.09));
              float wobble2 = fbm(uv * 7.0 - vec2(time * 0.07, time * 0.11));
              float ripple = mix(wobble, wobble2, 0.4);
              mask += (ripple - 0.5) * 0.02 * (1.0 - uReducedMotion);
              mask = clamp(mask, 0.0, 1.0);

              vec2 pxToUv = vec2(1.0 / max(uResolution.x, 1.0), 1.0 / max(uResolution.y, 1.0));
              vec2 topUv = clampUv(uv + uParallax * pxToUv);
              vec2 underUv = clampUv(uv - uParallax * pxToUv * 1.24);
              vec4 topColor = texture2D(uTop, topUv);
              vec4 underColor = texture2D(uUnder, underUv);
              vec4 composed = mix(topColor, underColor, mask);
              if (uRevealActive > 0.5) {
                vec2 revealCentered = (uv - uRevealCenter);
                revealCentered.x *= aspect;
                float revealDist = length(revealCentered);
                float revealMaxRadius = mix(0.0, 2.2, clamp(uRevealProgress, 0.0, 1.0));
                float revealSoft = 0.08;
                float revealWipe = 1.0 - smoothstep(
                  max(revealMaxRadius - revealSoft, 0.0),
                  revealMaxRadius + revealSoft,
                  revealDist
                );
                composed = mix(composed, topColor, revealWipe);
              }
              gl_FragColor = vec4(composed.rgb, 1.0);
            }
          `
      });

      geometry = new THREE.PlaneGeometry(2, 2);
      scene.add(new THREE.Mesh(geometry, material));

      const animate = (): void => {
        if (destroyed || !material) return;

        const delta = clock.getDelta();
        const elapsed = clock.getElapsedTime();

        const lerpAmt = reducedMotion ? 1.0 : 1.0 - Math.pow(0.0006, delta);
        pointer.x += (target.x - pointer.x) * lerpAmt;
        pointer.y += (target.y - pointer.y) * lerpAmt;
        parallax.x += (parallaxTarget.x - parallax.x) * lerpAmt;
        parallax.y += (parallaxTarget.y - parallax.y) * lerpAmt;

        material.uniforms.uCursor.value.set(pointer.x, 1.0 - pointer.y);
        material.uniforms.uParallax.value.set(parallax.x, -parallax.y);
        material.uniforms.uTime.value = elapsed;
        material.uniforms.uReducedMotion.value = reducedMotion ? 1.0 : 0.0;
        const reveal = revealPulseRef.current;
        if (reveal.running) {
          const durationMs = 3600;
          const linear = Math.min(1, Math.max(0, (performance.now() - reveal.startedAtMs) / durationMs));
          const eased = 1 - Math.pow(1 - linear, 3);
          reveal.progress = eased;
          if (linear >= 1) {
            reveal.running = false;
          }
        }
        material.uniforms.uRevealCenter.value.set(reveal.x, reveal.y);
        material.uniforms.uRevealProgress.value = reveal.progress;
        material.uniforms.uRevealActive.value = reveal.progress > 0 ? 1.0 : 0.0;

        renderer.render(scene, new THREE.Camera());
        requestAnimationFrame(animate);
      };
      animate();
    });

    const onResize = (): void => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isTallMobile = width <= 520 && height > width;
      const dpr = Math.min(window.devicePixelRatio || 1, isTallMobile ? 1.5 : 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      if (material) {
        material.uniforms.uResolution.value.set(width, height);
      }
    };
    onResize();
    window.addEventListener("resize", onResize, { passive: true });

    const pointer = { x: 0.5, y: 0.5 };
    const target = { x: 0.5, y: 0.5 };
    const parallax = { x: 0, y: 0 };
    const parallaxTarget = { x: 0, y: 0 };

    const updateCssVars = (x: number, y: number): void => {
      root.style.setProperty("--mx", `${(x * 100).toFixed(3)}%`);
      root.style.setProperty("--my", `${(y * 100).toFixed(3)}%`);
    };

    updateCssVars(pointer.x, pointer.y);

    const onPointerMove = (event: PointerEvent): void => {
      const rect = root.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      target.x = Math.min(1, Math.max(0, x));
      target.y = Math.min(1, Math.max(0, y));
      updateCssVars(target.x, target.y);
      parallaxTarget.x = (target.x - 0.5) * 26;
      parallaxTarget.y = (target.y - 0.5) * 18;
    };

    root.addEventListener("pointermove", onPointerMove, { passive: true });

    const clock = new THREE.Clock();

    return () => {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      root.removeEventListener("pointermove", onPointerMove);
      reducedMotionQuery.removeEventListener?.("change", onReducedMotionChange);

      material?.dispose();
      geometry?.dispose();
      topTexture?.dispose();
      underTexture?.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, []);

  const rootClass = ["reveal-root", entered ? "is-entered" : "", useCssFallback ? "is-fallback" : ""]
    .join(" ")
    .trim();

  const statusClass = [
    "address-status",
    status === "loading" ? "is-loading" : "",
    status === "saved" ? "is-saved" : "",
    status === "error" ? "is-error" : ""
  ]
    .join(" ")
    .trim();

  const formStyle: CSSProperties = {
    opacity: underLoaded ? 1 : 0.9
  };

  return (
    <div ref={rootRef} className={rootClass} aria-label="Mouse reveal scene">
      <div className="canvas-host" ref={canvasHostRef} aria-hidden="true" />
      <div className="css-fallback-layer" aria-hidden={!useCssFallback}>
        <div className="css-fallback-under" />
        <div className="css-fallback-top" />
      </div>

      <div className="under-layer-mask">
        <form className="address-bar" onSubmit={handleAddressSubmit} style={formStyle} aria-label="Monad address form">
          <div className="address-meta">
            <span className="address-label">Monad address</span>
            <span className="address-helper">Paste your wallet and confirm</span>
          </div>
          <input
            className="address-input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x..."
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            aria-label="Monad address input"
          />
          <button
            ref={submitButtonRef}
            className={`address-submit${status === "saved" ? " is-verified" : ""}`}
            type="submit"
            disabled={status === "loading"}
            aria-label="Confirm address"
          >
            {status === "loading" ? <span className="spinner" aria-hidden="true" /> : "✓"}
          </button>
          <div className={statusClass} aria-live="polite">
            {statusMessage}
          </div>
        </form>
      </div>

      <span className="hint-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M12 5c3.314 0 6 2.686 6 6 0 2.123-1.103 3.99-2.76 5.048-.71.456-1.24 1.225-1.24 2.07V19H10v-.832c0-.847-.53-1.616-1.24-2.072C7.103 14.99 6 13.123 6 11c0-3.314 2.686-6 6-6Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 21h4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <span className="sr-only">
        {useCssFallback ? "Fallback mode active." : ""}
        {!topLoaded || !underLoaded ? "Some images failed to load." : ""}
      </span>
    </div>
  );
}
