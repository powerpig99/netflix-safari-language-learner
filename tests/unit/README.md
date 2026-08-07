# Unit Tests

Run from the repo root (Node 18+):

```bash
node --test tests/unit/*.test.js
```

Existing coverage:

- language utils (translation keys, model defaults/migration)
- translation queue batching / cache / generation guards / multi-batch flush
- control actions
- control keyboard
- control integration (attach/detach, visibility gates)
- dom utils (rendered video rect letterbox/pillarbox, local coords)
- overlay layout engine (scale, placement, exclusion lift, control bands)

Still thin or missing:

- auto-pause scheduling (page-owned; needs pure extracts or injection-level tests)
- adapter event normalization
- IndexedDB cache reads and writes
- full overlay scene layout engine (geometry helper is in place)
