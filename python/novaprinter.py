"""Shim for qBittorrent's novaprinter module.

Collects results emitted by a search plugin's prettyPrinter calls so the
Node backend can serialize them as JSON.
"""
_results = []

_UNITS = {
    'B': 1, 'BYTE': 1, 'BYTES': 1,
    'KB': 1 << 10, 'KIB': 1 << 10,
    'MB': 1 << 20, 'MIB': 1 << 20,
    'GB': 1 << 30, 'GIB': 1 << 30,
    'TB': 1 << 40, 'TIB': 1 << 40,
    'PB': 1 << 50, 'PIB': 1 << 50,
}


def anySizeToBytes(size_string):
    """Convert strings like '1.2 GB' / '700 MiB' to a byte count (0 if unknown)."""
    if isinstance(size_string, (int, float)):
        return int(size_string)
    if not size_string:
        return 0
    import re
    m = re.search(r'([\d.,]+)\s*([A-Za-z]+)?', str(size_string))
    if not m:
        return 0
    try:
        value = float(m.group(1).replace(',', ''))
    except ValueError:
        return 0
    unit = (m.group(2) or 'B').upper()
    return int(value * _UNITS.get(unit, 1))


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
