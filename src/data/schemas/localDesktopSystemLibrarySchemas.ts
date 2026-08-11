import { z } from "zod";
import { DesktopSystemRecordSchema } from "../../systems";

export const LOCAL_DESKTOP_SYSTEM_ID_PREFIX = "local.system.";
export const LOCAL_DESKTOP_SYSTEM_LIBRARY_MAX_RECORDS = 100;

const localDesktopSystemId = z
  .string()
  .regex(/^local\.system\.[a-z0-9][a-z0-9._-]*$/);

/**
 * Browser-local systems are valid calculator records with a separate ID
 * namespace. They remain directional user input rather than verified Data
 * Pack evidence.
 */
export const LocalDesktopSystemRecordSchema = DesktopSystemRecordSchema.superRefine(
  (record, context) => {
    if (!localDesktopSystemId.safeParse(record.id).success) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: `Browser-local system IDs must use the '${LOCAL_DESKTOP_SYSTEM_ID_PREFIX}' namespace.`,
      });
    }
    if (record.dataQuality !== "directional") {
      context.addIssue({
        code: "custom",
        path: ["dataQuality"],
        message: "Browser-local systems must be marked as directional data.",
      });
    }
  },
);

export const LocalDesktopSystemLibrarySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime(),
    records: z
      .array(LocalDesktopSystemRecordSchema)
      .max(LOCAL_DESKTOP_SYSTEM_LIBRARY_MAX_RECORDS),
  })
  .superRefine((library, context) => {
    const ids = library.records.map((record) => record.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["records"],
        message: "Browser-local system IDs must be unique.",
      });
    }
  });

/** Stable systems section for a combined Browser Library Pack. */
export const BrowserLibrarySystemsSectionSchema = z.strictObject({
  sectionSchemaVersion: z.literal(1),
  kind: z.literal("browser-local-desktop-system-library"),
  library: LocalDesktopSystemLibrarySchema,
});

export type LocalDesktopSystemRecord = z.infer<
  typeof LocalDesktopSystemRecordSchema
>;
export type LocalDesktopSystemLibrary = z.infer<
  typeof LocalDesktopSystemLibrarySchema
>;
export type BrowserLibrarySystemsSection = z.infer<
  typeof BrowserLibrarySystemsSectionSchema
>;
