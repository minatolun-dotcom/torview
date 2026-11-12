# Custom search providers

Drop a `.js` file here exporting:

```js
module.exports = {
  name: 'MyProvider',
  public: true,
  search: async (query) => [{ title, size, seeds, peers, magnet, link, provider }]
}
```

Restart the backend to load. Built-in providers (via torrent-search-api) are always
enabled and cover ThePirateBay, 1337x, YTS, EZTV, Limetorrents, Rarbg, etc.
