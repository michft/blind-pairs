import type {
  FilterMode,
  PairCode,
  PairProgress,
  PersistedState,
  SourceCandidate,
  SourceDataset,
  UserPair,
} from "./types";
import {
  CORRECT_GAP,
  DEFAULT_REVEAL_DELAY_MS,
  MINIMUM_ASSIGNED_TO_DRILL,
  STORAGE_KEY,
  WRONG_GAP,
} from "./constants";

export function dedupeTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeCandidateText(value);
    if (!normalized) continue;

    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function normalizeCandidateText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isValidCustomText(value: string): boolean {
  const words = normalizeCandidateText(value).split(" ").filter(Boolean);
  return words.length > 0 && words.length <= 3;
}

export function createInitialState(dataset: SourceDataset): PersistedState {
  const pairs = Object.fromEntries(
    dataset.validPairs.map((pair) => [
      pair,
      {
        pair,
        selectedText: null,
        customTexts: [],
      } satisfies UserPair,
    ]),
  );

  const progress = Object.fromEntries(
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
      } satisfies PairProgress,
    ]),
  );

  return {
    version: 1,
    activeFilter: "all",
    filterLetter: "A",
    revealDelayMs: DEFAULT_REVEAL_DELAY_MS,
    globalGuessIndex: 0,
    activeScheme: "ax-v1",
    lastSetupPair: null,
    pairs,
    progress,
  };
}

/**
 * Load persisted application state from localStorage and merge it with a default state for the given dataset.
 *
 * When present, stored values are validated before use: candidate texts are normalised and deduplicated per pair;
 * per-pair progress entries are checked for the required numeric/boolean fields and replaced with defaults if invalid;
 * `globalGuessIndex` is accepted only if it is a number >= 0. If no stored state is found, the version is unsupported, or parsing fails,
 * a freshly created initial state is returned.
 *
 * @param dataset - The source dataset used to build the initial state and to validate/merge stored pair entries
 * @returns A PersistedState produced by merging validated persisted data with the initial state for `dataset`
 */
export function loadState(dataset: SourceDataset): PersistedState {
  const fallback = createInitialState(dataset);
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (parsed.version !== 1) return fallback;

    const mergedPairs = Object.fromEntries(
      dataset.validPairs.map((pair) => {
        const incoming = parsed.pairs?.[pair];
        const selectedText = incoming?.selectedText
          ? normalizeCandidateText(incoming.selectedText)
          : null;
        const customTexts = dedupeTexts(incoming?.customTexts ?? []);

        return [
          pair,
          {
            pair,
            selectedText,
            customTexts,
          } satisfies UserPair,
        ];
      }),
    );

    // Validate and restore progress: use parsed values if valid, otherwise fallback
    const restoredProgress = Object.fromEntries(
      dataset.validPairs.map((pair) => {
        const incomingProgress = parsed.progress?.[pair];
        // Check if incomingProgress has the expected shape and non-negative values
        if (
          incomingProgress &&
          typeof incomingProgress.seenCount === "number" &&
          incomingProgress.seenCount >= 0 &&
          typeof incomingProgress.correctCount === "number" &&
          incomingProgress.correctCount >= 0 &&
          typeof incomingProgress.wrongCount === "number" &&
          incomingProgress.wrongCount >= 0 &&
          typeof incomingProgress.currentSessionSeen === "boolean" &&
          typeof incomingProgress.currentSessionWrongCount === "number" &&
          incomingProgress.currentSessionWrongCount >= 0 &&
          typeof incomingProgress.nextAfterGuesses === "number" &&
          incomingProgress.nextAfterGuesses >= 0
        ) {
          // Restore persistent fields but reset session-specific counters on page load
          return [
            pair,
            {
              ...incomingProgress,
              currentSessionSeen: false,
              currentSessionWrongCount: 0,
            },
          ];
        }
        return [pair, fallback.progress[pair]];
      }),
    );

    // Validate and restore globalGuessIndex: use parsed value if valid, otherwise fallback
    const restoredGlobalGuessIndex =
      typeof parsed.globalGuessIndex === "number" && parsed.globalGuessIndex >= 0
        ? parsed.globalGuessIndex
        : fallback.globalGuessIndex;

    return {
      ...fallback,
      activeFilter: isFilterMode(parsed.activeFilter) ? parsed.activeFilter : "all",
      filterLetter: typeof parsed.filterLetter === "string" ? parsed.filterLetter : "A",
      revealDelayMs:
        typeof parsed.revealDelayMs === "number" ? parsed.revealDelayMs : DEFAULT_REVEAL_DELAY_MS,
      lastSetupPair:
        typeof parsed.lastSetupPair === "string" ? parsed.lastSetupPair : null,
      pairs: mergedPairs,
      progress: restoredProgress,
      globalGuessIndex: restoredGlobalGuessIndex,
    };
  } catch {
    return fallback;
  }
}

export function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getMergedCandidates(
  pair: PairCode,
  state: PersistedState,
  dataset: SourceDataset,
): SourceCandidate[] {
  const userPair = state.pairs[pair];
  const sourceCandidates = dataset.sources[pair] ?? [];
  const selected = userPair.selectedText ? [userPair.selectedText] : [];
  const custom = userPair.customTexts;
  const allTexts = dedupeTexts([
    ...selected,
    ...custom,
    ...sourceCandidates.map((candidate) => candidate.text),
  ]);

  return allTexts.map((text) => {
    const sourceCandidate = sourceCandidates.find(
      (candidate) => candidate.text.toLocaleLowerCase() === text.toLocaleLowerCase(),
    );

    if (userPair.customTexts.some((candidate) => candidate.toLocaleLowerCase() === text.toLocaleLowerCase())) {
      return { text, source: "manual" as const };
    }

    return sourceCandidate ?? { text, source: "manual" as const };
  });
}

export function countAssignedPairs(state: PersistedState, validPairs: PairCode[]): number {
  return validPairs.filter((pair) => Boolean(state.pairs[pair]?.selectedText)).length;
}

export function getFilteredPairs(
  state: PersistedState,
  dataset: SourceDataset,
): PairCode[] {
  const pairs = dataset.validPairs;

  return pairs.filter((pair) => {
    if (!state.pairs[pair]?.selectedText) {
      return false;
    }

    const progress = state.progress[pair];
    switch (state.activeFilter) {
      case "all":
        return true;
      case "unseen":
        return !progress.currentSessionSeen;
      case "weak":
        return progress.wrongCount > 0 || progress.currentSessionWrongCount > 0;
      case "due":
        return progress.nextAfterGuesses <= state.globalGuessIndex;
      case "first-letter":
        return pair.startsWith(state.filterLetter);
      case "second-letter":
        return pair.endsWith(state.filterLetter);
      default:
        return true;
    }
  });
}

export function getDuePairs(state: PersistedState, dataset: SourceDataset): PairCode[] {
  return getFilteredPairs(state, dataset).filter(
    (pair) => state.progress[pair].nextAfterGuesses <= state.globalGuessIndex,
  );
}

export function pickNextPair(
  state: PersistedState,
  dataset: SourceDataset,
  currentPair: PairCode | null,
): PairCode | null {
  const duePairs = getDuePairs(state, dataset);
  if (duePairs.length === 0) {
    return pickUpcomingPair(state, dataset, currentPair);
  }

  const ranked = duePairs
    .map((pair) => {
      const progress = state.progress[pair];
      const wrongWeight = progress.currentSessionWrongCount * 10 + progress.wrongCount * 2;
      const unseenWeight = progress.currentSessionSeen ? 0 : 1000;
      const dueWeight = state.globalGuessIndex - progress.nextAfterGuesses;

      return {
        pair,
        score: unseenWeight + wrongWeight + dueWeight - progress.correctCount,
      };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.pair ?? null;
}

function pickUpcomingPair(
  state: PersistedState,
  dataset: SourceDataset,
  currentPair: PairCode | null,
): PairCode | null {
  const filteredPairs = getFilteredPairs(state, dataset);
  if (filteredPairs.length === 0) {
    return null;
  }

  const ranked = filteredPairs
    .map((pair, index) => ({
      pair,
      nextAfterGuesses: state.progress[pair].nextAfterGuesses,
      isCurrentPair: pair === currentPair ? 1 : 0,
      index,
    }))
    .sort((left, right) => {
      if (left.nextAfterGuesses !== right.nextAfterGuesses) {
        return left.nextAfterGuesses - right.nextAfterGuesses;
      }
      if (left.isCurrentPair !== right.isCurrentPair) {
        return left.isCurrentPair - right.isCurrentPair;
      }
      return left.index - right.index;
    });

  return ranked[0]?.pair ?? null;
}

export function gradePair(
  state: PersistedState,
  pair: PairCode,
  result: "correct" | "wrong",
): PersistedState {
  const current = state.progress[pair];
  const nextAfterGuesses =
    state.globalGuessIndex + (result === "wrong" ? WRONG_GAP : CORRECT_GAP);

  const updatedProgress: PairProgress = {
    ...current,
    seenCount: current.seenCount + 1,
    correctCount: current.correctCount + (result === "correct" ? 1 : 0),
    wrongCount: current.wrongCount + (result === "wrong" ? 1 : 0),
    currentSessionSeen: true,
    currentSessionWrongCount:
      current.currentSessionWrongCount + (result === "wrong" ? 1 : 0),
    nextAfterGuesses,
  };

  return {
    ...state,
    globalGuessIndex: state.globalGuessIndex + 1,
    progress: {
      ...state.progress,
      [pair]: updatedProgress,
    },
  };
}

export function updateSelectedPair(
  state: PersistedState,
  pair: PairCode,
  selectedText: string | null,
): PersistedState {
  return {
    ...state,
    lastSetupPair: pair,
    pairs: {
      ...state.pairs,
      [pair]: {
        ...state.pairs[pair],
        selectedText: selectedText ? normalizeCandidateText(selectedText) : null,
      },
    },
  };
}

export function addCustomCandidate(
  state: PersistedState,
  pair: PairCode,
  value: string,
): PersistedState {
  const normalized = normalizeCandidateText(value);
  const existing = state.pairs[pair];

  return {
    ...state,
    lastSetupPair: pair,
    pairs: {
      ...state.pairs,
      [pair]: {
        ...existing,
        customTexts: dedupeTexts([...existing.customTexts, normalized]),
        selectedText: normalized,
      },
    },
  };
}

export function buildExport(state: PersistedState): string {
  return JSON.stringify(state, null, 2);
}

export function canDrill(assignedCount: number): boolean {
  return assignedCount >= MINIMUM_ASSIGNED_TO_DRILL;
}

export function importState(
  raw: string,
  dataset: SourceDataset,
  currentState: PersistedState,
): PersistedState {
  const parsed = JSON.parse(raw) as Partial<PersistedState>;
  if (parsed.version !== 1) {
    throw new Error("Unsupported export version.");
  }

  const next = createInitialState(dataset);
  const pairs = Object.fromEntries(
    dataset.validPairs.map((pair) => {
      const imported = parsed.pairs?.[pair];
      return [
        pair,
        {
          pair,
          selectedText: imported?.selectedText
            ? normalizeCandidateText(imported.selectedText)
            : currentState.pairs[pair]?.selectedText ?? null,
          customTexts: dedupeTexts(imported?.customTexts ?? currentState.pairs[pair]?.customTexts ?? []),
        } satisfies UserPair,
      ];
    }),
  );

  return {
    ...next,
    activeFilter: isFilterMode(parsed.activeFilter) ? parsed.activeFilter : currentState.activeFilter,
    filterLetter:
      typeof parsed.filterLetter === "string" ? parsed.filterLetter : currentState.filterLetter,
    revealDelayMs:
      typeof parsed.revealDelayMs === "number" ? parsed.revealDelayMs : currentState.revealDelayMs,
    pairs,
  };
}

function isFilterMode(value: unknown): value is FilterMode {
  return (
    value === "all" ||
    value === "unseen" ||
    value === "weak" ||
    value === "due" ||
    value === "first-letter" ||
    value === "second-letter"
  );
}
