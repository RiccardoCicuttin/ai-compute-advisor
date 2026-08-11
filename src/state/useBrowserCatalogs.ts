import { useCallback, useMemo, useState } from "react";
import type { NormalizedCatalogs } from "../types";
import type { ArtificialAnalysisComparisonLibrary } from "../data/schemas";
import {
  clearArtificialAnalysisComparisonLibrary,
  readArtificialAnalysisComparisonLibrary,
  writeArtificialAnalysisComparisonLibrary,
} from "./artificialAnalysisComparisonLibrary";
import {
  createBrowserLibraryPack,
  downloadBrowserLibraryPack,
  parseBrowserLibraryPackFile,
} from "./browserLibraryPack";
import {
  createEmptyLocalDesktopSystemLibrary,
  mergeLocalDesktopSystemLibrary,
  readLocalDesktopSystemLibrary,
  writeLocalDesktopSystemLibrary,
  type LocalDesktopSystemLibrary,
  type LocalDesktopSystemRecord,
} from "./localDesktopSystemLibrary";
import {
  createEmptyLocalModelLibrary,
  mergeLocalModelLibraryIntoCatalogs,
  readLocalModelLibrary,
  writeLocalModelLibrary,
  type LocalModelLibrary,
  type LocalModelLibraryEntry,
} from "./localModelLibrary";

export interface BrowserCatalogIssue {
  source: "models" | "systems" | "artificial-analysis" | "library-pack";
  message: string;
}

type LibraryUpdater<T> = T | ((current: T) => T);

function updated<T>(current: T, updater: LibraryUpdater<T>): T {
  return typeof updater === "function"
    ? (updater as (value: T) => T)(current)
    : updater;
}

/**
 * Browser-local records are an overlay over the authoritative Data Pack.
 * This hook owns only browser persistence and overlay composition; calculator
 * math continues to consume a normal NormalizedCatalogs object.
 */
export function useBrowserCatalogs(baseCatalogs: NormalizedCatalogs) {
  const initialModels = useMemo(() => readLocalModelLibrary(), []);
  const initialSystems = useMemo(() => readLocalDesktopSystemLibrary(), []);
  const initialArtificialAnalysis = useMemo(
    () => readArtificialAnalysisComparisonLibrary(),
    [],
  );
  const [modelLibrary, setModelLibraryState] = useState(initialModels.library);
  const [systemLibrary, setSystemLibraryState] = useState(initialSystems.library);
  const [artificialAnalysisLibrary, setArtificialAnalysisLibraryState] =
    useState(initialArtificialAnalysis.library);
  const [actionIssue, setActionIssue] = useState<BrowserCatalogIssue | null>(null);

  const modelMerge = useMemo(
    () => mergeLocalModelLibraryIntoCatalogs(baseCatalogs, modelLibrary),
    [baseCatalogs, modelLibrary],
  );
  const systemMerge = useMemo(
    () =>
      mergeLocalDesktopSystemLibrary(
        baseCatalogs.systems,
        systemLibrary,
        modelMerge.catalogs.models,
      ),
    [baseCatalogs.systems, modelLibrary, modelMerge.catalogs.models, systemLibrary],
  );
  const catalogs = useMemo<NormalizedCatalogs>(
    () => ({ ...modelMerge.catalogs, systems: systemMerge.systems }),
    [modelMerge.catalogs, systemMerge.systems],
  );

  const commitModelLibrary = useCallback(
    (updater: LibraryUpdater<LocalModelLibrary>): boolean => {
      try {
        const next = updated(modelLibrary, updater);
        writeLocalModelLibrary(next);
        setModelLibraryState(next);
        setActionIssue(null);
        return true;
      } catch (caught) {
        setActionIssue({
          source: "models",
          message:
            caught instanceof Error
              ? caught.message
              : "The browser-local model library could not be saved.",
        });
        return false;
      }
    },
    [modelLibrary],
  );

  const commitSystemLibrary = useCallback(
    (updater: LibraryUpdater<LocalDesktopSystemLibrary>): boolean => {
      try {
        const next = updated(systemLibrary, updater);
        writeLocalDesktopSystemLibrary(next);
        setSystemLibraryState(next);
        setActionIssue(null);
        return true;
      } catch (caught) {
        setActionIssue({
          source: "systems",
          message:
            caught instanceof Error
              ? caught.message
              : "The browser-local system library could not be saved.",
        });
        return false;
      }
    },
    [systemLibrary],
  );

  const commitArtificialAnalysisLibrary = useCallback(
    (updater: LibraryUpdater<ArtificialAnalysisComparisonLibrary>): boolean => {
      try {
        const next = updated(artificialAnalysisLibrary, updater);
        const issue = writeArtificialAnalysisComparisonLibrary(next);
        if (issue) throw new Error(issue.message);
        setArtificialAnalysisLibraryState(next);
        setActionIssue(null);
        return true;
      } catch (caught) {
        setActionIssue({
          source: "artificial-analysis",
          message:
            caught instanceof Error
              ? caught.message
              : "Artificial Analysis comparison data could not be saved.",
        });
        return false;
      }
    },
    [artificialAnalysisLibrary],
  );

  const importPack = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const pack = await parseBrowserLibraryPackFile(file);
        const nextModels = pack.models.library;
        const nextSystems = pack.systems.library;
        const nextArtificialAnalysis =
          pack.artificialAnalysis?.library ?? artificialAnalysisLibrary;

        // Validate both sections before any write. If the second write fails,
        // restore the first so the visible library never becomes half-imported.
        writeLocalModelLibrary(nextModels);
        try {
          writeLocalDesktopSystemLibrary(nextSystems);
          const comparisonIssue = writeArtificialAnalysisComparisonLibrary(
            nextArtificialAnalysis,
          );
          if (comparisonIssue) throw new Error(comparisonIssue.message);
        } catch (caught) {
          writeLocalModelLibrary(modelLibrary);
          writeLocalDesktopSystemLibrary(systemLibrary);
          writeArtificialAnalysisComparisonLibrary(artificialAnalysisLibrary);
          throw caught;
        }
        setModelLibraryState(nextModels);
        setSystemLibraryState(nextSystems);
        setArtificialAnalysisLibraryState(nextArtificialAnalysis);
        setActionIssue(null);
        return true;
      } catch (caught) {
        setActionIssue({
          source: "library-pack",
          message:
            caught instanceof Error
              ? caught.message
              : "The Browser Library Pack could not be imported.",
        });
        return false;
      }
    },
    [artificialAnalysisLibrary, modelLibrary, systemLibrary],
  );

  const exportPack = useCallback((): boolean => {
    try {
      downloadBrowserLibraryPack(
        createBrowserLibraryPack(
          modelLibrary,
          systemLibrary,
          new Date(),
          artificialAnalysisLibrary,
        ),
      );
      setActionIssue(null);
      return true;
    } catch (caught) {
      setActionIssue({
        source: "library-pack",
        message:
          caught instanceof Error
            ? caught.message
            : "The Browser Library Pack could not be exported.",
      });
      return false;
    }
  }, [artificialAnalysisLibrary, modelLibrary, systemLibrary]);

  const clearLibraries = useCallback((): boolean => {
    const now = new Date();
    const emptyModels = createEmptyLocalModelLibrary(now);
    const emptySystems = createEmptyLocalDesktopSystemLibrary(now);
    const emptyArtificialAnalysis = clearArtificialAnalysisComparisonLibrary(now);
    try {
      writeLocalModelLibrary(emptyModels);
      try {
        writeLocalDesktopSystemLibrary(emptySystems);
        const comparisonIssue = writeArtificialAnalysisComparisonLibrary(
          emptyArtificialAnalysis,
        );
        if (comparisonIssue) throw new Error(comparisonIssue.message);
      } catch (caught) {
        writeLocalModelLibrary(modelLibrary);
        writeLocalDesktopSystemLibrary(systemLibrary);
        writeArtificialAnalysisComparisonLibrary(artificialAnalysisLibrary);
        throw caught;
      }
      setModelLibraryState(emptyModels);
      setSystemLibraryState(emptySystems);
      setArtificialAnalysisLibraryState(emptyArtificialAnalysis);
      setActionIssue(null);
      return true;
    } catch (caught) {
      setActionIssue({
        source: "library-pack",
        message:
          caught instanceof Error
            ? caught.message
            : "The Browser Library could not be cleared.",
      });
      return false;
    }
  }, [artificialAnalysisLibrary, modelLibrary, systemLibrary]);

  const readIssues: BrowserCatalogIssue[] = [
    ...(initialModels.issue
      ? [{ source: "models" as const, message: initialModels.issue.message }]
      : []),
    ...(initialSystems.issue
      ? [{ source: "systems" as const, message: initialSystems.issue.message }]
      : []),
    ...(initialArtificialAnalysis.issue
      ? [
          {
            source: "artificial-analysis" as const,
            message: initialArtificialAnalysis.issue.message,
          },
        ]
      : []),
  ];
  const reconciliationIssues: BrowserCatalogIssue[] = [
    ...modelMerge.issues.map((issue) => ({
      source: "models" as const,
      message: issue.message,
    })),
    ...systemMerge.issues.map((issue) => ({
      source: "systems" as const,
      message: issue.message,
    })),
  ];
  const activeLocalSystemIds = new Set(systemMerge.activeLocalSystemIds);

  return {
    catalogs,
    modelLibrary: modelMerge.library,
    systemLibrary: systemMerge.library,
    artificialAnalysisLibrary,
    localModelEntries: modelMerge.library.entries as LocalModelLibraryEntry[],
    localSystems: systemMerge.library.records.filter((system) =>
      activeLocalSystemIds.has(system.id),
    ) as LocalDesktopSystemRecord[],
    commitModelLibrary,
    commitSystemLibrary,
    commitArtificialAnalysisLibrary,
    importPack,
    exportPack,
    clearLibraries,
    issues: [
      ...readIssues,
      ...reconciliationIssues,
      ...(actionIssue ? [actionIssue] : []),
    ],
  };
}
