import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectContext } from "../src/retrieval";

describe("selectContext", () => {
  it("returns full context when mode is full", async () => {
    const tempPath = path.join(os.tmpdir(), `chunks-${Date.now()}.json`);

    const chunks = [
      { id: "1", text: "alpha", embedding: [0.1, 0.2], index: 0 },
      { id: "2", text: "beta", embedding: [0.2, 0.3], index: 1 }
    ];

    await fs.writeFile(tempPath, JSON.stringify(chunks), "utf8");

    const context = await selectContext(
      tempPath,
      {
        mode: "full",
        topK: 2,
        fromChunk: 0,
        toChunk: 1,
        maxChars: 100
      },
      [0.1, 0.2]
    );

    expect(context).toContain("alpha");
    expect(context).toContain("beta");

    await fs.unlink(tempPath);
  });

  it("blends lexical matches for short precision queries in semantic mode", async () => {
    const tempPath = path.join(os.tmpdir(), `chunks-${Date.now()}-lexical.json`);

    const chunks = [
      { id: "1", text: "General ownership principles overview.", embedding: [0.9, 0.1], index: 0 },
      { id: "2", text: "Savigny argued law grows from the Volksgeist.", embedding: [0.1, 0.9], index: 1 },
      { id: "3", text: "Unrelated procedural notes.", embedding: [0.8, 0.2], index: 2 }
    ];

    await fs.writeFile(tempPath, JSON.stringify(chunks), "utf8");

    const context = await selectContext(
      tempPath,
      {
        mode: "semantic",
        topK: 1,
        fromChunk: 0,
        toChunk: 2,
        maxChars: 1000
      },
      [1, 0],
      "savigny theory"
    );

    expect(context.toLowerCase()).toContain("savigny");

    await fs.unlink(tempPath);
  });
});
