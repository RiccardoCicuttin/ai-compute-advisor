import { describe, expect, it } from "vitest";
import {
  BrowserLibraryPackError,
  createBrowserLibraryPack,
  parseBrowserLibraryPackJson,
  serializeBrowserLibraryPack,
} from "./browserLibraryPack";
import { createEmptyLocalDesktopSystemLibrary } from "./localDesktopSystemLibrary";
import { createEmptyLocalModelLibrary } from "./localModelLibrary";
import { createEmptyArtificialAnalysisComparisonLibrary } from "./artificialAnalysisComparisonLibrary";

const timestamp = "2026-08-11T01:02:03.000Z";

describe("Browser Library Pack", () => {
  it("round-trips models and systems in one strict portable file", () => {
    const pack = createBrowserLibraryPack(
      createEmptyLocalModelLibrary(timestamp),
      createEmptyLocalDesktopSystemLibrary(timestamp),
      timestamp,
      createEmptyArtificialAnalysisComparisonLibrary(timestamp),
    );
    expect(parseBrowserLibraryPackJson(serializeBrowserLibraryPack(pack))).toEqual(pack);
  });

  it("rejects unknown top-level keys", () => {
    const pack = createBrowserLibraryPack(
      createEmptyLocalModelLibrary(timestamp),
      createEmptyLocalDesktopSystemLibrary(timestamp),
      timestamp,
    );
    expect(() =>
      parseBrowserLibraryPackJson(JSON.stringify({ ...pack, unexpected: true })),
    ).toThrow(BrowserLibraryPackError);
  });

  it("checks the byte limit before parsing", () => {
    expect(() => parseBrowserLibraryPackJson("{}", { maxBytes: 1 })).toThrowError(
      expect.objectContaining({ code: "too-large" }),
    );
  });
});
