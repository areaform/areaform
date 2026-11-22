# Undo history keeps Document snapshots; changes are found by reference, not patches

Documents are immutable with structural sharing: a Command returns a new Document that reuses every unchanged Level and Element object. Undo history therefore stores previous Documents (cheap, and cannot drift out of sync the way inverse patches can), and the `change` event carries `(doc, previous)` — consumers such as `render-2d` find what changed by reference comparison (`level !== prevLevel`, then per Element), which is cheaper than interpreting a JSON Patch.

We originally planned Commands to emit patches with inverse patches for undo. We dropped that because future collaboration will use Yjs's own update format, so a home-grown patch format would be replaced anyway. A host that needs a minimal diff (e.g. to sync a backend) uses the `diff(prev, next)` helper, which walks the Documents by reference and lists added, updated and removed rows (Levels, Elements, Connections).

**Consequence:** structural sharing is a contract, not an optimisation — a Command must never copy an unchanged Level or Element, or consumers will redraw it needlessly.
