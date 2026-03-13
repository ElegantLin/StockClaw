# ClawHub Skill Install Rules

- `clawhub` is an external CLI workflow for public skill registry installs. Use it through `exec_command` when the user wants to search, install, or update a public skill by name or slug.
- If `clawhub` is missing and the user explicitly wants a public ClawHub install or search flow, install the CLI first, then continue:
  - `npm i -g clawhub`
  - or `pnpm add -g clawhub`
  - verify with `clawhub --version`
- Do not describe or assume OpenClaw-style `<workspace>/skills` paths. In stock-claw there are only two supported skill roots:
  - project-local skills: `skills/<name>`
  - shared system skills: `~/.agents/skills/<name>`
- Default to the project-local root. For public installs, prefer running `clawhub` from the repository root so the resulting skill lands in `skills/`.
- Only target `~/.agents/skills` when the user explicitly asked for a global or shared install that should be visible across projects.
- After a `clawhub` install or update, verify that the target directory contains `SKILL.md` before telling the user it succeeded.
- Use `install_skill` only for a local filesystem path or git URL source. Do not use `install_skill` for a public registry slug when `clawhub` is the better fit.
- If `clawhub` is unavailable in the current runtime, say so briefly and fall back to `install_skill` only when the user gave a local path or git URL.
- Useful command patterns:
  - `clawhub search "<query>"`
  - `clawhub install <slug>`
  - `clawhub update <slug>`
