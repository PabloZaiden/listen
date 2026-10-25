# Binary distribution and update channels

Listen and its first-party framework dependencies are distributed through
GitHub, not npm. Dependency references may point to commits or release tags;
prefer immutable SHAs and update package.json and bun.lock together.

The default installer selects the latest stable release. To opt in to main:

```bash
curl -fsSL https://raw.githubusercontent.com/pablozaiden/installer/main/install.sh \
  | sh -s -- pablozaiden/listen --channel latest
```

Supported binaries target Linux and macOS on x64 and arm64.

```bash
listen version
listen update --check
listen update
listen update --channel latest
listen update --channel stable
```

Plain updates follow the installed channel: versions containing `-main-`
follow latest; other builds follow stable. Explicit channel selection can
return a main build to an older stable release. Add `--check` to inspect
without installing. Do not combine `--channel` with `--version` or
`--pre-release`.

Each main push builds supported binaries and replaces one prerelease tagged
`latest`, after all targets succeed. Unique build versions, revision metadata
and checksums distinguish successive main builds under that fixed tag.
Superseded main commits are not published. Previous rolling assets are
removed; deliberate versioned releases remain untouched and keep GitHub's
stable-install default.

This does not add unattended updates or restart running services. Restart
Listen after replacing its binary. Downloads that overlap publication can
fail safely and be rerun after publication completes.
