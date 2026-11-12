"""YTS (YIFY) search plugin - uses the public JSON API."""
import json
import urllib.parse
from novaprinter import prettyPrinter
from helpers import retrieve_url

TRACKERS = [
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.coppersurfer.tk:6969',
    'udp://glotorrents.pw:6969/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://torrent.gresille.org:80/announce',
]

def search(what, category='all'):
    query = urllib.parse.quote(what)
    url = 'https://yts.mx/api/v2/list_movies.json?query_term=%s&limit=40&sort_by=seeds' % query
    data, _ = retrieve_url(url)
    if not data:
        return
    try:
        obj = json.loads(data)
    except Exception:
        return
    movies = (obj.get('data') or {}).get('movies') or []
    for m in movies:
        title = m.get('title') or ''
        year = m.get('year')
        name_base = '%s (%s)' % (title, year) if year else title
        for t in (m.get('torrents') or []):
            h = t.get('hash')
            if not h:
                continue
            mag = 'magnet:?xt=urn:btih:%s&dn=%s' % (h, urllib.parse.quote(name_base))
            for tr in TRACKERS:
                mag += '&tr=' + urllib.parse.quote(tr)
            prettyPrinter({
                'link': mag,
                'name': '%s [%s]' % (name_base, t.get('quality') or ''),
                'size': t.get('size'),
                'seeds': t.get('seeds') or 0,
                'leech': t.get('peers') or 0,
                'engine_url': 'https://yts.mx',
                'desc_link': m.get('url') or '',
            })
