---
name: vi.spyOn on an already-mocked export is unsafe
description: vi.spyOn(module, "fn") when fn is already a vi.mock() factory vi.fn() replaces the module's live binding; mockRestore() does not reliably undo it, silently orphaning any stale top-level const captured elsewhere in the file.
---

`vi.spyOn(mod, "fn")` swaps the object identity behind `mod.fn` with a distinct
wrapper, even when `fn` is already a `vi.fn()` created by a `vi.mock()`
factory. Calling `.mockRestore()` afterward does **not** reliably put back a
working mock — later reads of `mod.fn` can end up not being a mock function at
all (`.getMockImplementation is not a function`).

**Why:** discovered while debugging a cross-test pollution bug: two tests in a
large suite did `vi.spyOn(ghlCoachingCalendar, "getFreeSlots")` without ever
restoring (or restoring incorrectly), which permanently replaced the module's
exported `getFreeSlots` binding. Any other test that captured
`ghlCoachingCalendar.getFreeSlots` into a top-level `const` at
describe-collection time (before the spy ran) silently diverged from what the
route code actually called at request time — assertions passed against a
mock the route never touched.

**How to apply:** when a module property is already a `vi.fn()` (from a
`vi.mock()` factory), never `vi.spyOn()` it just to read `.mock.calls` or set
an implementation. Instead read the live binding directly and use
`.mockClear()` / `.mockImplementation()` / `.mockReset()` in place:
```ts
const fn = mod.getFreeSlots as unknown as ReturnType<typeof vi.fn>;
fn.mockClear();
```
Never capture the mock into a stale top-level `const` before other tests in
the file might swap its identity — always re-read `mod.fn` fresh inside each
test (or via a small helper function) if there's any chance another test in
the same file still uses `vi.spyOn`/`mockRestore` on it.
