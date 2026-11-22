# Contributing

Thank you for helping. Bugs, ideas and questions are as welcome as code.

## Before you write code

For anything bigger than a small fix, open an issue or a discussion first and say what you want to change. That way nobody spends a weekend on a pull request that goes another way than the project.

## How a pull request is taken in

This repository is a public copy of the engine's part of a larger private repository, where the hosted product lives too. It is updated from there with each release. So a pull request here is not merged with the button:

1. You open it here, as usual. CI runs, and the CLA bot asks you to sign the [Contributor License Agreement](#the-contributor-license-agreement) once.
2. We review it here, in the pull request.
3. When it is ready, we apply your commits to the private repository, with you as their author.
4. The pull request is closed with a link to the commit. Your change appears here with the next release, and the changelog and the release commit name you (as a co-author, so GitHub counts it as your contribution).

## Working on the code

You need Node 24 and pnpm (`corepack enable`). Google Chrome runs the end-to-end tests.

```sh
pnpm install     # also installs a pre-commit hook: ESLint and Prettier on staged files
pnpm dev         # the playground
pnpm test        # unit tests (Vitest)
pnpm typecheck
pnpm lint
pnpm e2e         # Playwright in Chrome
```

- **Vocabulary first.** Use the words in [`CONTEXT.md`](CONTEXT.md): a Zone, not an area; a Level, not a floor.
- **Every edit is a Command.** Nothing changes a Document in place; Levels and Elements that did not change keep their object identity ([ADR-0005](docs/adr/0005-snapshot-history-and-reference-diffing.md)).
- **Tests come with the change.** `core` through Commands and query helpers; the renderers through their camera, scene and hit-test layers; the Editor through its controller with synthetic pointer and key events; what you see through Playwright in the playground.
- **Screenshots.** The Playwright screenshots have a baseline per platform. If your change moves pixels, say so in the pull request; we regenerate the Linux baselines.

## The Contributor License Agreement

The Editor is offered under the Business Source License and, to those who need it, under a commercial licence. To keep that possible, we need the right to license your contribution in both ways. The CLA gives us that right; you keep the copyright of your work, and it stays under the package's public licence here. Read it in [`CLA.md`](CLA.md) before you sign.
