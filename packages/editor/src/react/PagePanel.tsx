// The sidebar's For your page section (ADR-0030): ready lines for a client's page that moves the
// plan's camera through `element.areaform`, by id: the Level shown, the Zone selected, a point
// picked on the plan, and the 3D camera as it is. Each Viewpoint's line is in Viewpoints.
import type { ElementRef, Level } from '@areaform/core';
import type { Renderer3D } from '@areaform/render-3d';
import type { EditorController } from '../interaction/controller.ts';
import { cameraLiteral, lookAtZoneLine, setLevelLine } from '../document/pageLines.ts';
import { CopyButton } from './CopyButton.tsx';
import { Copyable } from './HereValue.tsx';
import { useI18n } from './i18n.ts';

export function PagePanel({
    controller,
    level,
    selection,
    renderer3d,
}: {
    controller: EditorController | null;
    level: Level;
    selection: readonly ElementRef[];
    /** The 3D view while it is shown: the camera to copy. Points are picked in 2D. */
    renderer3d: Renderer3D | null;
}) {
    const i18n = useI18n();
    const only = selection.length === 1 ? selection[0] : undefined;
    const zone =
        only?.kind === 'zone' && only.levelId === level.id
            ? level.zones.find((z) => z.id === only.id)
            : undefined;
    return (
        <div className="af-page-lines">
            <p className="af-muted">{i18n.t('page.intro')}</p>
            <div className="af-page-line">
                <span className="af-page-label">{i18n.t('page.level')}</span>
                <Copyable
                    value={setLevelLine(level)}
                    label={i18n.t('page.level')}
                    copyLabel={i18n.t('here.copy')}
                />
            </div>
            <div className="af-page-line">
                <span className="af-page-label">{i18n.t('page.zone')}</span>
                {zone ? (
                    <Copyable
                        value={lookAtZoneLine(zone)}
                        label={i18n.t('page.zone')}
                        copyLabel={i18n.t('here.copy')}
                    />
                ) : (
                    <p className="af-muted">{i18n.t('page.selectZone')}</p>
                )}
            </div>
            <div className="af-page-line">
                <span className="af-page-label">{i18n.t('page.point')}</span>
                {renderer3d || !controller ? (
                    <p className="af-muted">{i18n.t('page.pickIn2d')}</p>
                ) : (
                    <div className="af-buttons">
                        <button
                            type="button"
                            className="af-button"
                            onClick={() => controller.startHerePick('page')}
                        >
                            {i18n.t('page.pick')}
                        </button>
                    </div>
                )}
            </div>
            <div className="af-page-line">
                <span className="af-page-label">{i18n.t('page.camera')}</span>
                {renderer3d ? (
                    <div className="af-buttons">
                        <CopyButton
                            text={() => cameraLiteral(renderer3d.getCamera())}
                            label={i18n.t('page.copyCamera')}
                            title={i18n.t('page.copyCameraTitle')}
                        />
                    </div>
                ) : (
                    <p className="af-muted">{i18n.t('page.cameraIn3d')}</p>
                )}
            </div>
        </div>
    );
}
