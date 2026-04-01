import { describe, expect, it } from "vitest";
import { seedOntologyBootstrap } from "@/lib/ontology/bootstrap";

describe("ontology bootstrap", () => {
  it("stays optional and fail-soft in v1", async () => {
    const result = await seedOntologyBootstrap();

    expect(result).toEqual(expect.objectContaining({
      attempted: false,
      seeded: 0,
    }));
  });
});