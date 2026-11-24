import type { AreaformDocument, Id, Level } from '@areaform/core';
import { useContext, useState, type DragEvent, type KeyboardEvent } from 'react';
import { levelDropMove, levelsTopDown } from '../document/levelOrder.ts';
import { formatLength } from '../interaction/units.ts';
import { useI18n } from './i18n.ts';
import { UnitsContext } from './LengthInput.tsx';

/** Where a dragged Level would land: next to `targetId`, above or below it. */
interface DropMark {
    targetId: Id;
    place: 'above' | 'below';
}

/**
 * The Levels as a vertical list, highest first, with "+ Level" above and "+ Level below" under
 * it. When any Level has a Level Group, each group gets its own heading (ungrouped Levels last,
 * under "No group"). Click a Level to edit it; drag it within its group, or press Alt+↑ / Alt+↓
 * on it, to move it up or down the stack.
 */
export function LevelSwitcher({
    doc,
    currentId,
    onSelect,
    onAdd,
    onMove,
}: {
    doc: AreaformDocument;
    currentId: Id;
    onSelect: (levelId: Id) => void;
    /** Adds a Level to the current Level's group, on top or below its lowest Level. */
    onAdd: (at: 'top' | 'bottom') => void;
    /** Moves a Level this many places up or down its group, as one undo step. */
    onMove: (levelId: Id, direction: 'up' | 'down', steps: number) => void;
}) {
    const units = useContext(UnitsContext);
    const i18n = useI18n();
    const [dragged, setDragged] = useState<Id | null>(null);
    const [mark, setMark] = useState<DropMark | null>(null);

    const placeAt = (e: DragEvent<HTMLElement>): 'above' | 'below' => {
        const box = e.currentTarget.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2 ? 'above' : 'below';
    };
    const endDrag = () => {
        setDragged(null);
        setMark(null);
    };
    const onKeyDown = (level: Level) => (e: KeyboardEvent) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        // Keep the editor's own arrow-key handling out of it.
        e.preventDefault();
        e.stopPropagation();
        onMove(level.id, e.key === 'ArrowUp' ? 'up' : 'down', 1);
    };

    const list = (levels: Level[], label: string) => (
        <ol className="af-level-list" aria-label={label}>
            {levelsTopDown(levels).map((l) => {
                const marked = mark?.targetId === l.id ? mark.place : undefined;
                return (
                    <li
                        key={l.id}
                        className="af-level-row"
                        draggable
                        data-drop={marked}
                        data-dragging={dragged === l.id || undefined}
                        onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', l.id);
                            setDragged(l.id);
                        }}
                        onDragOver={(e) => {
                            // Same group only: elsewhere the drop is not allowed (no preventDefault).
                            const level = doc.levels.find((x) => x.id === dragged);
                            if (!level || level.group !== l.group) return;
                            const place = placeAt(e);
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            if (marked !== place) setMark({ targetId: l.id, place });
                        }}
                        onDragLeave={() => {
                            if (mark?.targetId === l.id) setMark(null);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            const id = dragged ?? e.dataTransfer.getData('text/plain');
                            const drop = id ? levelDropMove(doc, id, l.id, placeAt(e)) : null;
                            if (id && drop) onMove(id, drop.direction, drop.steps);
                            endDrag();
                        }}
                        onDragEnd={endDrag}
                    >
                        <button
                            className="af-button af-level-button"
                            aria-pressed={l.id === currentId}
                            onClick={() => onSelect(l.id)}
                            onKeyDown={onKeyDown(l)}
                        >
                            {l.name}
                        </button>
                        <span className="af-muted af-level-elevation">
                            {formatLength(l.elevation, units, i18n)}
                        </span>
                    </li>
                );
            })}
        </ol>
    );

    const grouped = doc.levels.some((l) => l.group !== undefined);
    const groups: { name: string; levels: Level[] }[] = grouped
        ? [...new Set(doc.levels.flatMap((l) => (l.group === undefined ? [] : [l.group])))]
              .sort()
              .map((name) => ({ name, levels: doc.levels.filter((l) => l.group === name) }))
        : [];
    const ungrouped = doc.levels.filter((l) => l.group === undefined);
    if (grouped && ungrouped.length > 0)
        groups.push({ name: i18n.t('levels.noGroup'), levels: ungrouped });

    return (
        <div className="af-stack af-levels">
            <div className="af-buttons">
                <button className="af-button" onClick={() => onAdd('top')}>
                    {i18n.t('levels.add')}
                </button>
            </div>
            {grouped
                ? groups.map((group) => (
                      <div key={group.name} role="group" aria-label={group.name}>
                          <div className="af-muted af-group-name">{group.name}</div>
                          {list(group.levels, i18n.t('levels.inGroup', { group: group.name }))}
                      </div>
                  ))
                : list(doc.levels, i18n.t('levels.list'))}
            <div className="af-buttons">
                <button className="af-button" onClick={() => onAdd('bottom')}>
                    {i18n.t('levels.addBelow')}
                </button>
            </div>
        </div>
    );
}
