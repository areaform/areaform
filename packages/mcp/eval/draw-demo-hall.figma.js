// Draws the demo hall (eval/demo-hall.json) in Figma the way a designer might, at 20 px per metre:
// run it with the Figma MCP's use_figma in an empty Design file. Layer names are a designer's,
// not a convention the import relies on. Plan Y points up; Figma's points down.
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
const hex = (h) => ({
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
});
const PX = 20,
    M = 60,
    H = 40;
const X = (x) => M + x * PX;
const Y = (y) => M + (H - y) * PX;
const frame = figma.createFrame();
frame.name = 'Hall A — floor plan';
frame.resize(M * 2 + 60 * PX, M * 2 + 40 * PX);
frame.x = 100;
frame.y = 100;
frame.fills = [{ type: 'SOLID', color: hex('FFFFFF') }];
const ids = [];
const add = (n, name) => {
    n.name = name;
    frame.appendChild(n);
    ids.push(n.id);
    return n;
};
// A rectangle given in plan metres (x0, y0 lower-left; x1, y1 upper-right).
const rect = (name, x0, y0, x1, y1, fill, stroke) => {
    const n = figma.createRectangle();
    n.resize(Math.max((x1 - x0) * PX, 0.01), Math.max((y1 - y0) * PX, 0.01));
    n.x = X(x0);
    n.y = Y(y1);
    n.fills = [{ type: 'SOLID', color: hex(fill) }];
    if (stroke) {
        n.strokes = [{ type: 'SOLID', color: hex(stroke) }];
        n.strokeWeight = 1;
        n.strokeAlign = 'INSIDE';
    }
    return add(n, name);
};
const text = (name, s, cx, cy, size) => {
    const n = figma.createText();
    n.fontName = { family: 'Inter', style: 'Regular' };
    n.characters = s;
    n.fontSize = size;
    n.fills = [{ type: 'SOLID', color: hex('2B2B29') }];
    n.x = cx - n.width / 2;
    n.y = cy - n.height / 2;
    return add(n, name);
};
const area = (name, label, x0, y0, x1, y1, fill, stroke, size = 11) => {
    rect(name, x0, y0, x1, y1, fill, stroke);
    text(name + ' label', label, X((x0 + x1) / 2), Y((y0 + y1) / 2), size);
};

rect('Floor', 0, 0, 60, 40, 'F4F2EC');
area('Fire lane', 'Fire lane', 0.5, 18, 59.5, 21, 'F7C9C9', 'C46A6A', 14);
area('Registration', 'Registration', 25, 2, 35, 6, 'BFE3DA', '5EA596');
const BOOTH = 'FFE6A3',
    EDGE = 'B08A2E';
const doubleRow = (letters, x0, y0) =>
    letters.forEach((letter, r) => {
        for (let i = 0; i < 7; i++) {
            const x = x0 + i * 3,
                y = y0 + r * 3;
            area('Booth ' + letter + (i + 1), letter + (i + 1), x, y, x + 3, y + 3, BOOTH, EDGE);
        }
    });
doubleRow(['A', 'B'], 4, 8);
doubleRow(['C', 'D'], 35, 8);
doubleRow(['E', 'F'], 4, 25);
doubleRow(['G', 'H'], 35, 25);
area('Booth I1', 'I1', 27, 8, 33, 14, BOOTH, EDGE);
area('Booth I2', 'I2', 27, 25, 33, 31, BOOTH, EDGE);
area('Booth P1', 'P1', 4, 2, 10, 6, BOOTH, EDGE);
area('Booth P2', 'P2', 50, 2, 56, 6, BOOTH, EDGE);
for (const x of [15, 30, 45])
    for (const y of [16.5, 22.5]) rect('Column', x - 0.3, y - 0.3, x + 0.3, y + 0.3, '6B6B67');

// Walls 0.3 m thick on the hall's edge.
const t = 0.15;
rect('Wall', -t, -t, 60 + t, t, '2E2E2B');
rect('Wall', 60 - t, -t, 60 + t, 40 + t, '2E2E2B');
rect('Wall', -t, 40 - t, 60 + t, 40 + t, '2E2E2B');
rect('Wall', -t, -t, t, 40 + t, '2E2E2B');
// Openings centred where the plan has them: entrances (3 m) in the south wall, emergency exits
// (1.8 m) in the others.
for (const x of [20, 40]) {
    rect('Entrance', x - 1.5, -0.4, x + 1.5, 0.4, 'FFFFFF', '2E2E2B');
    text('Entrance label', 'ENTRANCE', X(x), Y(0) + 22, 10);
}
for (const x of [10, 50]) rect('Emergency exit', x - 0.9, 39.6, x + 0.9, 40.4, '2FA35A');
rect('Emergency exit', -0.4, 29.1, 0.4, 30.9, '2FA35A');
rect('Emergency exit', 59.6, 29.1, 60.4, 30.9, '2FA35A');

// Dimensions, as a designer marks them.
const line = (name, x, y, w, h) => {
    const n = figma.createRectangle();
    n.resize(w, h);
    n.x = x;
    n.y = y;
    n.fills = [{ type: 'SOLID', color: hex('77776F') }];
    return add(n, name);
};
line('Dimension 60 m', X(0), 28, 60 * PX, 1);
text('Dimension 60 m label', '60 m', X(30), 16, 12);
line('Dimension 40 m', 28, Y(40), 1, 40 * PX);
text('Dimension 40 m label', '40 m', 14, Y(20), 12);

return { frameId: frame.id, created: ids.length, size: [frame.width, frame.height] };
