# Rust Agent-Supervision Cheatsheet

*Compressed from a learning session, 2026-05-12. Goal: read agent-generated Rust well enough to catch bad patterns — not to write Rust yourself.*

---

## Toolchain (one-time)

```fish
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# DO NOT use `brew install rust` — gives a static install with no toolchain management.
```

This installs:
- `rustup` — toolchain manager
- `rustc` — compiler
- `cargo` — build / dep / test / run
- `rustfmt`, `clippy` — formatter and linter

## Commands you'll use

| Command | Purpose | When |
|---|---|---|
| `cargo new <name>` | New project | Starting fresh |
| `cargo check` | Type-check only, no codegen | **Inner loop** — fastest feedback |
| `cargo clippy` | Lint (check + ~700 idiom checks) | **Main supervision tool** |
| `cargo test` | Run tests | Verifying |
| `cargo run` | Compile + run | Executing locally |
| `cargo build --release` | Optimized build | Shipping |
| `cargo fmt` | Auto-format | Before committing |
| `cargo add <crate>` | Add dependency | Avoid hand-editing `Cargo.toml` |

## Watch mode

```fish
cargo install --locked bacon
cd <project>
bacon clippy     # default to clippy as the watch target
```

Use **`bacon`**, not `cargo-watch` (its own README says it's "on life support" and points users at bacon).

Press `c` for clippy, `t` for test, `w` for clippy-all, `q` to quit. `bacon.toml` per-project config supported, hot-reloaded.

> **Note**: don't run `bacon` *and* let the agent run `cargo check` at the same time — they'll fight over Cargo's project lock. Pick one. Most agent setups expect the agent to invoke cargo itself; bacon is for *you* watching in parallel.

---

## Project shape

```
my-project/
├── Cargo.toml          # manifest: deps, features, edition, version
├── Cargo.lock          # locked dep versions (commit for bins; not for libs)
├── src/
│   └── main.rs         # binary entry point
│       OR
│   └── lib.rs          # library entry point
└── tests/              # integration tests (optional)
```

For libraries: add `lib.rs`. For binaries: `main.rs`. Workspaces (multi-crate) are common in real projects — agent sets up `[workspace]` in the top-level `Cargo.toml`.

---

## Reading vocabulary

| Syntax | Meaning |
|---|---|
| `fn foo(x: T) -> R` | function; `->` is return type |
| `use path::to::thing;` | import |
| `let x = ...` | immutable binding (like JS `const`) |
| `let mut x = ...` | mutable binding (like JS `let`) |
| `mut` | makes things mutable; required to mutate |
| `Vec<T>` | growable list (Python `list[T]`) |
| `Option<T>` | `Some(t)` or `None` (Python `Optional[T]`) |
| `Result<T, E>` | `Ok(t)` or `Err(e)` — failure made explicit |
| `()` | the *unit type* (Python `None`-ish; TS `void`) |
| `&T` | borrowed read-only reference |
| `&mut T` | exclusive mutable reference |
| `String` / `&str` | owned / borrowed string |
| `PathBuf` / `&Path` | owned / borrowed path |
| `Vec<T>` / `&[T]` | owned / borrowed slice |
| `?` | propagate error: if `Err`, return; if `Ok(v)`, unwrap |
| `\|args\| body` | closure (lambda) |
| `\|\|` | closure with no args |
| `name!(...)` | macro invocation (compile-time code generation) |
| `#[derive(Foo)]` | generates `impl Foo for ThisType` at compile time |
| `#[cfg(test)]` | only compile when running tests |
| `pub` | public visibility |
| `mod foo;` | declare a module |
| `Self` | "this type" |
| `self`, `&self`, `&mut self` | method receivers (instance methods) |

### Key foundational concepts

- **No GC, no manual free.** Compiler inserts `drop()` at scope ends. Deterministic, zero runtime overhead.
- **Ownership.** Every value has exactly one owner. Moves transfer ownership; borrows (`&T`) loan a view.
- **Borrow checker.** At compile time, proves no use-after-free and no data races. Refuses to compile if it can't prove.
- **No inheritance.** Structs can't extend. Code reuse is via **traits** (interfaces with optional default methods).
- **Expressions, not statements.** `if/else`, blocks, `match` all evaluate to values. The last expression in a block (no `;`) is the block's value — including function returns.
- **Trait methods require the trait in scope.** `use std::io::BufRead;` to call `.lines()` on a reader. The compiler errors with "no method named X" when you forget.

---

## Idiomatic patterns (what GOOD looks like)

### Error handling
- Helper functions return precise error types: `io::Result<T>`, `Result<T, MyError>`.
- Binary `main` returns `anyhow::Result<()>`.
- Use `?` for propagation; `.with_context(|| format!("...{var}"))?` to add context at each layer.
- For libraries, define typed errors with `thiserror`. **Don't use `anyhow` in library APIs.**

### Borrowing
- **Default to `&T`.** Reach for ownership only when downstream actually needs it.
- Functions take `&str` not `String` for parameters (callers can pass either).
- Functions take `&[T]` not `Vec<T>` for slice-like inputs.
- "Pick the weakest access you need."

### Construction
- `Type::new()` for the simplest case.
- `Type::with_<thing>(...)` for variants taking config.
- `Type::from(other)` for conversions (paired with `From` trait).
- `Type::try_new()` / `try_from` for fallible variants (returns `Result`).
- For many optional fields: builder pattern. `Foo::builder().with_x(1).with_y(true).build()`.

### Iteration
- `for x in &collection` — normal. Borrowing.
- `for x in collection` — consumes. Used when downstream needs ownership.
- `for x in &mut collection` — mutable borrow.
- Iterator chains are idiomatic: `vec.iter().filter(...).map(...).collect::<Vec<_>>()`.

### Tests
- Inline unit tests at the bottom of the same file:
  ```rust
  #[cfg(test)]
  mod tests {
      use super::*;
      use std::io::Cursor;

      #[test]
      fn it_works() {
          assert_eq!(count_lines(Cursor::new("a\nb\n")).unwrap(), 2);
      }
  }
  ```
- `Cursor::new(...)` for in-memory I/O testing — pairs beautifully with generic `<R: BufRead>` signatures.
- **Doc tests** in `///` comments for public APIs — they get run by `cargo test` and keep docs verified-correct.
- Integration tests in top-level `tests/` directory (each file is a separate crate, only sees the public API).

---

## Code smells / red flags in agent output

### Critical (almost always wrong)
| Smell | Why it's bad | What to ask |
|---|---|---|
| `.unwrap()` in non-test code | Panics on error, no recovery | "What should happen if this fails?" |
| `.expect("...")` outside tests | Same; very slightly better with message | Same |
| `unsafe { ... }` in business logic | Bypasses safety. Should be confined to FFI bindings, std-library internals | "What's the underlying constraint? Could this be done safely?" |
| Tests pass but `cargo clippy` fails | Agent skipped the lint check | Run clippy; address every warning |

### Style smells (often wrong)
| Smell | Why it's bad |
|---|---|
| `.clone()` on every line | Agent dodging the borrow checker. Each clone allocates. |
| Reflexive `Arc<Mutex<T>>` | Over-defensive. Often a borrow suffices. |
| `Box<T>` everywhere | Usually unnecessary; only needed for trait objects, recursive types, large stack values. |
| Custom `macro_rules!` | Almost always overcomplicated. Use a function, trait, or existing crate. |
| `make()`, `create()`, `build_new()` constructors | Non-idiomatic. Use `new`, `with_*`, `from`, `try_new`. |
| `String` parameter where `&str` would work | Forces caller to allocate. |
| `Vec<T>` parameter where `&[T]` would work | Same. |
| `Box<dyn Error>` returned from a library | Should be a typed error via `thiserror`. |
| `let mut x` that's never reassigned | Drop the `mut`. (clippy will catch.) |
| Missing `#[derive(Debug)]` on public types | Convention is to derive Debug everywhere. |
| Magic numbers / strings | Should be named `const FOO: usize = 42;` |
| Tests only in `tests/` when `#[cfg(test)] mod tests` would work | Agent treating Rust like Python. Inline `mod tests` is the Rust way. |
| `?` everywhere with no `.with_context()` | Errors propagate but lose context. |

### Subtle smells
- **No clippy run.** Agent's diff should pass `cargo clippy` clean (or with intentional `#[allow(...)]`).
- **Trait imports in `use` for no obvious reason.** Often intentional — trait must be in scope for methods. Not a smell.
- **`type` aliases used like a renamed module.** Sometimes valid; sometimes obscuring.
- **`#[allow(dead_code)]` without explanation.** What's the dead code, and why?

### When `unsafe` IS legitimate
- FFI bindings to C libraries (PyO3, napi-rs, native libraries)
- Implementing primitive data structures (rare in application code)
- Hardware access (embedded, OS kernel)
- Specific verified-by-hand performance optimizations

If `unsafe` appears outside these categories, treat it as a strong red flag.

---

## Ecosystem cheat sheet

Common crates an agent should reach for. If they pick something off-brand for a standard task, ask why.

| Task | De facto crate |
|---|---|
| CLI args | `clap` |
| Serialization | `serde` + `serde_json` / `serde_yaml` / `bincode` |
| Async runtime | `tokio` |
| Error handling (binary) | `anyhow` |
| Error definition (library) | `thiserror` |
| HTTP client | `reqwest` |
| Web framework | `axum` (modern) or `actix-web` (more mature) |
| Database (async) | `sqlx` |
| Database (sync, ORM) | `diesel` |
| Structured logging | `tracing` |
| Data parallelism | `rayon` |
| Python bindings | `pyo3` |
| Node/JS bindings | `napi-rs` |

---

## Pre-review tooling pass

Before any line-by-line read, run these. They mechanically eliminate most smells:

```fish
cargo check         # does it compile?
cargo clippy        # is it idiomatic?
cargo test          # do tests pass?
cargo fmt --check   # is it formatted?
```

If the agent didn't run these, ask it to. If they fail, the agent should fix before you spend reviewer time.

## Reading-a-PR checklist

1. **Tooling pass** — all four green?
2. **`.unwrap()` / `.expect()` / `unsafe`** — scan for these, pause on each.
3. **Function signatures** — `&T` where appropriate, or unnecessarily `T`?
4. **Error context** — every `?` chain has `.with_context(...)` somewhere upstream?
5. **Tests** — inline `#[cfg(test)] mod tests`? Cover the public surface?
6. **`Cargo.toml` changes** — new crates reputable (see ecosystem table)?
7. **Reinvention** — did the agent rebuild something a standard crate provides?
8. **Naming** — `new`/`with_*`/`from`/`try_*` for constructors?

---

## Memory model in one paragraph

Variables own their values. Values are freed at the closing brace of their owner's scope (compiler inserts `drop()` — deterministic, no GC). You can transfer ownership by *moving* (`let y = x;` makes `y` the owner and `x` unusable), or you can loan a *borrow* via `&` (cheap, compile-time-checked, no ownership transfer). `&T` is read-only; `&mut T` is exclusive read-write. The borrow checker proves at compile time that no borrow outlives its owner and no mutable borrow coexists with any other borrow. Multiple owners require opt-in reference counting (`Rc<T>` for single-threaded, `Arc<T>` for shared across threads).

## Compiler error vocabulary

- "*expected `X`, found `Y`*" — type mismatch. Often a missing `&`, missing `.to_string()`, etc.
- "*no method named `foo` found*" — usually means a trait isn't in scope. Add the `use` for the trait.
- "*cannot borrow `x` as mutable, as it is not declared as mutable*" — add `mut` to the `let`.
- "*value moved here, but borrow occurs later*" — you consumed when you should have borrowed.
- "*does not live long enough*" — a borrow outlives the owner. Restructure or own.
- "*cannot move out of borrowed content*" — you tried to consume something you only have a borrow to.
