"""Minimal shim for qBittorrent's helpers module."""
import urllib.request
import urllib.error
import re

USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

def retrieve_url(url, timeout=30, headers=None):
    hdrs = {'User-Agent': USER_AGENT}
    if headers:
        hdrs.update(headers)
    try:
        req = urllib.request.Request(url, headers=hdrs)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
            try:
                text = data.decode('utf-8', errors='replace')
            except Exception:
                text = data.decode('latin-1', errors='replace')
            return (text, resp.geturl())
    except Exception as e:
        return ('', url)

def download_file(url, filename, timeout=60):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        with open(filename, 'wb') as f:
            f.write(data)
        return True
    except Exception:
        return False

def getHtml(url, timeout=30):
    return retrieve_url(url, timeout)[0]
