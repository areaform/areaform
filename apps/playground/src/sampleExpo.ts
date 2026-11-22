// A small exhibition built entirely through Commands, so it exercises the real editing paths.
import {
    createEditor,
    createSpace,
    type Command,
    type AreaformDocument,
    type Ring,
    type TextTarget,
    type Vec2,
} from '@areaform/core';

const rect = (x: number, y: number, w: number, h: number): Ring => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
];

const STATUSES = ['available', 'sold', 'reserved', 'sold', 'available', 'sold'] as const;

export function sampleExpo(): AreaformDocument {
    const space = createSpace({ name: 'Expo Hall A', kind: 'exhibition', size: [60, 36] });
    // A fixed id, like the other Levels', so a `?here=level-1:x,y` link keeps working on reload.
    const doc = { ...space, levels: [{ ...space.levels[0]!, id: 'level-1' }] };
    const editor = createEditor(doc);
    const L1 = doc.levels[0]!.id;
    const run = (command: Command) => {
        const result = editor.exec(command);
        if (!result.ok) throw new Error(`${command.type}: ${JSON.stringify(result.errors)}`);
    };

    // Exterior walls along the Outline, then the two entrances on the south wall.
    const corners: Vec2[] = [
        [0, 0],
        [60, 0],
        [60, 36],
        [0, 36],
    ];
    corners.forEach((a, i) => {
        run({
            type: 'wall.add',
            levelId: L1,
            id: `ext-${i}`,
            a,
            b: corners[(i + 1) % 4]!,
            thickness: 0.3,
        });
    });
    for (const [i, offset] of [15, 45].entries()) {
        run({
            type: 'opening.add',
            levelId: L1,
            opening: {
                id: `entrance-${i + 1}`,
                kind: 'entrance',
                width: 4,
                host: 'wall',
                wallId: 'ext-0',
                offset,
            },
        });
    }

    // Meeting room in the north-west corner; its walls T-join the exterior walls and split them.
    run({ type: 'wall.add', levelId: L1, id: 'room-s', a: [0, 28], b: [12, 28], thickness: 0.15 });
    run({ type: 'wall.add', levelId: L1, id: 'room-e', a: [12, 28], b: [12, 36], thickness: 0.15 });
    run({
        type: 'opening.add',
        levelId: L1,
        opening: {
            id: 'room-door',
            kind: 'door',
            width: 1,
            host: 'wall',
            wallId: 'room-s',
            offset: 9,
        },
    });
    run({
        type: 'zone.add',
        levelId: L1,
        zone: {
            id: 'meeting',
            shape: { outer: rect(0, 28, 12, 8) },
            label: 'Meeting room',
            category: 'room',
        },
    });

    // Four rows of ten 3 × 3 m booths: two back-to-back pairs with an aisle between.
    let n = 0;
    for (const [row, y] of [6, 9, 18, 21].entries()) {
        for (let col = 0; col < 10; col++) {
            const id = `${'ABCD'[row]}-${col + 1}`;
            run({
                type: 'zone.add',
                levelId: L1,
                zone: {
                    id,
                    shape: { outer: rect(6 + col * 3, y, 3, 3) },
                    label: id,
                    category: 'booth',
                    walkAround: true,
                    data: { status: STATUSES[n++ % STATUSES.length] },
                },
            });
        }
    }

    run({
        type: 'zone.add',
        levelId: L1,
        zone: {
            id: 'fire-lane',
            shape: { outer: rect(0, 13.5, 60, 2) },
            label: 'Fire lane',
            category: 'aisle',
            restricted: true,
        },
    });
    run({
        type: 'zone.add',
        levelId: L1,
        zone: {
            id: 'cafe',
            shape: { outer: rect(46, 26, 10, 7) },
            label: 'Café',
            category: 'cafe',
            style: { fill: '#f3d9c4', stroke: '#b9845a' },
        },
    });
    // Two sponsors by the east entrance, in the free south-east corner. Both are `sponsor`: the
    // first shows that category's one-colour icon, the second the host's full-colour logo in the
    // View (the playground's `demoLabels`), to compare the two.
    for (const [id, label, x] of [
        ['sponsor', 'Sponsor', 40],
        ['partner', 'Partner', 50],
    ] as const) {
        run({
            type: 'zone.add',
            levelId: L1,
            zone: { id, shape: { outer: rect(x, 3, 8, 6) }, label, category: 'sponsor' },
        });
    }
    for (const [i, [x, y]] of (
        [
            [15, 12.4],
            [30, 12.4],
            [45, 12.4],
            [15, 25],
            [30, 25],
            [45, 25],
        ] as Vec2[]
    ).entries()) {
        run({
            type: 'obstacle.add',
            levelId: L1,
            obstacle: { id: `col-${i}`, kind: 'column', shape: { outer: rect(x, y, 0.6, 0.6) } },
        });
    }

    // A gallery over the northern half, reached by an elevator and stairs.
    run({ type: 'level.add', id: 'gallery', name: 'Gallery', elevation: 6, height: 4 });
    run({ type: 'level.setOutline', levelId: 'gallery', outline: { outer: rect(0, 18, 60, 18) } });
    run({
        type: 'zone.add',
        levelId: 'gallery',
        zone: {
            id: 'lounge',
            shape: { outer: rect(4, 24, 20, 10) },
            label: 'VIP lounge',
            category: 'lounge',
        },
    });
    // Visitor services in a basement: a Zone for each category with a built-in icon.
    run({ type: 'level.add', id: 'services', name: 'Services', at: 'bottom', height: 4 });
    run({ type: 'level.setOutline', levelId: 'services', outline: { outer: rect(0, 0, 60, 36) } });
    const services: [category: string, label: string][] = [
        ['wc', 'WC'],
        ['cafe', 'Café'],
        ['kitchen', 'Kitchen'],
        ['stage', 'Stage'],
        ['info', 'Info'],
        ['registration', 'Registration'],
        ['first-aid', 'First aid'],
        ['lounge', 'Lounge'],
        ['meeting-room', 'Meeting room'],
        ['checkout', 'Checkout'],
        ['fitting-room', 'Fitting room'],
        ['loading-dock', 'Loading dock'],
    ];
    for (const [i, [category, label]] of services.entries()) {
        run({
            type: 'zone.add',
            levelId: 'services',
            zone: {
                id: `services-${category}`,
                // Four to a row, rows from the north wall down; the lift is in the east.
                shape: { outer: rect(4 + (i % 4) * 13, 26 - Math.floor(i / 4) * 11, 10, 8) },
                label,
                category,
            },
        });
    }

    run({
        type: 'connection.add',
        connection: {
            id: 'lift',
            kind: 'elevator',
            name: 'Lift',
            stops: ['services', L1, 'gallery'].map((levelId) => ({
                levelId,
                shape: { outer: rect(56.5, 30, 2, 2) },
            })),
            bidirectional: true,
            accessible: true,
        },
    });
    run({
        type: 'connection.add',
        connection: {
            id: 'stairs',
            kind: 'stairs',
            name: 'Main stairs',
            stops: [
                { levelId: L1, shape: { outer: rect(40, 16, 4, 3) } },
                { levelId: 'gallery', shape: { outer: rect(40, 18, 4, 3) } },
            ],
            bidirectional: true,
        },
    });

    // Written in English, offered in the playground's other interface languages too, so the View
    // shows the plan's own names in the language picked. Not yet checked by native speakers.
    run({
        type: 'space.update',
        changes: { languages: { default: 'en', others: ['pl', 'uk', 'ru'] } },
    });
    const translations: [target: TextTarget, pl: string, uk: string, ru: string][] = [
        [{ kind: 'space' }, 'Hala Expo A', 'Виставкова зала A', 'Выставочный зал A'],
        [{ kind: 'level', levelId: L1 }, 'Poziom 1', 'Рівень 1', 'Уровень 1'],
        [{ kind: 'level', levelId: 'gallery' }, 'Galeria', 'Галерея', 'Галерея'],
        [{ kind: 'level', levelId: 'services' }, 'Usługi', 'Сервіси', 'Сервисы'],
        [{ kind: 'connection', connectionId: 'lift' }, 'Winda', 'Ліфт', 'Лифт'],
        [
            { kind: 'connection', connectionId: 'stairs' },
            'Schody główne',
            'Головні сходи',
            'Главная лестница',
        ],
        ...(
            [
                ['meeting', 'Sala konferencyjna', 'Переговорна', 'Переговорная'],
                ['fire-lane', 'Droga pożarowa', 'Пожежний проїзд', 'Пожарный проезд'],
                ['cafe', 'Kawiarnia', 'Кав’ярня', 'Кафе'],
                ['sponsor', 'Sponsor', 'Спонсор', 'Спонсор'],
                ['partner', 'Partner', 'Партнер', 'Партнёр'],
            ] as const
        ).map(([zoneId, pl, uk, ru]): [TextTarget, string, string, string] => [
            { kind: 'zone', levelId: L1, zoneId },
            pl,
            uk,
            ru,
        ]),
    ];
    for (const [target, ...texts] of translations)
        for (const [i, language] of (['pl', 'uk', 'ru'] as const).entries())
            run({ type: 'text.set', target, language, text: texts[i]! });

    return editor.getDocument();
}
