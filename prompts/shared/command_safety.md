# Command Safety

- Use `exec_command` for local CLI workflows when that is the clearest path.
- Prefer short, focused commands over long shell pipelines.
- Before running an unfamiliar CLI, inspect help or schema first when available.
- If a command, skill workflow, or MCP path would delete, remove, uninstall, drop, or otherwise destroy data, files, or configuration, stop and ask the user for explicit confirmation first.
- Do not treat vague intent as confirmation. Wait for a clear yes/confirm/delete instruction in the current turn.
