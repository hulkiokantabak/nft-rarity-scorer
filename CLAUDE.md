# NFT Rarity Scorer

Browser tool to score NFT collections by trait rarity using the OpenSea public API.

## Stack
- Vanilla JavaScript
- Single HTML file (`index.html`) — all CSS, JS, and HTML embedded (~2,958 lines)
- OpenSea API (`https://api.opensea.io`) — requires a user-supplied API key, stored in browser `localStorage`
- No framework, no build step

## How to Run
- Open `index.html` directly in browser — no server or build required
- Requires internet (calls OpenSea API at runtime)

## Deployment
- GitHub repo: https://github.com/hulkiokantabak/nft-rarity-scorer
- Live site: https://hulkiokantabak.github.io/nft-rarity-scorer/
- Deploy: push `index.html` to `master` — GitHub Pages serves it directly

## Architecture
Everything is in `index.html`:

- **Standard tiers**: Common / Uncommon / Rare / Legendary with predefined thresholds
- **Custom tiers**: Up to 10 user-defined tiers with names, hex colors, point values, and percentage thresholds
- **Display modes**: Listed items only OR full collection scan
- **URL state**: Collection slug + tier config serialised into query params — `?ct=[...]` where `ct` is `JSON.stringify`'d custom tier array — makes configs shareable as links
- **CSV export**: Scores downloadable directly from the browser
- API results cached in-memory to minimise repeat calls during a session

## Notes
- Strict Content Security Policy — only OpenSea API calls permitted; no external scripts
- Default theme: dark. User preference saved to `localStorage`
- Custom tier URL param (`ct`) is a JSON array — handle parse errors gracefully when reading from URL
- OpenSea API requires a user-supplied API key (no wallet); rate limits apply for heavy scans
- GoatCounter analytics at bottom of file
