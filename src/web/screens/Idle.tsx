export type IdleProps = {
  username: string;
  onUsername: (value: string) => void;
  onSubmit: () => void;
  onSurprise: () => void;
  busy: boolean;
};

export function Idle({ username, onUsername, onSubmit, onSurprise, busy }: IdleProps) {
  return (
    <div className="idle">
      <div className="idle-inner">
        <div className="field">
          <span className="field-at" aria-hidden="true">
            @
          </span>
          <input
            className="field-input"
            value={username}
            onChange={(e) => onUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSubmit();
            }}
            placeholder="letterboxd username"
            aria-label="letterboxd username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="button button-primary"
            onClick={onSubmit}
            disabled={busy}
          >
            {busy ? "· · ·" : "pick a film →"}
          </button>
        </div>
        <button type="button" className="link-quiet" onClick={onSurprise} disabled={busy}>
          or go completely random
        </button>
      </div>
    </div>
  );
}
