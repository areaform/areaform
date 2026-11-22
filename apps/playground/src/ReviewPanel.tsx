import type { Editor, ElementRef, AreaformDocument } from '@areaform/core';
import { flagTargetExists, importFlags, resolveFlag, type ImportFlag } from './draftImport.ts';

const KIND_NAMES: Record<ElementRef['kind'], string> = {
    level: 'Outline',
    connection: 'Connection',
    stop: 'Stop',
    wallNode: 'Wall Node',
    wall: 'Wall',
    opening: 'Opening',
    zone: 'Zone',
    obstacle: 'Obstacle',
    underlay: 'Underlay',
};

/** What the reviewer sees for a flag: the kind, and the Zone's label or the Level's name. */
function describe(doc: AreaformDocument, { ref }: ImportFlag): string {
    if (ref.kind === 'level') {
        const name = doc.levels.find((l) => l.id === ref.id)?.name;
        return name ? `Outline of ${name}` : 'Outline';
    }
    const label =
        ref.kind === 'zone'
            ? doc.levels.find((l) => l.id === ref.levelId)?.zones.find((z) => z.id === ref.id)
                  ?.label
            : undefined;
    return `${KIND_NAMES[ref.kind]} ${label ?? ref.id}`;
}

/**
 * The Import Flags of a Draft as a checklist: Show selects the flagged Element, Done takes the
 * flag off the list as an undoable edit. Nothing is shown once every flag is done.
 */
export function ReviewPanel({
    doc,
    editor,
    onShow,
}: {
    doc: AreaformDocument;
    editor: Editor;
    onShow: (ref: ElementRef) => void;
}) {
    const flags = importFlags(doc);
    if (flags.length === 0) return null;
    return (
        <aside className="review panel" aria-label="Review import">
            <h2>Review import ({flags.length})</h2>
            <p className="muted">
                The import was unsure of these. Check each against the Source image, fix it if
                needed, then mark it done.
            </p>
            <ul className="review-list">
                {flags.map((flag, i) => {
                    const exists = flagTargetExists(doc, flag);
                    return (
                        <li key={i}>
                            <button
                                className="link"
                                disabled={!exists}
                                onClick={() => onShow(flag.ref)}
                            >
                                {describe(doc, flag)}
                            </button>
                            <span>{flag.reason}</span>
                            {!exists && <span className="muted">No longer in the plan.</span>}
                            <button
                                onClick={() => {
                                    const resolve = resolveFlag(editor.getDocument(), flag);
                                    if (resolve) editor.exec(resolve);
                                }}
                            >
                                Done
                            </button>
                        </li>
                    );
                })}
            </ul>
        </aside>
    );
}
