/**
 * services/playPurchases.ts — verify a Google Play purchase token.
 *
 * Talks to the Play Developer API with the app's service account:
 *   - one-time products: purchases.products.get
 *   - subscriptions:      purchases.subscriptionsv2.get
 *   - acknowledge:        purchases.products.acknowledge
 *
 * The service account needs "Release manager" on the app in the Play
 * Console → Users and permissions. The service account JSON is passed
 * in base64 (env GOOGLE_PLAY_SA_KEY) to match the rest of the config.
 *
 * JWT signing uses `jose` (pinned to v5 in package.json overrides —
 * jose v6 is ESM-only and the server compiles to CommonJS).
 */

import { SignJWT, importPKCS8 } from 'jose';

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface VerifyPurchaseResult {
  verified: boolean;
  reason: string;
  productId: string;
  /** true for a one-time product (never expires). */
  lifetime: boolean;
  expiresAt: string | null;
  autoRenewing: boolean;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * Exchange the service account's JWT for an OAuth access token.
 */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const key = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience(sa.token_uri ?? TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function decodeSa(base64: string): ServiceAccount {
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as ServiceAccount;
}

/**
 * Verify a purchase token.
 *
 * Tries the one-time-product endpoint first, then the subscription
 * endpoint — Play's own recommendation is to check both, because the
 * product id alone does not tell you which kind of product it is.
 */
export async function verifyPlayPurchase(opts: {
  packageName: string;
  productId: string;
  purchaseToken: string;
  serviceAccountKey: string;
}): Promise<VerifyPurchaseResult> {
  const sa = decodeSa(opts.serviceAccountKey);
  const accessToken = await getAccessToken(sa);
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${opts.packageName}`;

  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // --- one-time product ---
  const productUrl =
    `${base}/purchases/products/${encodeURIComponent(opts.productId)}` +
    `/tokens/${encodeURIComponent(opts.purchaseToken)}`;
  const productRes = await fetch(productUrl, { headers });

  if (productRes.ok) {
    const purchase = (await productRes.json()) as {
      purchaseState?: number;
      consumptionState?: number;
      acknowledgementState?: number;
      autoRenewing?: boolean;
      orderId?: string;
    };

    // Play purchaseState: 0=PURCHASED, 1=CANCELED, 2=PENDING (not paid).
    if (purchase.purchaseState !== 0) {
      return {
        verified: false,
        reason: `purchaseState=${purchase.purchaseState ?? 'unknown'}`,
        productId: opts.productId,
        lifetime: true,
        expiresAt: null,
        autoRenewing: false,
      };
    }

    // A one-time purchase that is already CONSUMED was consumed by a
    // previous request — still a valid paid entitlement, so it passes.
    // (consumptionState 1 = consumed, 2 = consumption deferred.)

    // Acknowledge if needed. Play REFUNDS unacknowledged purchases after
    // 3 days, so a lifetime purchase that is never acknowledged is a
    // purchase that disappears.
    if (purchase.acknowledgementState !== 1) {
      const ackRes = await fetch(
        `${base}/purchases/products/${encodeURIComponent(opts.productId)}` +
          `/tokens/${encodeURIComponent(opts.purchaseToken)}:acknowledge`,
        { method: 'POST', headers, body: JSON.stringify({}) },
      );
      if (!ackRes.ok && ackRes.status !== 400) {
        throw new Error(`Play acknowledge failed: HTTP ${ackRes.status} ${await ackRes.text()}`);
      }
    }

    return {
      verified: true,
      reason: 'purchased',
      productId: opts.productId,
      lifetime: true,
      expiresAt: null,
      autoRenewing: false,
    };
  }

  // --- subscription (v2) ---
  const subUrl =
    `${base}/purchases/subscriptionsv2/tokens/${encodeURIComponent(opts.purchaseToken)}`;
  const subRes = await fetch(subUrl, { headers });

  if (subRes.ok) {
    const sub = (await subRes.json()) as {
      subscriptionState?: string;
      lineItems?: Array<{ productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean } }>;
    };

    // Subscription states that mean the user has access.
    const ACTIVE = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
      'SUBSCRIPTION_STATE_CANCELED', 'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_PENDING']);
    const PAID = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
      'SUBSCRIPTION_STATE_CANCELED']);

    const state = sub.subscriptionState ?? 'UNKNOWN';
    if (!PAID.has(state)) {
      return {
        verified: false,
        reason: `subscriptionState=${state}`,
        productId: opts.productId,
        lifetime: false,
        expiresAt: null,
        autoRenewing: false,
      };
    }

    const item = sub.lineItems?.[0];
    const expiresAt = item?.expiryTime ?? null;
    const autoRenewing = item?.autoRenewingPlan?.autoRenewEnabled ?? false;

    return {
      verified: true,
      reason: state,
      productId: item?.productId ?? opts.productId,
      lifetime: false,
      expiresAt,
      autoRenewing,
    };
  }

  // Neither endpoint matched — surface both bodies so the failure is
  // diagnosable instead of a bare 400.
  const productBody = await productRes.text();
  const subBody = await subRes.text();
  throw new Error(
    `Play purchase lookup failed: products=${productRes.status} ${productBody.slice(0, 200)} ` +
      `subscriptions=${subRes.status} ${subBody.slice(0, 200)}`,
  );
}
