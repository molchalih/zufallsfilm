import type { Film } from "../api";
import { formatRating, formatRuntime, formatYear } from "../spin";

function Arrow() {
  return (
    <span className="title-arrow">
      <svg width="0.42em" height="0.42em" viewBox="0 0 12 12" role="img">
        <title>opens on letterboxd</title>
        <path
          d="M3.5 8.5 L8 4 M4 3.5 H8.5 V8"
          stroke="currentColor"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="square"
        />
      </svg>
    </span>
  );
}

export type ResultProps = {
  film: Film;
  onReroll: () => void;
  busy: boolean;
};

export function Result({ film, onReroll, busy }: ResultProps) {
  return (
    <div className="result">
      {film.poster ? (
        <div
          className="poster"
          role="img"
          aria-label={film.name}
          style={{ backgroundImage: `url("${encodeURI(film.poster)}")` }}
        />
      ) : (
        <div className="poster-empty">
          <span className="poster-note">poster not found</span>
        </div>
      )}
      <div className="result-body">
        <h2 className="title">
          <a href={film.url} target="_blank" rel="noopener noreferrer">
            {film.name}
            <Arrow />
          </a>
        </h2>
        <div className="facts">
          <div className="facts-rule" />
          <div className="facts-clip">
            <div className="facts-row">
              <div className="fact">
                <span className="fact-label">year</span>
                <span className="fact-value">{formatYear(film.year)}</span>
              </div>
              <div className="fact">
                <span className="fact-label">runtime</span>
                <span className="fact-value">{formatRuntime(film.runtime)}</span>
              </div>
              <div className="fact">
                <span className="fact-label">rating</span>
                <span className="fact-value">{formatRating(film.rating)}</span>
              </div>
            </div>
          </div>
        </div>
        <button type="button" className="button button-reroll" onClick={onReroll} disabled={busy}>
          reroll ↺
        </button>
      </div>
    </div>
  );
}
