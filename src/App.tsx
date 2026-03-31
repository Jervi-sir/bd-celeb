import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Group } from "three";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Candle } from "./models/candle";
import { Cake } from "./models/cake";
import { Table } from "./models/table";
import { PictureFrame } from "./models/pictureFrame";
import { Katana } from "./models/katana";
import { Fireworks } from "./components/Fireworks";
import { BirthdayCard } from "./components/BirthdayCard";

import "./App.css";

const CURRENT_TIME = 3;
const TYPED_CHAR_DELAY = 20;
const POST_TYPING_SCENE_DELAY = 500;
const CURSOR_BLINK_INTERVAL = 480;
const AudioPath = "/audio/the-jones-girls-nights-over-egypt.mp3";

const PRELOAD_ASSETS = [
  "/table.glb",
  "/picture_frame.glb",
  "/cake.glb",
  "/red_cyber_katana.glb",
  "/candle.glb",
  "/frame3.gif",
  "/frame2.jpeg",
  "/frame1.jpeg",
  "/letter.jpg",
  "/shanghai_bund_4k_1_11zon.jpg",
  AudioPath,
] as const;

type DownloadProgress = {
  loaded: number;
  total: number;
};

type PreloadState = {
  loaded: number;
  total: number;
  isComplete: boolean;
  error: string | null;
};


const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1
  );
  const scaled = value / 1024 ** exponent;
  const digits = scaled >= 100 || exponent === 0 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${units[exponent]}`;
};

const preloadAsset = async (
  assetPath: string,
  onProgress: (progress: DownloadProgress) => void,
  signal: AbortSignal
) => {
  const response = await fetch(assetPath, { signal, cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to preload ${assetPath}`);
  }

  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number.parseInt(totalHeader, 10) : 0;
  const reader = response.body?.getReader();

  if (!reader) {
    const buffer = await response.arrayBuffer();
    const loaded = buffer.byteLength;
    onProgress({ loaded, total: total || loaded });
    return;
  }

  let loaded = 0;
  onProgress({ loaded: 0, total });

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    loaded += value.byteLength;
    onProgress({ loaded, total });
  }

  onProgress({ loaded, total: total || loaded });
};

type AnimatedSceneProps = {
  isPlaying: boolean;
  onBackgroundFadeChange?: (opacity: number) => void;
  onEnvironmentProgressChange?: (progress: number) => void;
  candleLit: boolean;
  onAnimationComplete?: () => void;
  cards: ReadonlyArray<BirthdayCardConfig>;
  activeCardId: string | null;
  onToggleCard: (id: string) => void;
};

const CAKE_START_Y = 10;
const CAKE_END_Y = 0;
const CAKE_DESCENT_DURATION = 3;

const TABLE_START_Z = 30;
const TABLE_END_Z = 0;
const TABLE_SLIDE_DURATION = 0.7;
const TABLE_SLIDE_START = CAKE_DESCENT_DURATION - TABLE_SLIDE_DURATION - 0.1;

const CANDLE_START_Y = 5;
const CANDLE_END_Y = 0;
const CANDLE_DROP_DURATION = 1.2;
const CANDLE_DROP_START =
  Math.max(CAKE_DESCENT_DURATION, TABLE_SLIDE_START + TABLE_SLIDE_DURATION) +
  1.0;

const totalAnimationTime = CANDLE_DROP_START + CANDLE_DROP_DURATION;

const ORBIT_TARGET = new Vector3(0, 1, 0);
const ORBIT_INITIAL_RADIUS = 3;
const ORBIT_INITIAL_HEIGHT = 1;
const ORBIT_INITIAL_AZIMUTH = Math.PI / 2;
const ORBIT_MIN_DISTANCE = 2;
const ORBIT_MAX_DISTANCE = 8;
const ORBIT_MIN_POLAR = Math.PI * 0;
const ORBIT_MAX_POLAR = Math.PI / 2;

const BACKGROUND_FADE_DURATION = 1;
const BACKGROUND_FADE_OFFSET = 0;
const BACKGROUND_FADE_END = Math.max(
  CANDLE_DROP_START - BACKGROUND_FADE_OFFSET,
  BACKGROUND_FADE_DURATION
);
const BACKGROUND_FADE_START = Math.max(
  BACKGROUND_FADE_END - BACKGROUND_FADE_DURATION,
  0
);

const TYPED_LINES = [
  "> bob right ! I prefer Rahma for now",
  "like bruh whats ur fav name",
  "...",
  "> today is your birthday",
  "...",
  "> had this prepared for you",
  "...",
  "٩(◕‿◕)۶ ٩(◕‿◕)۶ ٩(◕‿◕)۶"
];

type BirthdayCardConfig = {
  id: string;
  image: string;
  position: [number, number, number];
  rotation: [number, number, number];
};

const BIRTHDAY_CARDS: ReadonlyArray<BirthdayCardConfig> = [
  {
    id: "confetti",
    image: "/letter.jpg",
    position: [1, 0.081, -2],
    rotation: [-Math.PI / 2, 0, Math.PI / 3],
  }
];

function AnimatedScene({
  isPlaying,
  onBackgroundFadeChange,
  onEnvironmentProgressChange,
  candleLit,
  onAnimationComplete,
  cards,
  activeCardId,
  onToggleCard,
}: AnimatedSceneProps) {
  const cakeGroup = useRef<Group>(null);
  const tableGroup = useRef<Group>(null);
  const candleGroup = useRef<Group>(null);
  const animationStartRef = useRef<number | null>(null);
  const hasPrimedRef = useRef(false);
  const hasCompletedRef = useRef(false);
  const completionNotifiedRef = useRef(false);
  const backgroundOpacityRef = useRef(1);
  const environmentProgressRef = useRef(0);

  useEffect(() => {
    onBackgroundFadeChange?.(backgroundOpacityRef.current);
    onEnvironmentProgressChange?.(environmentProgressRef.current);
  }, [onBackgroundFadeChange, onEnvironmentProgressChange]);

  const emitBackgroundOpacity = (value: number) => {
    const clamped = clamp(value, 0, 1);
    if (Math.abs(clamped - backgroundOpacityRef.current) > 0.005) {
      backgroundOpacityRef.current = clamped;
      onBackgroundFadeChange?.(clamped);
    }
  };

  const emitEnvironmentProgress = (value: number) => {
    const clamped = clamp(value, 0, 1);
    if (Math.abs(clamped - environmentProgressRef.current) > 0.005) {
      environmentProgressRef.current = clamped;
      onEnvironmentProgressChange?.(clamped);
    }
  };

  useFrame(({ clock }) => {
    const cake = cakeGroup.current;
    const table = tableGroup.current;
    const candle = candleGroup.current;

    if (!cake || !table || !candle) {
      return;
    }

    if (!hasPrimedRef.current) {
      cake.position.set(0, CAKE_START_Y, 0);
      cake.rotation.set(0, 0, 0);
      table.position.set(0, 0, TABLE_START_Z);
      table.rotation.set(0, 0, 0);
      candle.position.set(0, CANDLE_START_Y, 0);
      candle.visible = false;
      hasPrimedRef.current = true;
    }

    if (!isPlaying) {
      emitBackgroundOpacity(1);
      emitEnvironmentProgress(0);
      animationStartRef.current = null;
      hasCompletedRef.current = false;
      completionNotifiedRef.current = false;
      return;
    }

    if (hasCompletedRef.current) {
      emitBackgroundOpacity(0);
      emitEnvironmentProgress(1);
      if (!completionNotifiedRef.current) {
        completionNotifiedRef.current = true;
        onAnimationComplete?.();
      }
      return;
    }

    if (animationStartRef.current === null) {
      animationStartRef.current = clock.elapsedTime;
    }

    const elapsed = clock.elapsedTime - animationStartRef.current;
    const clampedElapsed = clamp(elapsed, 0, totalAnimationTime);

    const cakeProgress = clamp(clampedElapsed / CAKE_DESCENT_DURATION, 0, 1);
    const cakeEase = easeOutCubic(cakeProgress);
    cake.position.y = lerp(CAKE_START_Y, CAKE_END_Y, cakeEase);
    cake.position.x = 0;
    cake.position.z = 0;
    cake.rotation.y = cakeEase * Math.PI * 2;
    cake.rotation.x = 0;
    cake.rotation.z = 0;

    let tableZ = TABLE_START_Z;
    if (clampedElapsed >= TABLE_SLIDE_START) {
      const tableProgress = clamp(
        (clampedElapsed - TABLE_SLIDE_START) / TABLE_SLIDE_DURATION,
        0,
        1
      );
      const tableEase = easeOutCubic(tableProgress);
      tableZ = lerp(TABLE_START_Z, TABLE_END_Z, tableEase);
    }
    table.position.set(0, 0, tableZ);
    table.rotation.set(0, 0, 0);

    if (clampedElapsed >= CANDLE_DROP_START) {
      if (!candle.visible) {
        candle.visible = true;
      }
      const candleProgress = clamp(
        (clampedElapsed - CANDLE_DROP_START) / CANDLE_DROP_DURATION,
        0,
        1
      );
      const candleEase = easeOutCubic(candleProgress);
      candle.position.y = lerp(CANDLE_START_Y, CANDLE_END_Y, candleEase);
    } else {
      candle.visible = false;
      candle.position.set(0, CANDLE_START_Y, 0);
    }

    if (clampedElapsed < BACKGROUND_FADE_START) {
      emitBackgroundOpacity(1);
      emitEnvironmentProgress(0);
    } else {
      const fadeProgress = clamp(
        (clampedElapsed - BACKGROUND_FADE_START) / BACKGROUND_FADE_DURATION,
        0,
        1
      );
      const eased = easeOutCubic(fadeProgress);
      const backgroundOpacity = 1 - eased;
      emitBackgroundOpacity(backgroundOpacity);
      emitEnvironmentProgress(1 - backgroundOpacity);
    }

    const animationDone = clampedElapsed >= totalAnimationTime;
    if (animationDone) {
      cake.position.set(0, CAKE_END_Y, 0);
      cake.rotation.set(0, 0, 0);
      table.position.set(0, 0, TABLE_END_Z);
      candle.position.set(0, CANDLE_END_Y, 0);
      candle.visible = true;
      emitBackgroundOpacity(0);
      emitEnvironmentProgress(1);
      hasCompletedRef.current = true;
      if (!completionNotifiedRef.current) {
        completionNotifiedRef.current = true;
        onAnimationComplete?.();
      }
    }
  });

  return (
    <>
      <group ref={tableGroup}>
        <Table />
        <Katana
          position={[0, 0.735, 3]}
          rotation={[0, 5.6, 0]}
          scale={0.5}
        />
        <PictureFrame
          image="/frame3.gif"
          position={[0, 0.735, -3]}
          rotation={[0, 4.0, 0]}
          scale={0.75}
        />
        <PictureFrame
          image="/frame2.jpeg"
          position={[-1.5, 0.735, 2.5]}
          rotation={[0, 5.4, 0]}
          scale={0.75}
        />
        <PictureFrame
          image="/frame1.jpeg"
          position={[-1.5, 0.735, -2.5]}
          rotation={[0, 4.2, 0]}
          scale={0.75}
        />
        {cards.map((card) => (
          <BirthdayCard
            key={card.id}
            id={card.id}
            image={card.image}
            tablePosition={card.position}
            tableRotation={card.rotation}
            isActive={activeCardId === card.id}
            onToggle={onToggleCard}
          />
        ))}
      </group>
      <group ref={cakeGroup}>
        <Cake />
      </group>
      <group ref={candleGroup}>
        <Candle isLit={candleLit} scale={0.25} position={[0, 1.1, 0]} />
      </group>
    </>
  );
}

function ConfiguredOrbitControls() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    const offset = new Vector3(
      Math.sin(ORBIT_INITIAL_AZIMUTH) * ORBIT_INITIAL_RADIUS,
      ORBIT_INITIAL_HEIGHT,
      Math.cos(ORBIT_INITIAL_AZIMUTH) * ORBIT_INITIAL_RADIUS
    );
    const cameraPosition = ORBIT_TARGET.clone().add(offset);
    camera.position.copy(cameraPosition);
    camera.lookAt(ORBIT_TARGET);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(ORBIT_TARGET);
      controls.update();
    }
  }, [camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.05}
      minDistance={ORBIT_MIN_DISTANCE}
      maxDistance={ORBIT_MAX_DISTANCE}
      minPolarAngle={ORBIT_MIN_POLAR}
      maxPolarAngle={ORBIT_MAX_POLAR}
    />
  );
}

type EnvironmentBackgroundControllerProps = {
  intensity: number;
};

function EnvironmentBackgroundController({
  intensity,
}: EnvironmentBackgroundControllerProps) {
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    if ("backgroundIntensity" in scene) {
      // Cast required because older typings might not include backgroundIntensity yet.
      (scene as typeof scene & { backgroundIntensity: number }).backgroundIntensity =
        intensity;
    }
  }, [scene, intensity]);

  return null;
}


export default function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [backgroundOpacity, setBackgroundOpacity] = useState(1);
  const [environmentProgress, setEnvironmentProgress] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [sceneStarted, setSceneStarted] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [hasAnimationCompleted, setHasAnimationCompleted] = useState(false);
  const [isCandleLit, setIsCandleLit] = useState(true);
  const [fireworksActive, setFireworksActive] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [preloadState, setPreloadState] = useState<PreloadState>({
    loaded: 0,
    total: 0,
    isComplete: false,
    error: null,
  });
  const backgroundAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const assetProgress = new Map<string, DownloadProgress>();

    const syncProgress = () => {
      let loaded = 0;
      let total = 0;
      assetProgress.forEach((progress) => {
        loaded += progress.loaded;
        total += progress.total;
      });

      setPreloadState((current) => ({
        ...current,
        loaded,
        total,
      }));
    };

    void Promise.all(
      PRELOAD_ASSETS.map((assetPath) =>
        preloadAsset(
          assetPath,
          (progress) => {
            assetProgress.set(assetPath, progress);
            syncProgress();
          },
          controller.signal
        )
      )
    )
      .then(() => {
        if (controller.signal.aborted) {
          return;
        }

        syncProgress();
        setPreloadState((current) => ({
          ...current,
          isComplete: true,
          error: null,
        }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to preload assets";
        setPreloadState((current) => ({
          ...current,
          error: message,
        }));
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const audio = new Audio(AudioPath);
    audio.loop = true;
    audio.preload = "none";
    audio.volume = volume;
    backgroundAudioRef.current = audio;
    return () => {
      audio.pause();
      backgroundAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (backgroundAudioRef.current) {
      backgroundAudioRef.current.volume = volume;
    }
  }, [volume]);

  const playBackgroundMusic = useCallback(() => {
    const audio = backgroundAudioRef.current;
    if (!audio) return;
    audio.currentTime = CURRENT_TIME;
    void audio.play().catch(() => { });
    setIsMusicPlaying(true);
  }, []);

  const toggleMusic = useCallback(() => {
    const audio = backgroundAudioRef.current;
    if (!audio) return;

    if (audio.paused) {
      void audio.play().catch(() => { });
      setIsMusicPlaying(true);
    } else {
      audio.pause();
      setIsMusicPlaying(false);
    }
  }, []);

  const handleBlowOut = useCallback(() => {
    if (hasAnimationCompleted && isCandleLit) {
      setIsCandleLit(false);
      setFireworksActive(true);
    }
  }, [hasAnimationCompleted, isCandleLit]);

  const typingComplete = currentLineIndex >= TYPED_LINES.length;
  const typedLines = useMemo(() => {
    if (TYPED_LINES.length === 0) {
      return [""];
    }

    return TYPED_LINES.map((line, index) => {
      if (typingComplete || index < currentLineIndex) {
        return line;
      }
      if (index === currentLineIndex) {
        return line.slice(0, Math.min(currentCharIndex, line.length));
      }
      return "";
    });
  }, [currentCharIndex, currentLineIndex, typingComplete]);

  const cursorLineIndex = typingComplete
    ? Math.max(typedLines.length - 1, 0)
    : currentLineIndex;
  const cursorTargetIndex = Math.max(
    Math.min(cursorLineIndex, typedLines.length - 1),
    0
  );

  useEffect(() => {
    if (!hasStarted) {
      setCurrentLineIndex(0);
      setCurrentCharIndex(0);
      setSceneStarted(false);
      setIsCandleLit(true);
      setFireworksActive(false);
      setHasAnimationCompleted(false);
      return;
    }

    if (typingComplete) {
      if (!sceneStarted) {
        const handle = window.setTimeout(() => {
          setSceneStarted(true);
        }, POST_TYPING_SCENE_DELAY);
        return () => window.clearTimeout(handle);
      }
      return;
    }

    const currentLine = TYPED_LINES[currentLineIndex] ?? "";
    const handle = window.setTimeout(() => {
      if (currentCharIndex < currentLine.length) {
        setCurrentCharIndex((prev) => prev + 1);
        return;
      }

      let nextLineIndex = currentLineIndex + 1;
      while (
        nextLineIndex < TYPED_LINES.length &&
        TYPED_LINES[nextLineIndex].length === 0
      ) {
        nextLineIndex += 1;
      }

      setCurrentLineIndex(nextLineIndex);
      setCurrentCharIndex(0);
    }, TYPED_CHAR_DELAY);

    return () => window.clearTimeout(handle);
  }, [
    hasStarted,
    currentCharIndex,
    currentLineIndex,
    typingComplete,
    sceneStarted,
  ]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, CURSOR_BLINK_INTERVAL);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      if (!hasStarted) {
        playBackgroundMusic();
        setHasStarted(true);
        return;
      }
      if (hasAnimationCompleted && isCandleLit) {
        handleBlowOut();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasStarted, hasAnimationCompleted, isCandleLit, playBackgroundMusic, handleBlowOut]);

  const handleCardToggle = useCallback((id: string) => {
    setActiveCardId((current) => (current === id ? null : id));
  }, []);

  const isScenePlaying = hasStarted && sceneStarted;
  const totalMB = 20;
  const totalBytes = totalMB * 1024 * 1024;
  const progressRatio = preloadState.isComplete
    ? 1
    : clamp(preloadState.loaded / totalBytes, 0, 1);
  const bytesRemaining = Math.max(totalBytes - preloadState.loaded, 0);
  const isLoadingAssets = !preloadState.isComplete && !preloadState.error;

  return (
    <div className="App">
      <div
        className="background-overlay"
        style={{ opacity: backgroundOpacity }}
      >
        <div className="typed-text">
          {typedLines.map((line, index) => {
            const showCursor =
              cursorVisible &&
              index === cursorTargetIndex &&
              (!typingComplete || !sceneStarted);
            return (
              <span className="typed-line" key={`typed-line-${index}`}>
                {line || "\u00a0"}
                {showCursor && (
                  <span aria-hidden="true" className="typed-cursor">
                    _
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
      {hasAnimationCompleted && isCandleLit && (
        <div className="hint-overlay">
          {hasAnimationCompleted && isCandleLit && (
            <button className="blow-out-button" onClick={handleBlowOut}>
              <WindIcon />
              <span>Blow out the candle</span>
            </button>
          )}
        </div>
      )}

      <div className="controls-overlay">
        {isLoadingAssets ? (
          <div className="loading-panel" role="status" aria-live="polite">
            <div className="loading-panel__eyebrow">Sorry but you gotta wait for</div>
            <div className="loading-panel__title">Downloading scene assets</div>
            <div className="loading-panel__bar" aria-hidden="true">
              <span
                className="loading-panel__bar-fill"
                style={{ transform: `scaleX(${progressRatio})` }}
              />
            </div>
            <div className="loading-panel__stats">
              <span>{formatBytes(preloadState.loaded)} downloaded</span>
              <span>{formatBytes(totalBytes)} total</span>
              <span>{formatBytes(bytesRemaining)} left</span>
            </div>
            <div className="loading-panel__percent">
              {Math.round(progressRatio * 100)}%
            </div>
          </div>
        ) : preloadState.error ? (
          <div className="loading-panel loading-panel--error" role="alert">
            <div className="loading-panel__eyebrow">Loading issue</div>
            <div className="loading-panel__title">Asset download failed</div>
            <div className="loading-panel__message">{preloadState.error}</div>
          </div>
        ) : !hasStarted ? (
          <button
            className="start-button"
            onClick={() => {
              playBackgroundMusic();
              setHasStarted(true);
            }}
          >
            <PlayIcon />
            <span>Start Experience</span>
          </button>
        ) : (
          <>
            <button className="music-toggle" onClick={toggleMusic}>
              {isMusicPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="volume-control">
              <VolumeIcon />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="volume-slider"
              />
            </div>

          </>
        )}
      </div>

      {preloadState.isComplete && (
        <Canvas
          gl={{ alpha: true }}
          style={{ background: "transparent" }}
          onCreated={({ gl }) => {
            gl.setClearColor("#000000", 0);
          }}
        >
          <Suspense fallback={null}>
            <AnimatedScene
              isPlaying={isScenePlaying}
              candleLit={isCandleLit}
              onBackgroundFadeChange={setBackgroundOpacity}
              onEnvironmentProgressChange={setEnvironmentProgress}
              onAnimationComplete={() => setHasAnimationCompleted(true)}
              cards={BIRTHDAY_CARDS}
              activeCardId={activeCardId}
              onToggleCard={handleCardToggle}
            />
            <ambientLight intensity={(1 - environmentProgress) * 0.8} />
            <directionalLight intensity={0.5} position={[2, 10, 0]} color={[1, 0.9, 0.95]} />
            <Environment
              files={["/shanghai_bund_4k_1_11zon.jpg"]}
              backgroundRotation={[0, 3.3, 0]}
              environmentRotation={[0, 3.3, 0]}
              background
              environmentIntensity={0.1 * environmentProgress}
              backgroundIntensity={0.05 * environmentProgress}
            />
            <EnvironmentBackgroundController intensity={0.05 * environmentProgress} />
            <Fireworks isActive={fireworksActive} origin={[0, 10, 0]} />
            <ConfiguredOrbitControls />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}
function WindIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.59 4.59A2 2 0 1 1 11 8H2" />
      <path d="M12.59 19.41A2 2 0 1 0 14 16H2" />
      <path d="M15.1 11.1a2 2 0 1 1 2.3 3.3L15 15H2" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M11 5L6 9H2V15H6L11 19V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}
