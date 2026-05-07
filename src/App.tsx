import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import sourceData from "../data/generated/pairs.json";
import { FILTER_LABELS, MINIMUM_ASSIGNED_TO_DRILL } from "./constants";
import type { FilterMode, PairCode, PersistedState, SourceDataset } from "./types";
import {
  addCustomCandidate,
  buildExport,
  canDrill,
  countAssignedPairs,
  getFilteredPairs,
  getMergedCandidates,
  gradePair,
  importState,
  isValidCustomText,
  loadPersistedState,
  loadState,
  pickNextPair,
  saveState,
  updateSelectedPair,
} from "./utils";

const dataset = sourceData as SourceDataset;
const FILTERS = Object.keys(FILTER_LABELS) as FilterMode[];

type Page = "setup" | "drill";

export default function App() {
  const [state, setState] = useState<PersistedState>(() => loadState(dataset));
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [page, setPage] = useState<Page>("setup");
  const [currentPair, setCurrentPair] = useState<PairCode | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [customInputs, setCustomInputs] = useState<Record<PairCode, string>>({});
  const timerRef = useRef<number | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const assignedCount = useMemo(
    () => countAssignedPairs(state, dataset.validPairs),
    [state],
  );
  const isReadyToDrill = canDrill(assignedCount);

  useEffect(() => {
    let cancelled = false;

    void loadPersistedState(dataset).then((nextState) => {
      if (cancelled) return;
      setState(nextState);
      setIsStorageReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isStorageReady) return;
    void saveState(state);
  }, [isStorageReady, state]);

  useEffect(() => {
    if (page !== "drill" || !isReadyToDrill) return;

    const nextPair = pickNextPair(state, dataset, currentPair);
    if (nextPair && nextPair !== currentPair) {
      setCurrentPair(nextPair);
      setRevealed(false);
    } else if (!currentPair && nextPair) {
      setCurrentPair(nextPair);
      setRevealed(false);
    }
  }, [page, isReadyToDrill, state, currentPair]);

  useEffect(() => {
    if (page !== "setup" || !state.lastSetupPair) return;

    const element = document.getElementById(`pair-${state.lastSetupPair}`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [page, state.lastSetupPair]);

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (page !== "drill" || !currentPair || revealed) return;

    timerRef.current = window.setTimeout(() => {
      setRevealed(true);
    }, state.revealDelayMs);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [page, currentPair, revealed, state.revealDelayMs]);

  const filteredPairs = useMemo(() => getFilteredPairs(state, dataset), [state]);
  const currentAnswer = currentPair ? state.pairs[currentPair]?.selectedText : null;

  function handleSelect(pair: PairCode, text: string | null) {
    setState((current) => updateSelectedPair(current, pair, text));
  }

  function handleAddCustom(pair: PairCode) {
    const raw = customInputs[pair] ?? "";
    if (!isValidCustomText(raw)) return;
    setState((current) => addCustomCandidate(current, pair, raw));
    setCustomInputs((current) => ({ ...current, [pair]: "" }));
  }

  function handleGrade(result: "correct" | "wrong") {
    if (!currentPair) return;

    setState((current) => gradePair(current, currentPair, result));
    setRevealed(false);
  }

  function downloadExport() {
    const blob = new Blob([buildExport(state)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "blindpairs-export.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const nextState = importState(text, dataset, state);
    setState(nextState);
    setPage("setup");
    setCurrentPair(null);
    setRevealed(false);
    event.target.value = "";
  }

  function resetSession() {
    setState((current) => ({
      ...current,
      globalGuessIndex: 0,
      progress: Object.fromEntries(
        dataset.validPairs.map((pair) => [
          pair,
          {
            pair,
            seenCount: 0,
            correctCount: 0,
            wrongCount: 0,
            currentSessionSeen: false,
            currentSessionWrongCount: 0,
            nextAfterGuesses: 0,
          },
        ]),
      ),
    }));
    setCurrentPair(null);
    setRevealed(false);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <h1>Blind Pairs</h1>
          <p className="hero-copy">
            Own the mapping. Drill the weak spots. A-X letter pairs with hidden invalids,
            forced setup before drilling, and guess-count scheduling.
          </p>
        </div>
        <div className="hero-panel">
          <div>
            <span className="metric-label">Assigned</span>
            <strong>{assignedCount}</strong>
            <span className="metric-meta">
              need {MINIMUM_ASSIGNED_TO_DRILL} to unlock drill
            </span>
          </div>
          <div>
            <span className="metric-label">Scheme</span>
            <strong>AX v1</strong>
            <span className="metric-meta">540 valid pairs</span>
          </div>
          <div>
            <span className="metric-label">Reveal</span>
            <strong>{(state.revealDelayMs / 1000).toFixed(1)}s</strong>
            <span className="metric-meta">tap reveal anytime</span>
          </div>
        </div>
      </section>

      <nav className="topbar">
        <div className="tab-row">
          <button
            className={page === "setup" ? "tab active" : "tab"}
            onClick={() => setPage("setup")}
          >
            Setup
          </button>
          <button
            className={page === "drill" ? "tab active" : "tab"}
            onClick={() => setPage("drill")}
            disabled={!isReadyToDrill}
          >
            Drill
          </button>
        </div>
        <div className="actions">
          <label className="inline-control">
            Reveal delay
            <input
              type="range"
              min="500"
              max="5000"
              step="500"
              value={state.revealDelayMs}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  revealDelayMs: Number(event.target.value),
                }))
              }
            />
          </label>
          <button className="ghost-button" onClick={downloadExport}>
            Export
          </button>
          <button className="ghost-button" onClick={() => importRef.current?.click()}>
            Import
          </button>
          <button className="ghost-button" onClick={resetSession}>
            Reset session
          </button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            hidden
            onChange={handleImport}
          />
        </div>
      </nav>

      {page === "setup" ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Setup</h2>
              <p>
                Drilling unlocks once you have at least {MINIMUM_ASSIGNED_TO_DRILL} selected
                word or image phrases.
              </p>
            </div>
            <div className="setup-meta">
              <span>{assignedCount} / {dataset.validPairs.length} assigned</span>
              <progress max={dataset.validPairs.length} value={assignedCount} />
            </div>
          </div>

          <div className="setup-grid">
            {dataset.validPairs.map((pair) => {
              const options = getMergedCandidates(pair, state, dataset);
              const selectedText = state.pairs[pair].selectedText;
              return (
                <article
                  key={pair}
                  className={selectedText ? "pair-card assigned" : "pair-card"}
                  id={`pair-${pair}`}
                >
                  <header>
                    <h3>{pair}</h3>
                    <span>{selectedText ?? "Choose one"}</span>
                  </header>
                  <div className="candidate-list">
                    {options.map((candidate) => (
                      <button
                        key={`${pair}-${candidate.source}-${candidate.text}`}
                        className={
                          selectedText === candidate.text ? "candidate selected" : "candidate"
                        }
                        onClick={() => handleSelect(pair, candidate.text)}
                        title={candidate.source}
                      >
                        <span>{candidate.text}</span>
                      </button>
                    ))}
                  </div>
                  {selectedText ? (
                    <div className="selection-actions">
                      <button
                        className="ghost-button"
                        onClick={() => handleSelect(pair, null)}
                      >
                        Unset
                      </button>
                    </div>
                  ) : null}
                  <div className="custom-row">
                    <input
                      type="text"
                      placeholder="Add custom phrase"
                      value={customInputs[pair] ?? ""}
                      onChange={(event) =>
                        setCustomInputs((current) => ({
                          ...current,
                          [pair]: event.target.value,
                        }))
                      }
                    />
                    <button onClick={() => handleAddCustom(pair)}>Save</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="panel drill-panel">
          <div className="panel-header">
            <div>
              <h2>Drill</h2>
              <p>
                {FILTER_LABELS[state.activeFilter]} filter with recent-session
                weakness weighted higher than lifetime misses.
              </p>
            </div>
            <div className="filter-strip">
              {FILTERS.map((filter) => (
                <button
                  key={filter}
                  className={state.activeFilter === filter ? "pill active" : "pill"}
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      activeFilter: filter,
                    }))
                  }
                >
                  {FILTER_LABELS[filter]}
                </button>
              ))}
              {(state.activeFilter === "first-letter" ||
                state.activeFilter === "second-letter") && (
                <select
                  value={state.filterLetter}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      filterLetter: event.target.value,
                    }))
                  }
                >
                  {dataset.alphabet.map((letter) => (
                    <option key={letter} value={letter}>
                      {letter}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="drill-stage">
            <aside className="queue-panel">
              <h3>Eligible now</h3>
              <strong>{filteredPairs.length}</strong>
              <p>Current session guess index: {state.globalGuessIndex}</p>
              <p>
                Auto reveal at {(state.revealDelayMs / 1000).toFixed(1)} seconds.
              </p>
            </aside>

            <section className="flashcard">
              <p className="flashcard-label">Pair</p>
              <strong className="flashcard-pair">{currentPair ?? "--"}</strong>
              <p className="flashcard-answer">
                {revealed ? currentAnswer ?? "No selection" : "Recall first. Reveal when ready."}
              </p>

              <div className="flashcard-actions">
                {!revealed ? (
                  <button className="primary-button" onClick={() => setRevealed(true)}>
                    Reveal early
                  </button>
                ) : (
                  <>
                    <button className="ghost-button" onClick={() => handleGrade("wrong")}>
                      Wrong
                    </button>
                    <button className="primary-button" onClick={() => handleGrade("correct")}>
                      Correct
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => {
                        if (!currentPair) return;
                        setState((current) => ({ ...current, lastSetupPair: currentPair }));
                        setPage("setup");
                      }}
                    >
                      Change word
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>
        </section>
      )}
    </main>
  );
}
