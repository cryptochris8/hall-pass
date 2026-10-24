// Registry of GPU resources that are module-level caches shared by many objects (cached
// geometries, canvas textures, decal / toon materials). Generic disposal helpers must skip
// them: disposing a shared resource frees its GPU buffers / program, so the next object using
// it re-uploads it (and may recompile a shader) mid-game — a hitch every zone sign stream-out
// (QA 2026-09). Register a cache entry with markShared() when it is created.
const SHARED = new WeakSet<object>();

/** Mark a cached resource as shared (never disposed per instance). Returns it. */
export function markShared<T extends object>(resource: T): T {
  SHARED.add(resource);
  return resource;
}

/** True if the resource is a shared cache entry. */
export function isShared(resource: object | null | undefined): boolean {
  return !!resource && SHARED.has(resource);
}
