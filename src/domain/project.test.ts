import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, hasSupportedProjectSchemaVersion } from "./project";

describe("project schema version gate", () => {
  it("accepts the current schema version", () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(1);
    expect(hasSupportedProjectSchemaVersion({ schemaVersion: 1 })).toBe(true);
  });

  it("rejects missing, malformed and unknown schema versions", () => {
    expect(hasSupportedProjectSchemaVersion(null)).toBe(false);
    expect(hasSupportedProjectSchemaVersion("project")).toBe(false);
    expect(hasSupportedProjectSchemaVersion({})).toBe(false);
    expect(hasSupportedProjectSchemaVersion({ schemaVersion: 2 })).toBe(false);
  });
});
