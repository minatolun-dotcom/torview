"""Shim for qBittorrent's novaprinter module.

Collects results emitted by a search plugin's prettyPrinter calls so the
Node backend can serialize them as JSON.
"""
_results = []

def prettyPrinter(item):
    if isinstance(item, dict):
        _results.append(dict(item))
    else:
        _results.append(item)

def prettyPrinterSingleLine(item):
    prettyPrinter(item)

def get_results():
    return list(_results)

def clear():
    _results.clear()
