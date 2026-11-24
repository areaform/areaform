import { apply, type Command } from './commands/index.ts';
import { checkInvariants, Rejection, type InvariantError } from './checks/invariants.ts';
import { removedRefs, type ElementRef } from './elements.ts';
import type { AreaformDocument } from './model.ts';

export type ExecResult = { ok: true } | { ok: false; errors: InvariantError[] };

/** What a Command would do, e.g. for the warning modal before a cascading delete. */
export type PreviewResult =
    { ok: true; removed: ElementRef[] } | { ok: false; errors: InvariantError[] };

export type ChangeListener = (doc: AreaformDocument, previous: AreaformDocument) => void;

/**
 * A group of Commands that becomes one undo step, e.g. a drag: each `exec` updates the Document
 * (and emits `change`) for live preview; `commit` keeps the result, `cancel` reverts it.
 */
export interface Transaction {
    exec(command: Command): ExecResult;
    commit(): void;
    cancel(): void;
}

export interface Editor {
    getDocument(): AreaformDocument;
    exec(command: Command): ExecResult;
    /** Dry-runs a Command: nothing changes and no event is emitted. */
    preview(command: Command): PreviewResult;
    begin(): Transaction;
    /**
     * Puts a whole other Document in place, e.g. an earlier version, as one undo step. Rejected,
     * with nothing changed, if it breaks an Invariant.
     */
    replace(next: AreaformDocument): ExecResult;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    /** Returns an unsubscribe function. */
    on(event: 'change', listener: ChangeListener): () => void;
}

export function createEditor(initial: AreaformDocument): Editor {
    let doc = initial;
    // Snapshots of earlier Documents; cheap thanks to structural sharing (ADR-0005).
    const past: AreaformDocument[] = [];
    let future: AreaformDocument[] = [];
    const listeners = new Set<ChangeListener>();
    let open = false;

    const setDocument = (next: AreaformDocument) => {
        const previous = doc;
        doc = next;
        for (const listener of listeners) listener(next, previous);
    };

    const compute = (
        command: Command,
    ): { ok: true; next: AreaformDocument } | { ok: false; errors: InvariantError[] } => {
        let next: AreaformDocument;
        try {
            next = apply(doc, command);
        } catch (error) {
            if (error instanceof Rejection) return { ok: false, errors: error.errors };
            throw error;
        }
        const errors = checkInvariants(next);
        return errors.length > 0 ? { ok: false, errors } : { ok: true, next };
    };

    const tryApply = (command: Command): ExecResult => {
        const result = compute(command);
        if (!result.ok) return result;
        setDocument(result.next);
        return { ok: true };
    };

    const record = (before: AreaformDocument) => {
        if (doc === before) return;
        past.push(before);
        future = [];
    };

    const assertNoTransaction = () => {
        if (open) throw new Error('A transaction is open; commit or cancel it first');
    };

    return {
        getDocument: () => doc,

        exec(command) {
            assertNoTransaction();
            const before = doc;
            const result = tryApply(command);
            record(before);
            return result;
        },

        preview(command) {
            const result = compute(command);
            return result.ok ? { ok: true, removed: removedRefs(doc, result.next) } : result;
        },

        begin() {
            assertNoTransaction();
            open = true;
            const before = doc;
            let active = true;
            const finish = () => {
                if (!active) throw new Error('This transaction is already finished');
                active = false;
                open = false;
            };
            return {
                exec(command) {
                    if (!active) throw new Error('This transaction is already finished');
                    return tryApply(command);
                },
                commit() {
                    finish();
                    record(before);
                },
                cancel() {
                    finish();
                    if (doc !== before) setDocument(before);
                },
            };
        },

        replace(next) {
            assertNoTransaction();
            const errors = checkInvariants(next);
            if (errors.length > 0) return { ok: false, errors };
            const before = doc;
            if (next !== doc) setDocument(next);
            record(before);
            return { ok: true };
        },

        undo() {
            assertNoTransaction();
            const previous = past.pop();
            if (!previous) return;
            future.push(doc);
            setDocument(previous);
        },

        redo() {
            assertNoTransaction();
            const next = future.pop();
            if (!next) return;
            past.push(doc);
            setDocument(next);
        },

        canUndo: () => past.length > 0,
        canRedo: () => future.length > 0,

        on(_event, listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
