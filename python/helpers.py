"""Minimal shim for qBittorrent's helpers module."""
import urllib.request
import urllib.error
import urllib.parse
import gzip
import io
import re
import html

USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

# some plugins do `from helpers import headers`
headers = {'User-Agent': USER_AGENT}

urlencode = urllib.parse.urlencode
quote = urllib.parse.quote
unquote = urllib.parse.unquote


def enable_socks_proxy(enable=True):
    # no-op in this environment
    return None


def htmlentitydecode(s):
    if not isinstance(s, str):
        try:
            s = s.decode('utf-8', errors='replace')
        except Exception:
            s = str(s)
    return html.unescape(s)


def retrieve_url(url, timeout=8, request_data=None, headers=None, data=None):
    if data is not None and request_data is None:
        request_data = data
    hdrs = {'User-Agent': USER_AGENT}
    if headers:
        hdrs.update(headers)
    try:
        if request_data is not None:
            if isinstance(request_data, str):
                request_data = request_data.encode('utf-8')
            req = urllib.request.Request(url, data=request_data, headers=hdrs)
        else:
            req = urllib.request.Request(url, headers=hdrs)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if raw[:2] == b'\x1f\x8b':
                try:
                    with io.BytesIO(raw) as stream, gzip.GzipFile(fileobj=stream) as gz:
                        raw = gz.read()
                except Exception:
                    pass
            try:
                charset = 'utf-8'
                ct = resp.getheader('Content-Type', '') or ''
                if 'charset=' in ct:
                    charset = ct.split('charset=', 1)[1].split(';')[0].strip()
                text = raw.decode(charset, errors='replace')
            except Exception:
                text = raw.decode('utf-8', errors='replace')
            return text
    except Exception:
        return ''


def getHtml(url, timeout=30):
    return retrieve_url(url, timeout=timeout)


def download_file(url, filename=None, timeout=60):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        if filename:
            with open(filename, 'wb') as f:
                f.write(data)
            return True
        return data
    except Exception:
        return False if filename else ''
