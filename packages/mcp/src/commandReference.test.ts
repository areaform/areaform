import type { Command } from '@areaform/core';
import { describe, expect, it } from 'vitest';
import { COMMAND_EXAMPLES, commandReference, LEVEL } from './commandReference.ts';
import { createDraftSession } from './session.ts';

describe('the Command reference', () => {
    it('applies, example by example, to a new Draft', () => {
        const session = createDraftSession();
        const levelId = session.create({ name: 'Hall', kind: 'exhibition' }).levels[0]!.id;
        for (const { command } of COMMAND_EXAMPLES) {
            const real = JSON.parse(JSON.stringify(command).replaceAll(LEVEL, levelId)) as Command;
            expect(session.apply([real]), command.type).toMatchObject({ ok: true });
        }
    });

    it('lists each example with its note', () => {
        const text = commandReference();
        for (const { command } of COMMAND_EXAMPLES) expect(text).toContain(JSON.stringify(command));
        expect(text.split('\n- ')).toHaveLength(COMMAND_EXAMPLES.length);
    });
});
