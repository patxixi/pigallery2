# PiGallery2 — `vps-redesign` fork

This is a fork of [bpatrik/pigallery2](https://github.com/bpatrik/pigallery2), maintained for an online photo
gallery running next to [OpenCloud](https://opencloud.eu/) on very small VPSs (1 vCPU, 1 GB RAM, photos read
from an S3 bucket through rclone). The branch `vps-redesign` follows upstream `master` with a small set of commits on top
(rebased regularly).

For everything else (features, installation, configuration, documentation), see the
[upstream README](https://github.com/bpatrik/pigallery2#readme) and the
[upstream documentation](https://bpatrik.github.io/pigallery2/).

**Native installation.** This fork runs natively, without Docker: Node.js 22, a release built against the Debian
libvips (HEIC support), a systemd service with memory and CPU limits, behind nginx. Upstream recommends Docker and
states that the native installation is not officially supported; this fork keeps it working and tests it on every
release (see the notes for small servers below).

### Changes compared to upstream `master`

| Area | Change | Upstream status |
|---|---|---|
| **Timeline** | New "Timeline" view: every photo, newest first, grouped by month and day, with a year scrubber next to the scrollbar. Can be the start page (new navbar link type `timeline`), keeps its scroll position on reload, larger tiles on tablets/desktops, optional search filter (`/timeline?q=…`); opening a face shows the timeline of that person. | Proposed in #1201 (closed: kept in this fork); scrubber date idea in #1209 |
| **Selection mode** | Select several photos and folders (tap, or drag across tiles, "All"), then run extension buttons on the whole selection (new `bulk`, `bulkApiPath` and `bulkOnly` options of media buttons: one call for the selection instead of one per photo), or share the photos (originals downloaded, GPS data stripped, then the system share sheet). | Fork only |
| **Lightbox** | Extension media buttons are also shown in the lightbox top controls (e.g. a "favourite" star while viewing a photo full screen). | Fork only |
| **Albums** | The albums page answers right away with the cached albums and refreshes outdated ones in the background (single refresh at a time); it used to recompute every album after any data change, which took tens of seconds on a small VPS. | Reported in #1202 |
| **OIDC** | New setting `Users.oidc.idTokenSignedResponseAlg` to force the ID token algorithm (OpenCloud/LibreGraph Connect advertises RS256 but signs with PS256). | Reported in #1197 |
| **Extensions** | `contains` / `!contains` operators in the media button `metadataFilter`, and in-place refresh of a photo when only its metadata changed. | Merged upstream (#1200) |
| **Version label** | The running version (release, branch@commit, build date) is shown at the bottom of the menu. It is read from `package.json` when the page is served, so no frontend rebuild is needed to update it. The `create-release` task also records the branch (`PG2_BUILD_BRANCH` for detached checkouts). | Fork only |
| **Translations** | French strings for the timeline, the selection bar and the OIDC setting. | Fork only |

A lightbox fix found along the way (scroll lock released when the lightbox is destroyed while open) was merged upstream (#1210).

### Notes for small servers

- **Database upgrade.** The database structure version went from 41 (release 3.5.2) to 45 in upstream `master`. On a version change,
  PiGallery2 empties its database (keeping only the users) and indexes all photos again; albums and sharing links are lost.
  We build the new database on a faster machine from a local copy of the photos, copy the users, albums, sharings and
  favourite persons from the old database, then install it with the release.
- **RAW test image.** At startup the diagnostics decode `test.arw` (24 MB). With the Debian libvips 8.16 build of sharp
  (libraw loader) this takes about 600 MB of memory; under a 260 MB systemd `MemoryHigh` limit the server freezes.
  If you have no RAW photos, remove `arw` from `Media.Photo.supportedFormats`.
- **Test under the server's limits.** Every release is started first in a container with the limits of the VPS
  (`--cpus=0.6 --memory=320m --memory-swap=448m`, `node --max-old-space-size=160`) with the real configuration and database.
  With ~26,000 photos it peaks at about 130 MB.
