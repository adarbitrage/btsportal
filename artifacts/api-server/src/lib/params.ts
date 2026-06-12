/**
 * Express 5's `@types/express-serve-static-core` types route params as
 * `string | string[]` (to accommodate wildcard/splat routes). The vast
 * majority of our handlers use simple named params (`:id`) that are always a
 * single string at runtime. This helper narrows the value back to `string`
 * for those call sites without changing any runtime behavior.
 */
export function getParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
