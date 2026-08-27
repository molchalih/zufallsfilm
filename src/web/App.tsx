import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LastOne } from "./anim/LastOne";
import { Montage } from "./anim/Montage";
import { Roll } from "./anim/Roll";
import { Shuffle } from "./anim/Shuffle";
import { ANIMATIONS, type Animation, type AnimProps, animationFromSearch } from "./anim/shared";
import { Void } from "./anim/Void";
import {
  ApiError,
  type Film,
  fetchPick,
  fetchPool,
  fetchProgress,
  type Pool,
  type Progress,
} from "./api";
import type { Copy } from "./copy";
import { copyFor, isInputRejection } from "./copy";
import { prefetchPosters } from "./posters";
import { ErrorScreen } from "./screens/ErrorScreen";
import { Idle } from "./screens/Idle";
import { Result } from "./screens/Result";
import { buildReel, type Reel, scrapeBar } from "./spin";

/**
 * The watchlist this site draws from when nobody names one. The API has no
 * notion of a film without a member to draw it from, so "completely random"
 * means a random film from a house watchlist rather than a capability the
 * backend does not have. Sight & Sound's is public, curated and institutional,
 * which is why it stands in here and a private individual's does not.
 */
const HOUSE_USER = "sightsound";

const SPIN_MS = 5000;
/** The bar runs at least this long, so a warm answer still reads as a spin. */
const INTRO_MS = 800;
/** How often the build's progress is read while the bar is up. */
const PROGRESS_POLL_MS = 200;
/** Beat between the reel stopping and the result landing. */
const HOLD_MS = 450;

/** Frames each animation flicks through. The roll shows three at a time. */
const REEL_FRAMES: Record<Animation, number> = {
  shuffle: 40,
  roll: 88,
  montage: 40,
  void: 40,
  lastone: 40,
};

const COMPONENTS: Record<Animation, (p: AnimProps) => ReactElement> = {
  shuffle: Shuffle,
  roll: Roll,
  montage: Montage,
  void: Void,
  lastone: LastOne,
};

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "spinning" }
  | { kind: "result" }
  | { kind: "error"; copy: Copy };

type Spin = {
  reel: Reel;
  anim: Animation;
  seed: number;
  /** Decor for the animation. One page of the watchlist, never the pick. */
  pool: Film[];
  /** Films the watchlist holds, for the position readouts during a spin. */
  total: number;
  /** The winner's own place in the watchlist, which the pool may not contain. */
  winnerPosition: number;
};

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function App() {
  const [username, setUsername] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [spin, setSpin] = useState<Spin | null>(null);
  const [t, setT] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  // How long the current wait has run, and whether the response is in hand.
  // The bar needs both: a warm build reports no work at all.
  const [waited, setWaited] = useState(0);
  const [settled, setSettled] = useState(false);
  // A verdict on the name in the field, shown on the field rather than by
  // replacing the page the visitor is standing on.
  const [rejection, setRejection] = useState<Copy | null>(null);

  // Everything a spin owns is torn down by bumping this: a late response, a
  // running frame loop and a pending hold all check it before touching state.
  const runRef = useRef(0);
  const rafRef = useRef(0);
  const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // Cached so a reroll costs one request instead of two.
  const poolRef = useRef<{ user: string; pool: Pool } | null>(null);

  const stop = useCallback(() => {
    runRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    clearTimeout(holdRef.current);
    clearInterval(pollRef.current);
  }, []);

  useEffect(() => stop, [stop]);

  const goHome = useCallback(() => {
    stop();
    setSpin(null);
    setT(0);
    setProgress(null);
    setWaited(0);
    setSettled(false);
    setRejection(null);
    setPhase({ kind: "idle" });
  }, [stop]);

  const start = useCallback(
    (rawUser: string) => {
      const user = rawUser.trim().toLowerCase();
      setRejection(null);
      if (!user) {
        setRejection(copyFor(400, "missing_user"));
        return;
      }
      stop();
      const run = runRef.current;
      const alive = () => runRef.current === run;

      setPhase({ kind: "loading" });
      setT(0);
      setProgress(null);
      setWaited(0);
      setSettled(false);

      // The bar reports the server's own enrichment count rather than a timer,
      // so it stalls and jumps the way the work does. A warm build finishes
      // before the first poll lands, which is why the bar also has a floor.
      const introStart = performance.now();
      pollRef.current = setInterval(() => {
        if (!alive()) return;
        setWaited(performance.now() - introStart);
        fetchProgress(user).then((p) => {
          if (alive() && p && p.total > 0) setProgress(p);
        });
      }, PROGRESS_POLL_MS);

      const cached = poolRef.current;
      // A partial pool is page one of a build still in flight; re-read it so a
      // finished backfill reaches the screen.
      const reusable = cached !== null && cached.user === user && !cached.pool.partial;
      const poolPromise: Promise<Pool> = reusable ? Promise.resolve(cached.pool) : fetchPool(user);

      Promise.all([poolPromise, fetchPick(user)])
        .then(async ([pool, pickRes]) => {
          if (!alive()) return;
          // The response is in hand: the bar has something to fill for, even
          // where the work was already cached and nothing was ever counted.
          setSettled(true);
          poolRef.current = { user, pool };

          // The films are known: start every poster now rather than letting
          // each frame trigger its own. The winner leads — it is the one image
          // the visitor is guaranteed to look at, and it is referenced last.
          prefetchPosters([pickRes.film.poster, ...pool.films.map((f) => f.poster)]);

          const anim =
            animationFromSearch(location.search) ??
            ANIMATIONS[Math.floor(Math.random() * ANIMATIONS.length)];
          // Held locally, not committed to state, until the spin actually
          // starts. The result screen stays mounted through a reroll's loading
          // phase, and committing early would show it the new film first.
          const next: Spin = {
            anim,
            seed: (Math.random() * 0x100000000) >>> 0,
            reel: buildReel(pool.films, pickRes.film, REEL_FRAMES[anim], Math.random),
            pool: pool.films,
            total: Math.max(pool.count, pool.films.length),
            // The pick's own count, not the pool's: a backfill that lands
            // between the two requests would make them disagree, and only one
            // of them describes the draw that actually happened.
            winnerPosition: pickRes.position,
          };

          // Let the bar finish its pass rather than cutting it mid-stroke.
          const elapsed = performance.now() - introStart;
          const remainder = INTRO_MS - (elapsed % INTRO_MS);
          await new Promise((r) => setTimeout(r, remainder));
          if (!alive()) return;

          clearInterval(pollRef.current);
          setSpin(next);
          setT(0);
          setPhase({ kind: "spinning" });
          const duration = prefersReducedMotion() ? 350 : SPIN_MS;
          const t0 = performance.now();
          const loopSpin = (now: number) => {
            if (!alive()) return;
            const progress = Math.min(1, (now - t0) / duration);
            setT(progress);
            if (progress < 1) {
              rafRef.current = requestAnimationFrame(loopSpin);
              return;
            }
            holdRef.current = setTimeout(
              () => {
                if (alive()) setPhase({ kind: "result" });
              },
              prefersReducedMotion() ? 0 : HOLD_MS,
            );
          };
          rafRef.current = requestAnimationFrame(loopSpin);
        })
        .catch((e: unknown) => {
          if (!alive()) return;
          clearInterval(pollRef.current);
          // A name the service cannot use is not a broken service. Keep the
          // visitor where they are, with what they typed still in the field.
          if (e instanceof ApiError && isInputRejection(e.reason)) {
            setRejection(e.copy);
            setPhase({ kind: "idle" });
            return;
          }
          setPhase({
            kind: "error",
            copy: e instanceof ApiError ? e.copy : copyFor(500),
          });
        });
    },
    [stop],
  );

  const winner = phase.kind === "result" ? (spin?.reel.winner ?? null) : null;

  useEffect(() => {
    document.title = winner ? `${winner.name} · zufallsfilm` : "zufallsfilm";
  }, [winner]);

  const poolIndex = useMemo(
    () => new Map((spin?.pool ?? []).map((f, i) => [f.lid, i] as const)),
    [spin],
  );

  const bar = useMemo(() => {
    if (phase.kind === "loading") {
      return {
        width: `${scrapeBar(progress, waited, settled) * 100}%`,
        transition: "width 220ms linear",
      };
    }
    return { width: phase.kind === "spinning" ? `${t * 100}%` : "0%" };
  }, [phase.kind, progress, waited, settled, t]);

  const busy = phase.kind === "loading" || phase.kind === "spinning";
  // Loading holds whatever was already on stage — the design keeps the idle
  // field visible under its own progress bar, and a reroll has no reason to
  // throw away the answer it is replacing until the replacement is ready.
  const loadingFromResult = phase.kind === "loading" && spin !== null;
  const showIdle = phase.kind === "idle" || (phase.kind === "loading" && spin === null);
  const showResult = phase.kind === "result" || loadingFromResult;
  const Animated = spin ? COMPONENTS[spin.anim] : null;

  return (
    <div className="app">
      <header className="header">
        <button type="button" className="wordmark" onClick={goHome}>
          <span className="mark" />
          <span className="wordmark-text">zufallsfilm</span>
        </button>
      </header>

      <section className="stage">
        <div className="track">
          <div className="track-bar" style={bar} />
        </div>

        {showIdle && (
          <Idle
            username={username}
            onUsername={(value) => {
              setRejection(null);
              setUsername(value);
            }}
            rejection={rejection}
            onSubmit={() => start(username)}
            onSurprise={() => start(HOUSE_USER)}
            busy={busy}
          />
        )}

        {phase.kind === "error" && <ErrorScreen copy={phase.copy} onBack={goHome} />}

        {phase.kind === "spinning" && spin && Animated && (
          <Animated
            reel={spin.reel}
            pool={spin.pool}
            total={spin.total}
            poolIndex={poolIndex}
            winnerPosition={spin.winnerPosition}
            seed={spin.seed}
            t={t}
          />
        )}

        {showResult && spin && (
          <Result
            film={spin.reel.winner}
            busy={busy}
            onReroll={() => start(poolRef.current?.user ?? username)}
          />
        )}
      </section>

      <footer className="footer">
        <span className="footer-text">
          2026 · created by{" "}
          <a href="https://github.com/molchalih" target="_blank" rel="noopener noreferrer">
            molchalih
          </a>
        </span>
      </footer>
    </div>
  );
}
