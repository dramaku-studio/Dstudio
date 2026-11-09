# Windows startup fix — CP-013.1

## Symptom

`npm run dev` fails in `scripts/start-local-console.mjs` with `Operator secrets file must have 0600 permissions`.

## Root cause

The app was checking POSIX mode bits (`stat.mode & 0o077`) on Windows. NTFS uses Windows ACLs, not POSIX 0600 permissions. File creation succeeded, but bootstrap rejected it.

## Fixed

- Windows accepts a regular, non-symlink operator secret file without interpreting `stat.mode` as NTFS ACLs.
- On macOS/Linux, POSIX 0600 protection remains mandatory.
- Local operator console continues to bind to `127.0.0.1` only; paid APIs remain off by default.
- Added regression tests for Windows semantics, POSIX permission enforcement, and symlinks.

## Windows steps

1. Back up your project. Download the patched project and replace your source files. Do not overwrite/delete `.local-private`, which contains local credentials.
2. In PowerShell, from the `dramasaku-studio` folder: `npm run dev`.
3. Open `http://127.0.0.1:4184`.
4. Keep this dev server local. If the computer is shared, use Windows Security > Properties > Security to restrict access to `.local-private` to your Windows account and trusted administrators. This fix does **not** verify NTFS ACLs and must not be treated as production secret management.

Do not post the operator token or API keys in chat/screenshots.
