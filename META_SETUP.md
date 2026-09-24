# Meta Lead Ads connection

The application implements encrypted credentials, page subscription, paginated form discovery, field mapping, assignment, authenticated webhook ingestion and paginated backfill. Live Meta delivery requires credentials and permissions from the clinic's own Meta app; local tests do not prove that external configuration.

1. Deploy the app on an HTTPS origin and set `NEXT_PUBLIC_APP_URL` to that origin.
2. Generate `INTEGRATION_ENCRYPTION_KEY` once with `openssl rand -hex 32`. Keep it server-only, identical on every replica, and back it up separately from the database. Replacing it makes saved credentials unreadable; re-enter all credentials if it is lost.
3. Set `META_GRAPH_API_VERSION` to the supported `vNN.0` version selected in your Meta app. No version is guessed by the application.
4. As clinic admin, open **Administration → Meta Lead Ads**. Save the app ID, app secret, and a random webhook verification token of at least 24 characters.
5. Configure the Meta app's Page webhook callback to `https://<clinic-origin>/api/webhooks/meta`, using that verification token and the `leadgen` field. Configure the app and page's lead access under Meta's current requirements.
6. Enter the page ID and a page access token issued by the same app. Connecting verifies the token's app, checks page identity, and subscribes the app to the page's lead events. Expired or revoked tokens require reconnecting.
7. Sync forms. New forms start disabled. Configure field mapping, assignment (round robin, specific active executive, or unassigned), and enable the intended forms. Form sync and backfill expose a next-batch action rather than downloading everything at once.
8. Submit a test lead using Meta's Lead Ads Testing Tool. Confirm it appears once in Leads, reaches the intended executive, and has its expected contact details. Retry the delivery or import the same form to verify deduplication. Test the full call → booking → reception visit path before using real campaigns.

Webhook signatures are checked against the original request bytes using the app secret before lead retrieval. Unknown or disabled forms are ignored. Transient delivery failures return 503 for retry; the leadgen ID is unique in the database. The app fetches lead details directly from Meta and does not trust webhook contact fields. Secrets remain in service-only tables as AES-256-GCM ciphertext; browser sessions cannot read them.

Changing the app ID disables previous forms and removes saved page tokens. Reconnect the pages and enable the desired forms again. Backfill imports 25 submissions per batch; retrying a batch does not create duplicate enquiries.

The lead field names are checked against [Meta's official Business SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/lead.py). Consult [Meta's retrieving-leads documentation](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/) for app review, permissions and page access requirements. These are account-specific and must be verified in the clinic's Meta account.
