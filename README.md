# ampcode-connector

Route [AmpCode](https://ampcode.com) through your existing Claude Code, Codex CLI & Gemini CLI subscriptions.

```bash
bunx ampcode-connector setup    # point AmpCode → proxy
bunx ampcode-connector login    # authenticate providers
bunx ampcode-connector          # start
```

Requires [Bun](https://bun.sh) 1.3+. Config at `./config.yaml` or `~/.config/ampcode-connector/config.yaml` — see [`config.example.yaml`](config.example.yaml).

`setup` writes `amp.url` to Amp's canonical settings file (`~/.config/amp/settings.json`, or `AMP_SETTINGS_FILE` if set). Amp tokens are stored in `~/.local/share/amp/secrets.json`.

## License

[MIT](LICENSE)
