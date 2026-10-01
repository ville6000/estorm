# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project follows [Semantic Versioning](https://semver.org/).

## Unreleased

- The editor is published to GitHub Pages on each release.
- The editor uses CodeMirror and has optional vim keybindings (toggle with
  the Vim button; `:w` saves).

## 0.1.0

First public version.

- Notation: flows, reactions (`then`), read models, aggregates, external
  systems, hotspots, sections (`== Context ==`), reactions by event name
  (`when`), delayed reactions (`after … unless …`) and schedules (`every …:`).
- Layout: time left to right, bounded contexts as lanes side by side, links
  between contexts.
- Browser editor as one offline HTML file, `estorm.html`.
- CLI: `estorm render`, `check` and `serve`.
- Docker image for CI.
