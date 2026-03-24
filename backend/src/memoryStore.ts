import fs from "node:fs/promises";

function trimForMemory(text: string, maxLength = 700): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export async function readMemory(memoryPath: string): Promise<string> {
  try {
    return await fs.readFile(memoryPath, "utf8");
  } catch {
    return "";
  }
}

export async function updateMemoryMarkdown(
  memoryPath: string,
  userMessage: string,
  assistantReply: string
): Promise<void> {
  const now = new Date().toISOString();
  const entry = [
    `## ${now}`,
    "",
    `- User: ${trimForMemory(userMessage)}`,
    `- Assistant: ${trimForMemory(assistantReply)}`,
    ""
  ].join("\n");

  let existing = "# Session Memory\n\n";
  try {
    existing = await fs.readFile(memoryPath, "utf8");
  } catch {
    // First run creates the file.
  }

  await fs.writeFile(memoryPath, `${existing.trimEnd()}\n\n${entry}`, "utf8");
}
