/**
 * Pure substitution utilities for brand token replacement.
 *
 * These functions have no side effects and carry no imports from DB, Express,
 * or any platform-specific module — they are safe to import from any layer
 * (server, shared lib, or browser bundle).
 */

/**
 * Token pattern: `{{ key }}` where `key` may contain word chars and dots
 * (e.g. `brand`, `brand.short`, `brand.short.possessive`).
 *
 * Whitespace inside the braces is optional.  Unknown tokens are left as the
 * original literal `{{token}}` — never silently replaced with an empty string.
 */
const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Replace every `{{token}}` in `text` whose key exists in `tokens`.
 *
 * Tokens whose key is NOT present in the map are left byte-identical so the
 * caller can detect them (rather than silently losing content).
 *
 * @param text   - Source string, possibly containing `{{token}}` placeholders.
 * @param tokens - Flat map of token key → replacement value.
 * @returns      A new string with known tokens substituted.
 */
export function substituteString(
  text: string,
  tokens: Record<string, string>,
): string {
  return text.replace(TOKEN_RE, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : match,
  );
}

/**
 * A minimal representation of a TipTap / ProseMirror document node.
 *
 * Only the fields we care about are typed; any additional fields are preserved
 * via the index signature.
 */
export interface TipTapNode {
  type?: string;
  text?: string;
  content?: TipTapNode[];
  marks?: unknown[];
  attrs?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Walk a cloned TipTap document and substitute brand tokens only in leaf
 * text nodes (`node.type === "text"`).
 *
 * Rules that are deliberately NOT touched:
 *   - `marks`  — mark type names / mark attrs (including href)
 *   - `attrs`  — node attributes (links, images, etc.)
 *   - `type`   — node type strings
 *   - Any field other than `text` on text nodes
 *
 * The input document is never mutated.  The returned document is a deep clone
 * with only `node.text` values modified where tokens were found.
 *
 * @param doc    - TipTap JSON document root.
 * @param tokens - Flat token map (from `brandTokens(slug)`).
 * @returns      A new document with text-node tokens substituted.
 */
export function substituteTipTapDoc(
  doc: TipTapNode,
  tokens: Record<string, string>,
): TipTapNode {
  const cloned = JSON.parse(JSON.stringify(doc)) as TipTapNode;
  walkNode(cloned, tokens);
  return cloned;
}

function walkNode(node: TipTapNode, tokens: Record<string, string>): void {
  if (node.type === "text" && typeof node.text === "string") {
    node.text = substituteString(node.text, tokens);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walkNode(child, tokens);
    }
  }
}
