# End-to-end reports

`npm run e2e:live` deploys a fresh contract to GenLayer, runs the functional and adversarial scenarios against it
and writes three files here:

| File | Purpose |
|---|---|
| `e2e-<timestamp>-live.md` | the report people read |
| `e2e-<timestamp>-live.json` | the same data for tooling |
| `e2e-<timestamp>-live.log` | full console output |
| `LATEST-live.md` | copy of the newest live report |

Simulation runs (`npm run e2e:dry`) write files ending in `-simulation`. They are git-ignored on purpose: they are not
evidence about the contract. A report whose banner says BLOCKED or INTERRUPTED is not evidence either, and
`npm run e2e:commit` refuses to commit it.
