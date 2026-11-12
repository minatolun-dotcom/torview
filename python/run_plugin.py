"""Run a single qBittorrent-style Python search plugin and print JSON results.

Usage: python run_plugin.py <plugin.py> <query> [category]
"""
import sys
import os
import json
import importlib.util
import traceback

shim_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, shim_dir)

plugin_path = sys.argv[1]
query = sys.argv[2] if len(sys.argv) > 2 else ''
category = sys.argv[3] if len(sys.argv) > 3 else 'all'

plugin_dir = os.path.dirname(os.path.abspath(plugin_path))
if plugin_dir not in sys.path:
    sys.path.insert(0, plugin_dir)

import novaprinter
novaprinter.clear()

try:
    spec = importlib.util.spec_from_file_location('qb_plugin', plugin_path)
    mod = importlib.util.module_from_spec(spec)
    # inject modules plugins commonly expect
    mod.novaprinter = novaprinter
    try:
        import helpers
        mod.helpers = helpers
    except Exception:
        pass
    spec.loader.exec_module(mod)

    # call search with flexible signature
    search_fn = getattr(mod, 'search', None)
    if search_fn is None:
        raise RuntimeError('plugin has no search() function')
    try:
        search_fn(query, category)
    except TypeError:
        try:
            search_fn(query)
        except TypeError:
            search_fn(query, 'all')
except Exception as e:
    sys.stderr.write(traceback.format_exc() + '\n')
    # still emit whatever was collected
    pass

out = []
for r in novaprinter.get_results():
    if not isinstance(r, dict):
        continue
    out.append({
        'title': r.get('name') or r.get('title') or '',
        'size': r.get('size'),
        'seeds': r.get('seeds'),
        'peers': r.get('leech') if r.get('leech') is not None else r.get('peers'),
        'magnet': r.get('link'),
        'link': r.get('link'),
        'desc_link': r.get('desc_link'),
        'pub_date': r.get('pub_date'),
        'engine_url': r.get('engine_url'),
        'provider': os.path.basename(plugin_path),
    })

sys.stdout.write(json.dumps(out))
sys.stdout.flush()
