/**
 * EditPromptBuilder — builds the edit-mode system prompt supplement
 * and the page context user message for the LLM.
 */

/**
 * Build the edit-mode system prompt that defines the json-edit schema
 * and instructs the LLM on how to emit edit commands.
 */
export function buildEditSystemPrompt(): string {
  return `EDIT MODE INSTRUCTIONS:
You have the ability to edit the user's current Logseq page. When the user asks you to make changes to their page, respond with structured edit commands inside a \`\`\`json-edit fenced code block.

Each command is a JSON object with these fields:
- "action": "insert" | "update" | "delete"
- "blockUUID": (string) The UUID of the block to update or delete. Required for "update" and "delete".
- "parentBlockUUID": (string) The UUID of the parent block (or the Page UUID) under which to insert. Required for "insert".
- "content": (string) The block content in Logseq markdown format. Required for "insert" and "update".
- "siblingOrder": (number, optional) Position among siblings (0 = first child).

Wrap all commands in a JSON array inside a \`\`\`json-edit code fence. You may include explanatory text before and after the fence.

IMPORTANT:
- Only reference block UUIDs that appear in the page context below.
- For top-level inserts (or if the page is empty), use the Page UUID as parentBlockUUID.
- If the user has a block selected/focused (indicated by "Selected/Focused Block UUID" in context), prefer writing/inserting the requested content into this block using "action": "update" with its UUID (especially if the block is currently empty, indicated by "Selected/Focused Block Is Empty: true"), rather than creating a new page-level block.
- Logseq CANNOT render multiple headings (like "# Heading 1\\n## Heading 2") or multiple bullet lists (unordered lists) within a single block. If you need to create headings, lists, or structured sub-items, always create/insert them as separate, individual child blocks (sub-blocks) under a parent block using parentBlockUUID rather than writing them as multiline text inside a single block.
- You may include multiple commands in a single array.
- If the user's request is a question (not an edit request), respond normally without edit commands.
- In Logseq, every block is already a bullet point. Do NOT prefix content with "- " or "* ". If you want to create a list, insert each item as a separate child block under the same parent.
- For nested/indented content, insert child blocks (using the parent block's UUID as parentBlockUUID) rather than using markdown list syntax within a single block's content.
- To set or edit block properties/attributes, include them in the content field on new lines using the format "property:: value". For example: "Task title\\npriority:: high\\nstatus:: todo". To update a property on an existing block, use "update" and include the full block content with the modified property lines.
- To set or edit time tracking (clock entries) on a task block, include CLOCK lines in org-mode format: "CLOCK: [YYYY-MM-DD ddd HH:MM]--[YYYY-MM-DD ddd HH:MM] =>  HH:MM". For example: "DOING My task\\nCLOCK: [2024-03-15 Fri 09:00]--[2024-03-15 Fri 10:30] =>  01:30". Multiple CLOCK entries can be stacked on separate lines. Task states include TODO, DOING, DONE, NOW, LATER, WAITING, CANCELLED.
- To embed an image in a block, use standard markdown image syntax: "![description](url)". Valid sources include: external URLs ("![photo](https://example.com/img.png)"), existing graph assets ("![photo](../assets/image.png)"), or data URIs ("![photo](data:image/png;base64,...)"). If the user attaches an image in chat, its data URI will be provided — use it directly in the block content. Do NOT attempt to write files to the assets folder.`;
}

/**
 * Build the user message section containing the active page block tree.
 */
export function buildPageContextMessage(
  pageName: string,
  pageUUID: string,
  selectedBlockUUID: string | null,
  selectedBlockContent: string | null,
  isSelectedBlockEmpty: boolean,
  formattedTree: string,
): string {
  let msg = `Page Name: "${pageName}"\nPage UUID: "${pageUUID}" (use this as parentBlockUUID to insert top-level blocks on this page)\n`;
  if (selectedBlockUUID) {
    msg += `Selected/Focused Block UUID: "${selectedBlockUUID}" (the user currently has their cursor or selection on this block)\n`;
    msg += `Selected/Focused Block Content: "${selectedBlockContent ?? ''}"\n`;
    msg += `Selected/Focused Block Is Empty: ${isSelectedBlockEmpty}\n`;
  }
  msg += `Blocks:\n${formattedTree || '(The page is currently empty)'}`;
  return msg;
}
