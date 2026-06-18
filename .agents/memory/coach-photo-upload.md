---
name: Coach photo upload storage
description: How coach photos are stored/resolved after the upload-to-object-storage feature
---
Coach photos can be set two ways from the admin Coach Profiles editor: paste an absolute http(s) URL (legacy) OR upload an image to object storage.

**Storage representation:** `coachesTable.photoUrl` stores EITHER an absolute `http(s)://` URL OR an internal object-storage path like `/objects/uploads/<uuid>` (env-independent; never store the `/api/storage` prefix or BASE_URL).

**Rendering rule:** every place that renders a coach photo as an `<img src>` MUST run the value through `resolveCoachPhotoUrl` (in `artifacts/portal/src/lib/coaches-admin-api.ts`): absolute URLs pass through; `/objects/...` becomes `${BASE_URL}api/storage/objects/...`. Currently used in admin CoachProfiles.tsx and member Coaching.tsx. Add it to any new surface.

**Backend:** `parsePhotoUrl` in `artifacts/api-server/src/routes/admin-coaches.ts` accepts `/objects/...` verbatim in addition to http(s) URLs.

**Upload flow:** `uploadCoachPhoto(file)` does the standard 2-step presigned flow (POST /api/storage/uploads/request-url → PUT to GCS) and returns the objectPath. Uploaded objects land in PRIVATE_OBJECT_DIR, served by the auth-gated `/api/storage/objects/*` route — fine because both admins and members are logged in when viewing photos (img requests carry the session cookie same-origin).

**Why:** keeps paste-a-URL working as a fallback while making uploads environment-portable. Did NOT install the Uppy `object-storage-web` lib — plain fetch is enough for a single file input.
