import type { KeyValueStorage } from './storage.ts';

/** Where the hosted playground sends people who want their plan on their own site. */
export const SIGN_UP_URL = 'https://app.areaform.app/sign-up';
const PRICING_URL = 'https://areaform.app/pricing/';

/**
 * Only the playground on areaform.app offers to sign up: a copy run from the public repository, or
 * in the e2e tests, is someone's own and shows no advert.
 */
export const offersSignUp = (hostname = globalThis.location?.hostname) =>
    hostname === 'areaform.app';

const CLOSED_KEY = 'areaform:playground:sign-up-closed';

export const signUpClosed = (storage: KeyValueStorage) => {
    try {
        return storage.getItem(CLOSED_KEY) === '1';
    } catch {
        return false;
    }
};

/**
 * "Put this plan on your site": a card over the bottom left corner, out of the top bar (which must
 * stay one row), shown once the person has done something with a plan. × closes it for good in
 * this browser.
 */
export function SignUpCard({
    storage,
    onClose,
}: {
    storage: KeyValueStorage;
    onClose: () => void;
}) {
    const close = () => {
        try {
            storage.setItem(CLOSED_KEY, '1');
        } catch {
            // Closed for this visit only.
        }
        onClose();
    };
    return (
        <aside className="sign-up" aria-labelledby="sign-up-h">
            <p id="sign-up-h" className="sign-up-title">
                Put this plan on your site
            </p>
            <p className="sign-up-text">
                Publish it and paste one snippet. Free for one place, no card needed.
            </p>
            <div className="sign-up-actions">
                <a className="sign-up-primary" href={SIGN_UP_URL}>
                    Sign up free
                </a>
                <a className="sign-up-link" href={PRICING_URL}>
                    Pricing
                </a>
            </div>
            <button className="sign-up-close" aria-label="Close" onClick={close}>
                ×
            </button>
        </aside>
    );
}
