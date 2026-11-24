import type { Editor, ElementRef, Id, Level, Vec2 } from '@areaform/core';
import type { LabelResolver, OverlayItem, Theme } from '@areaform/render-2d';
import type { Translator } from '../i18n/index.ts';
import type { DisplayUnits } from '../interaction/units.ts';
import type { Calibration, HerePick, KeyInput, PointerInput } from '../interaction/controller.ts';
import type { SnapContext, SnapResult } from '../interaction/snap.ts';

/** What a tool can use from the controller. */
export interface ToolContext {
    editor: Editor;
    levelId(): Id;
    level(): Level;
    /** Snaps on the current Level, or on `level` when given (e.g. without the dragged corner). */
    snap(
        input: PointerInput,
        extra?: Pick<SnapContext, 'anchor' | 'exclude'> &
            Partial<Pick<SnapContext, 'grid'>> & { level?: Level },
    ): SnapResult;
    setOverlay(overlay: OverlayItem[]): void;
    /** A CSS cursor over the plan, e.g. over a resize handle; null for the default. */
    setCursor(cursor: string | null): void;
    select(refs: ElementRef[]): void;
    selection(): ElementRef[];
    setHover(ref: ElementRef | null): void;
    /** Snap tolerance in metres at the current zoom. */
    tolerance(): number;
    /** Hit tolerance in metres at the current zoom. */
    hitTolerance(): number;
    zoom(): number;
    /** How lengths are shown and typed. */
    units(): DisplayUnits;
    /** The interface language, for labels and messages. */
    i18n(): Translator;
    /** The renderer's Theme: where Zone names and icons are drawn. */
    theme(): Theme;
    /** The host's Zone logos, which change where Zone names are drawn. */
    labelResolver(): LabelResolver | undefined;
    /** Always-on dimensions are shown, so tools need not label the selection themselves. */
    dimensionsOn(): boolean;
    /** A drag offset rounded to whole grid steps (unless the grid is off or `bypass`). */
    gridDelta(delta: Vec2, bypass: boolean): Vec2;
    /** Deletes the selection, or asks for confirmation when that would remove more. */
    requestDelete(): void;
    setMessage(message: string | null): void;
    setCalibration(calibration: Calibration | null): void;
    setHerePick(pick: HerePick | null): void;
    /** Returns to the Select tool. */
    endTool(): void;
    options: { wallThickness: number };
}

/** One editing mode. Each handler gets pointer input in plan coordinates. */
export interface Tool {
    pointerDown(input: PointerInput): void;
    pointerMove(input: PointerInput): void;
    pointerUp(input: PointerInput): void;
    /** Returns whether the tool handled the key. */
    keyDown(input: KeyInput): boolean;
    /** Abandons whatever is in progress, e.g. when switching tools. */
    cancel(): void;
    /** Redraws the tool's overlay after the selection or Document changed outside it. */
    refresh?(): void;
}
