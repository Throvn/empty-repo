/*
 * snap.c -- in-module helpers for fast snapshots of linear memory.
 *
 * A snapshot is stored as 4 KiB chunks.  To find the chunks that changed since the previous snapshot
 * without scanning from JS, the module keeps a SHADOW copy of the last snapshot image in a reserved
 * static region of its own linear memory and compares live memory against it with SIMD
 * (compile this file with -msimd128).  The shadow region itself is excluded from the image:
 *
 *    address a < SH_LO            -> shadow[a]
 *    SH_LO <= a < SH_HI           -> (the shadow itself; not part of the image)
 *    address a >= SH_HI           -> shadow[a - SH_HI + SH_LO]
 *
 * so the image of [0, brk) needs (brk - SHADOW_BYTES) bytes of shadow.
 */
#include <stdint.h>
#include <string.h>

#define EXPORT __attribute__((used, visibility("default")))
#define CHUNK 4096u
#define SHADOW_BYTES (96u << 20)         /* address space reserved (untouched pages cost nothing) */
#define MAX_CHUNKS 65536u

static unsigned char shadow[SHADOW_BYTES] __attribute__((aligned(4096)));
static uint32_t changed_list[MAX_CHUNKS];

#define SH_LO ((uint32_t)(uintptr_t)shadow)
#define SH_HI (SH_LO + SHADOW_BYTES)

EXPORT uint32_t snap_shadow_lo(void) { return SH_LO; }
EXPORT uint32_t snap_shadow_hi(void) { return SH_HI; }
EXPORT uint32_t snap_list_ptr(void) { return (uint32_t)(uintptr_t)changed_list; }
EXPORT uint32_t snap_capacity(void) { return SHADOW_BYTES; }

static inline int excluded(uint32_t c) { uint32_t a = c * CHUNK; return a >= SH_LO && a < SH_HI; }
static inline unsigned char *sh(uint32_t c) {
  uint32_t a = c * CHUNK;
  return shadow + (a < SH_LO ? a : a - SH_HI + SH_LO);
}

/* copy live chunks [c0, c1) into the shadow image */
EXPORT void snap_copy(uint32_t c0, uint32_t c1) {
  for (uint32_t c = c0; c < c1; c++) if (!excluded(c)) memcpy(sh(c), (void *)(uintptr_t)(c * CHUNK), CHUNK);
}

typedef int32_t v4 __attribute__((vector_size(16)));

/* chunks [0, n) that differ from the shadow: update the shadow, list their numbers, return how many */
EXPORT uint32_t snap_diff(uint32_t n) {
  uint32_t k = 0;
  for (uint32_t c = 0; c < n && k < MAX_CHUNKS; c++) {
    if (excluded(c)) continue;
    const v4 *a = (const v4 *)(uintptr_t)(c * CHUNK), *b = (const v4 *)sh(c);
    v4 acc = {0, 0, 0, 0};
    for (int i = 0; i < (int)(CHUNK / 16); i++) acc |= a[i] ^ b[i];
    if (acc[0] | acc[1] | acc[2] | acc[3]) { memcpy(sh(c), a, CHUNK); changed_list[k++] = c; }
  }
  return k;
}
