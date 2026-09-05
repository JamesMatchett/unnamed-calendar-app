# calandder.com

Static files for the domain. Deploy the folder as-is (S3 + CloudFront is the
obvious fit given the rest of the stack); nothing here needs a server.

- `get/` — where every app invite points. Detects the phone and sends people to
  TestFlight (now) or the store (later). **Set the three links in the script
  before deploying.**
- `.well-known/apple-app-site-association` — lets iOS open
  `https://calandder.com/join/<token>` straight into the app (§7.1). Replace
  `TEAMID` with the Apple Team ID, serve it with `Content-Type:
  application/json` and **no** `.json` extension, over HTTPS, at the root.
  Android's equivalent (`assetlinks.json`) goes beside it once there is a
  signing key to put in it.

Until this is deployed, the `calandder://` scheme still opens the app from a
link on a phone that has it; the universal link simply lands on the page.
