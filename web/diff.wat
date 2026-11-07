;; diff.wasm -- SIMD "which 4 KiB chunks of the process memory changed?" helper.
;;
;; Two imported memories (multi-memory proposal):
;;   $live   = linear memory of pdftex.wasm
;;   $shadow = image of the last snapshot (+ an output list of u32 chunk numbers after the image)
;; diff(start, count, out): for chunks [start, start+count): if live != shadow, copy live -> shadow
;; and append the chunk number to the u32 list at shadow[out...].  Returns how many chunks differed.
(module
  (import "env" "live" (memory $live 1))
  (import "env" "shadow" (memory $shadow 1))
  (func (export "diff") (param $start i32) (param $count i32) (param $out i32) (result i32)
    (local $c i32) (local $p i32) (local $e i32) (local $n i32) (local $q i32) (local $d v128)
    (local.set $c (local.get $start))
    (local.set $e (i32.add (local.get $start) (local.get $count)))
    (block $done
      (loop $chunks
        (br_if $done (i32.ge_u (local.get $c) (local.get $e)))
        (local.set $p (i32.shl (local.get $c) (i32.const 12)))
        (local.set $d (v128.const i32x4 0 0 0 0))
        (local.set $q (i32.const 0))
        (loop $cmp                                   ;; OR of XORs over the 256 lanes of the chunk
          (local.set $d (v128.or (local.get $d)
            (v128.xor (v128.load $live (i32.add (local.get $p) (local.get $q)))
                      (v128.load $shadow (i32.add (local.get $p) (local.get $q))))))
          (local.set $q (i32.add (local.get $q) (i32.const 16)))
          (br_if $cmp (i32.lt_u (local.get $q) (i32.const 4096))))
        (if (v128.any_true (local.get $d))
          (then
            (memory.copy $shadow $live (local.get $p) (local.get $p) (i32.const 4096))
            (i32.store $shadow (i32.add (local.get $out) (i32.shl (local.get $n) (i32.const 2))) (local.get $c))
            (local.set $n (i32.add (local.get $n) (i32.const 1)))))
        (local.set $c (i32.add (local.get $c) (i32.const 1)))
        (br $chunks)))
    (local.get $n)))
